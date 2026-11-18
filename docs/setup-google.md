# Google Cloud setup (once, about 15 minutes)

Iqra signs in with Google and stores books in your Drive. For that it needs a free OAuth client ID.

1. Go to <https://console.cloud.google.com>, create a project named "Iqra" and enable the **Google Drive API**.
2. **OAuth consent screen:** user type External, app name "Iqra". Add these scopes:
   `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/drive.appdata`.
   Add your own Google account as a test user, then **Publish app** (status "In production"). Test mode makes sign-ins expire after 7 days. The app stays unverified, which is fine for personal use: you click through the "unverified app" notice once.
3. **Credentials → Create credentials → OAuth client ID → Web application.** Authorized JavaScript origins:
   - `http://localhost:4200`
   - `https://ibrahimdiab1.github.io`
4. Copy the client ID (it ends in `.apps.googleusercontent.com`) into `googleClientId` in `app/src/environments/environment.ts`. A client ID is public and not a secret.
