import type { CalendarApi, CalendarEvent, CalendarEventInfo } from './calendar-api';

/**
 * In-memory calendar for tests and e2e runs. Like Google it keeps a deleted event's id reserved
 * (status 'cancelled'): inserting that id again reports 'exists' and brings nothing back.
 */
export class FakeCalendar implements CalendarApi {
  readonly events = new Map<string, CalendarEvent & { status: 'confirmed' | 'cancelled' }>();
  calendarId = 'fake-calendar';
  ensureCalls = 0;
  insertCalls = 0;
  removeCalls = 0;
  updateCalls = 0;
  failWith: Error | null = null;
  /** Milliseconds each call takes, to let tests overlap runs. */
  delayMs = 0;
  active = 0;
  maxActive = 0;

  /** Events a reader of the calendar would see. */
  live(): CalendarEvent[] {
    return [...this.events.values()].filter((e) => e.status === 'confirmed');
  }

  async ensureCalendar(existingId?: string): Promise<string> {
    this.ensureCalls++;
    return this.call(() => existingId ?? this.calendarId);
  }

  async listFutureEvents(): Promise<CalendarEventInfo[]> {
    return this.call(() => [...this.events.values()].map((e) => ({ id: e.id, start: e.startsAt, status: e.status, title: e.title, description: e.description })));
  }

  async insert(_calendarId: string, e: CalendarEvent): Promise<'created' | 'exists'> {
    return this.call(() => {
      this.insertCalls++;
      if (this.events.has(e.id)) return 'exists';
      this.events.set(e.id, { ...e, status: 'confirmed' });
      return 'created';
    });
  }

  async update(_calendarId: string, e: CalendarEvent): Promise<void> {
    return this.call(() => {
      this.updateCalls++;
      this.events.set(e.id, { ...e, status: 'confirmed' });
    });
  }

  async remove(_calendarId: string, id: string): Promise<void> {
    return this.call(() => {
      this.removeCalls++;
      const e = this.events.get(id);
      if (e) this.events.set(id, { ...e, status: 'cancelled' });
    });
  }

  private async call<T>(fn: () => T): Promise<T> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      if (this.failWith) throw this.failWith;
      return fn();
    } finally {
      this.active--;
    }
  }
}
