import { InjectionToken } from '@angular/core';

export interface PhoneNotification {
  /** Notification ids are small integers: 1..n in time order. */
  id: number;
  at: Date;
  title: string;
  body: string;
}

/** The device's local notifications (Android). The plugin code loads on first use, so the web build never carries it. */
export interface Notifier {
  /** True when notifications are allowed. With `ask`, shows the Android permission prompt when needed (Android 13 and later). */
  permission(ask: boolean): Promise<boolean>;
  /** Cancels every pending reminder, then schedules these. */
  replaceAll(items: PhoneNotification[]): Promise<void>;
  cancelAll(): Promise<void>;
}

export const NOTIFIER = new InjectionToken<Notifier>('phone-notifier', {
  providedIn: 'root',
  factory: () => ({
    permission: async (ask) => (await import('./local-notifier')).localNotifier.permission(ask),
    replaceAll: async (items) => (await import('./local-notifier')).localNotifier.replaceAll(items),
    cancelAll: async () => (await import('./local-notifier')).localNotifier.cancelAll(),
  }),
});

/** One notification per reminder slot, in time order. `content` gives the title and text for a slot. */
export function buildPhoneNotifications(slots: Date[], content: (slot: Date) => { title: string; body: string }): PhoneNotification[] {
  return [...slots]
    .sort((a, b) => a.getTime() - b.getTime())
    .map((at, i) => ({ id: i + 1, at, ...content(at) }));
}
