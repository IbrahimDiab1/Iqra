import { Injector, inject } from '@angular/core';
import { DB } from '../core/db';

/** Fills the reminder window when the app opens. Call in an injection context. Loads the service only when reminders are on. */
export const fillRemindersOnOpen = async (): Promise<void> => {
  const i = inject(Injector);
  try {
    const reminders = (await i.get(DB).settings.get('settings'))?.reminders;
    if (reminders?.enabled || reminders?.phone) await i.get((await import('./reminder.service')).ReminderService).fill();
  } catch {
    // Retried the next time the app opens.
  }
};
