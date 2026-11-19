# Google Cloud setup (once, about 15 minutes)

Iqra signs in with Google and stores books in your Drive. For that it needs a free OAuth client ID.

1. Go to <https://console.cloud.google.com>, create a project named "Iqra" and enable **both APIs** (APIs & Services → Library): the **Google Drive API** and the **Google Calendar API**. If the Calendar API is missing, turning on reminders fails with "Google Calendar API isn't enabled for this project" (Google's `accessNotConfigured` / `SERVICE_DISABLED` error); enabling it fixes that without any change in the app.
2. **OAuth consent screen:** user type External, app name "Iqra". Add these scopes:
   `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/drive.appdata`.
   Add your own Google account as a test user, then **Publish app** (status "In production"). Test mode makes sign-ins expire after 7 days. The app stays unverified, which is fine for personal use: you click through the "unverified app" notice once.
   For reading reminders, make sure the **Google Calendar API** (step 1) is enabled in the same Cloud project and add the scope `https://www.googleapis.com/auth/calendar.app.created` to the consent screen. It is a sensitive scope: Iqra asks for it only when you turn reminders on, and while the app is unverified (or in Testing) Google shows its "unverified app" warning on that step too. Click through **Advanced → Go to Iqra**.

   Reminders live in one calendar named "Iqra", and its id is saved in your synced settings. Iqra cannot search your calendars (the app-created scope does not allow it), so on a second device wait for settings to sync (Settings → Account → Sync now) before turning reminders on there. Otherwise that device creates a second "Iqra" calendar. Turning reminders on runs a sync first to reduce the chance of this.
3. **Credentials → Create credentials → OAuth client ID → Web application.** Authorized JavaScript origins:
   - `http://localhost:4200`
   - `https://ibrahimdiab1.github.io`
4. Copy the client ID (it ends in `.apps.googleusercontent.com`) into `googleClientId` in `app/src/environments/environment.ts`. A client ID is public and not a secret.

## "Access blocked: has not completed the Google verification process"

This means the OAuth consent screen is still in **Testing** mode. Either:

- **Publish it:** Google Auth Platform (or APIs & Services) → **Audience** → **Publish app**. Any Google account can then sign in after clicking through "Google hasn't verified this app" (**Advanced → Go to Iqra**). Iqra only requests the narrow Drive permissions, so no Google review is required.
- **Or stay in Testing:** on the same page, add your Google account under **Test users**. Sign-ins then expire every 7 days, so publishing is better.

## Staying signed in (token renewal)

Google access tokens last one hour. Iqra renews the token in the background about five minutes before it expires, while the app is open and visible, and again when you come back to the tab. The renewal asks Google for a token for the account that is already linked (no popup, no prompt). Only if that fails **and** the token has really run out does Iqra show one "Reconnect to keep syncing" bar; one click renews it and any waiting sync then runs by itself. Offline, nothing is asked and nothing is shown: reading and editing keep working and sync resumes when the connection returns.

Browsers that block third-party cookies, or a Google session that has ended, can make the silent renewal fail; that is when the bar appears.
