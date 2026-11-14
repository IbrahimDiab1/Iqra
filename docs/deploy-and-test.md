# Deploy and test: owner checklist

The CI workflow (`.github/workflows/deploy.yml`) runs unit tests and builds the app on every push to `main`, then publishes it to GitHub Pages. The site is served from `https://<user>.github.io/iqra/`.

## 1. Push the repository to GitHub

- Create an empty GitHub repository named `iqra`.
- Push this repository's `main` branch to it.

## 2. Enable GitHub Pages

- In the repository: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- Run the "Deploy to GitHub Pages" workflow (Actions tab → Run workflow), or push to `main`.
- Confirm the site loads at `https://<user>.github.io/iqra/`.

## 3. Check the OAuth origin

- In Google Cloud, the OAuth client's authorized JavaScript origins must include `https://<user>.github.io` (the origin only, no path). This was needed from Task 0.
- If sign-in fails with an origin mismatch error, this is the first thing to check.

## 4. Install the app

- **Android phone:** open the site in Chrome → menu (⋮) → Install app.
- **Windows PC:** open the site in Edge or Chrome → install icon in the address bar (or menu → Install Iqra).

## 5. Acceptance checks

- Sign in on both the phone and the PC.
- Add a PDF on the PC. It should appear on the phone within 2 minutes, or right away after reopening the app.
- Open and stream the PDF on the phone.
- Turn on airplane mode. The library still loads, and the status reads `Offline · changes are saved on this device`.

## 6. Google Drive items to verify

- **Resumable upload of a large PDF:** upload a PDF of 50 MB or more from the PC. It should finish, and an interrupted upload should resume rather than restart.
- **Streaming a book from Drive:** open a book stored in Drive on the phone without downloading it first. Pages should load on demand.
