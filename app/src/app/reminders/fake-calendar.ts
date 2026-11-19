import type { CalendarApi, CalendarEvent } from './calendar-api';

/** In-memory calendar for tests and e2e runs. */
export class FakeCalendar implements CalendarApi {
  readonly events = new Map<string, CalendarEvent>();
  calendarId = 'fake-calendar';
  ensureCalls = 0;
  failWith: Error | null = null;

  async ensureCalendar(existingId?: string): Promise<string> {
    this.ensureCalls++;
    this.check();
    return existingId ?? this.calendarId;
  }

  async listFutureEvents(): Promise<{ id: string; start: string }[]> {
    this.check();
    return [...this.events.values()].map((e) => ({ id: e.id, start: e.startsAt }));
  }

  async insert(_calendarId: string, e: CalendarEvent): Promise<'created' | 'exists'> {
    this.check();
    if (this.events.has(e.id)) return 'exists';
    this.events.set(e.id, e);
    return 'created';
  }

  async remove(_calendarId: string, id: string): Promise<void> {
    this.check();
    this.events.delete(id);
  }

  private check(): void {
    if (this.failWith) throw this.failWith;
  }
}
