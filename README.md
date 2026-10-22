# GetLearny

GetLearny is a WASSCE-focused learning platform for Ghanaian Senior High School students. This repository contains a Flutter Android app and a Node.js API backed by PostgreSQL.

## Repository layout
- `app/` — Flutter Android client.
- `api/` — Express REST API, PostgreSQL migrations, authentication, lesson/quiz/journal/progress endpoints.
- `web/` — responsive browser learning app.
- `.github/workflows/android-apk.yml` — builds a debug APK artifact.
- `.github/workflows/api-checks.yml` — runs backend syntax checks and tests.

## Run the API locally
Requirements: Node.js 20+, PostgreSQL 15+.

```bash
cd api
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Set `DATABASE_URL`, a random `JWT_SECRET` with at least 32 characters, `GEMINI_API_KEY`, and `GEMINI_MODEL=gemini-3.8-flash` in `api/.env`. All generative AI features use Gemini through the server-side API; no provider key is shipped to the web or Android client. For background browser push, also configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`; generate the key pair with `npx web-push generate-vapid-keys` and never commit the private key. If Gemini is unavailable, the app reports an error rather than substituting invented lessons or questions. Copy the root `.env.example` or `api/.env.example` and replace placeholders locally.

## Deploy to Vercel + Neon PostgreSQL

1. Import this repository into Vercel and keep the project root as the repository root.
2. Vercel uses `vercel.json`: it serves the `web/` directory and routes `/api/*` to the Express serverless handler in `api/[...path].js`.
3. In **Vercel → Project → Settings → Environment Variables**, add `DATABASE_URL` using your Neon pooled connection string, `JWT_SECRET` as a newly generated random secret of at least 32 characters, `APP_URL` as the production HTTPS URL, `GEMINI_API_KEY`, and `GEMINI_MODEL=gemini-3.8-flash`. Keep the Gemini key server-side and never commit it.
4. Add `CORS_ORIGINS` only when using a separate frontend domain; for a same-origin deployment the app works at `/api/v1` by default. Include the production URL if you set a restrictive allow-list.
5. Run the database migrations once against Neon from a trusted terminal after setting `DATABASE_URL`: `npm run db:migrate`. Do not run migrations as part of every Vercel build. The migration workflow can also run after migration files are merged, provided the GitHub Actions `DATABASE_URL` secret is configured.
6. Redeploy after setting environment variables. Check `https://YOUR-VERCEL-DOMAIN/api/v1/health` and confirm the database reports connected.

**File storage note:** uploaded PDF/TXT bytes are currently stored in PostgreSQL, so they survive Vercel invocations. For larger production usage, move file contents to private object storage and keep only metadata in PostgreSQL to avoid database bloat.

## Device notifications

The website uses a service worker and the browser Notification API for device-level alerts. Signed-in users can save Web Push subscriptions and receive a test push when the VAPID keys are configured. A scheduled GitHub Actions workflow checks due reminders every five minutes, so browser push reminders can arrive while the site is closed. Configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in Vercel; set the same long random `CRON_SECRET` in Vercel and GitHub repository Actions secrets. Configure the repository variable `GETLEARNY_API_URL` if the API is not at `https://getlearny.vercel.app/api/v1`. Apply database migrations first. The Android app uses native notifications and a scheduled daily reminder that can fire while the app is closed. Browser/Android notification permission and operating-system settings still apply.

## Preview the web app
From the repository root, run:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/web/`. To enable account sync and generated lessons, open Account and set the API base URL to the API's HTTPS `/api/v1` URL. Configure `CORS_ORIGINS` on the API to include the web app's origin.

## Build the Android APK
1. Open **Actions** → **Build GetLearny Android APK**.
2. Select **Run workflow** or push an app/workflow change to `main`.
3. Download the `getlearny-android-apk` artifact from the completed run.

The workflow generates Android platform scaffolding before building. For a local build, install Flutter and run `flutter pub get` then `flutter run` inside `app/`.

### Keep APK updates installable

Android only installs an APK as an in-place update when the package ID and signing certificate match the installed app. The workflow keeps the application ID stable (`com.boateklabs.getlearny`) and increments the app version. To keep signing stable across clean GitHub-hosted runners, configure these repository **Actions secrets** once: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Generate a release keystore locally with `keytool -genkeypair -v -keystore getlearny-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias getlearny`, then store the one-line Base64 output of that file as `ANDROID_KEYSTORE_BASE64`; keep the `.jks` private and never commit it. Do not replace this key for future releases. Until those secrets are configured, the workflow builds a debug APK and explicitly warns that its signing key is not stable between runners. If an older installation was made from an earlier ephemeral debug APK, the first install signed with a new stable key may require a one-time reinstall; after that transition, keep the same key and use increasing version codes.

### Offline lessons

In the Android app, open a subject while online and choose **Download next 3 lessons**. The app downloads only lessons returned by the live topic and lesson APIs, saves them on-device for seven days, and displays them in **My downloaded lessons** without needing a connection. Downloading requires sign-in and a working lesson service; the app does not manufacture substitute lessons when the service is unavailable.

## Current functionality
- SHS/WASSCE-oriented subject paths and practice
- Gemini-powered lessons, practice generation, grading feedback, scanned-PDF OCR, and document tutoring; failed AI requests are reported rather than replaced with fake content
- Registration/login with hashed passwords and expiring JWTs; browser signup supports six-digit email verification codes with a 10-minute expiry and attempt limits
- User-scoped learning logs, test results, and journal entries
- PostgreSQL migration runner with migration history
- PDF/plain-text/image uploads with selectable-text extraction, Tesseract OCR for images, and Gemini multimodal OCR fallback for scanned PDFs up to 6 MB; OCR results should still be reviewed for accuracy
- Responsive browser app and Flutter client using the hosted API by default

## Production checklist
Before real student accounts are used publicly, configure HTTPS, a strong secret, PostgreSQL backups, password reset, data retention/deletion, monitoring, durable private object storage, and Android release signing. Browser email verification requires a Resend API key and a sender address on a verified domain; Google OAuth, password reset, background web push, and stable Android release signing still require their real provider credentials/configuration. Image OCR is local via Tesseract; scanned-PDF OCR uses Gemini where supported.


### Email verification for browser signup

The browser signup flow sends a six-digit code through Resend before creating the account. Codes expire after 10 minutes, are stored as hashes, and are limited to five verification requests/attempts per 15-minute window. Configure these API environment variables in Vercel and in `api/.env` for local development:

```dotenv
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM=GetLearny <verify@your-verified-domain.com>
```

Verify the sender domain in Resend before sending to real learners. Keep the API key server-side; never add it to browser JavaScript or Flutter configuration. If the variables are missing, signup displays a configuration error rather than pretending an email was sent.

## Gemini AI environment template

Configure these variables in Vercel (Production, Preview, and Development as appropriate) and in `api/.env` for local development:

```dotenv
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.8-flash
# Optional comma-separated fallback models; defaults to gemini-3.6-flash,gemini-3.5-flash-lite
GEMINI_FALLBACK_MODELS=gemini-3.6-flash,gemini-3.5-flash-lite
```

The Gemini API key must only be read by the server. Never place it in browser JavaScript or Flutter app configuration. Check Google's official Gemini API model documentation for supported model IDs and availability.
