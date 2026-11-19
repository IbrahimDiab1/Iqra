import { Injectable, inject } from '@angular/core';
import { CLOCK } from '../core/clock';
import { DB, type IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book, ReadingSession } from '../core/models';
import { Repo } from '../core/repo';
import { SessionTracker, type SessionSnapshot } from './session-tracker';

const CHECKPOINT_MS = 30_000;
const FIRST_WRITE_MS = 1_000;
const STARTED_AFTER_PAGES = 3;

export interface ReaderSessionHandle {
  activity(): void;
  pageChanged(page: number): void;
  end(): Promise<void>;
}

/** One continuous run of reading: one tracker, one ReadingSession record. */
class Run {
  readonly id = newId();
  readonly tracker: SessionTracker;
  private written: { activeMs: number; pages: number } | undefined;
  private chain: Promise<void> = Promise.resolve();
  private checkedPages = 0;
  private started = false;

  constructor(
    private readonly bookId: string,
    now: number,
    page: number,
    private readonly db: IqraDb,
    private readonly repo: Repo,
  ) {
    this.tracker = new SessionTracker(now, page);
  }

  /** Writes the record (queued after earlier writes). `final` also writes short sessions. */
  write(snap: SessionSnapshot, final: boolean): Promise<void> {
    const next = this.chain.then(() => this.persist(snap, final));
    this.chain = next.catch((err) => console.warn('Could not save the reading session', err));
    return this.chain;
  }

  private async persist(snap: SessionSnapshot, final: boolean): Promise<void> {
    if (snap.activeMs <= 0 && snap.pagesRead.length === 0) return;
    if (!final && snap.activeMs < FIRST_WRITE_MS) return;
    if (this.written?.activeMs === snap.activeMs && this.written.pages === snap.pagesRead.length && !final) return;
    await this.repo.put<ReadingSession>('sessions', { id: this.id, bookId: this.bookId, ...snap });
    if (snap.pagesRead.length > this.checkedPages) {
      await this.markStarted(snap);
      this.checkedPages = snap.pagesRead.length;
    }
    // Only a fully successful write counts as written, so a failed put or start update is retried.
    this.written = { activeMs: snap.activeMs, pages: snap.pagesRead.length };
  }

  /** First day with at least 3 distinct pages read: sets startedAt and moves to-read to reading. */
  private async markStarted(snap: SessionSnapshot): Promise<void> {
    if (this.started) return;
    const sessions = (await this.db.sessions.where('bookId').equals(this.bookId).toArray()).filter((s) => !s.deleted);
    const pages = new Set<number>(snap.pagesRead);
    for (const s of sessions) for (const p of s.pagesRead) pages.add(p);
    if (pages.size < STARTED_AFTER_PAGES) return;
    const day = new Date(snap.startedAt);
    const startedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    await this.repo.update<Book>('books', this.bookId, (book) => {
      this.started = true;
      if (book.startedAt !== undefined) return null;
      return { startedAt, status: book.status === 'to-read' ? 'reading' : book.status };
    });
  }
}

/** Turns reader activity into ReadingSession records, with periodic checkpoints so a crash keeps the time so far. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly clock = inject(CLOCK);

  start(book: Book, page: number): ReaderSessionHandle {
    let current = page;
    let run: Run | undefined;
    let over = false;

    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const begin = () => {
      run = new Run(book.id, this.clock.now(), current, this.db, this.repo);
    };
    const finishRun = async () => {
      const r = run;
      run = undefined;
      if (r) await r.write(r.tracker.end(this.clock.now()), true);
    };
    const onTick = () => {
      if (!run) return;
      const now = this.clock.now();
      const { ended } = run.tracker.tick(now);
      if (ended) void finishRun();
      else void run.write(run.tracker.snapshot(now), false);
    };
    const onHide = () => {
      if (over) return;
      if (hidden()) void finishRun();
      else if (!run) begin();
    };
    const onPageHide = () => void finishRun();

    if (!hidden()) begin();
    const timer = setInterval(onTick, CHECKPOINT_MS);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);

    const ensure = (): Run | undefined => {
      if (!run && !over && !hidden()) begin();
      return run;
    };

    return {
      activity: () => ensure()?.tracker.activity(this.clock.now()),
      pageChanged: (p) => {
        current = p;
        ensure()?.tracker.pageChanged(this.clock.now(), p);
      },
      end: async () => {
        if (over) return;
        over = true;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', onPageHide);
        await finishRun();
      },
    };
  }
}
