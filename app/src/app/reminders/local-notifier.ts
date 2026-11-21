import { LocalNotifications } from '@capacitor/local-notifications';
import type { Notifier } from './phone-notifications';

const CHANNEL_ID = 'reading-reminders';

export const localNotifier: Notifier = {
  async permission(ask) {
    let status = await LocalNotifications.checkPermissions();
    if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
      if (!ask) return false;
      status = await LocalNotifications.requestPermissions();
    }
    return status.display === 'granted';
  },

  async replaceAll(items) {
    await this.cancelAll();
    if (!items.length) return;
    // Android 8 and later need a channel; creating it again is harmless.
    await LocalNotifications.createChannel({ id: CHANNEL_ID, name: 'Reading reminders', importance: 3, visibility: 1 });
    await LocalNotifications.schedule({
      notifications: items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        channelId: CHANNEL_ID,
        schedule: { at: n.at, allowWhileIdle: true },
        smallIcon: 'ic_stat_iqra',
      })),
    });
  },

  async cancelAll() {
    const { notifications } = await LocalNotifications.getPending();
    if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
  },
};
