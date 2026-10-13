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

Set `DATABASE_URL`, a random `JWT_SECRET` with at least 32 characters, and optionally `OPENROUTER_API_KEY` in `api/.env`. For background browser push, also configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`; generate the key pair with `npx web-push generate-vapid-keys` and never commit the private key. Without an OpenRouter key, lesson generation uses a built-in fallback lesson. Copy the root `.env.example` or `api/.env.example` and replace placeholders locally.

## Deploy to Vercel + Neon PostgreSQL

1. Import this repository into Vercel and keep the project root as the repository root.
2. Vercel uses `vercel.json`: it serves the `web/` directory and routes `/api/*` to the Express serverless handler in `api/[...path].js`.
3. In **Vercel → Project → Settings → Environment Variables**, add `DATABASE_URL` using your Neon pooled connection string, `JWT_SECRET` as a newly generated random secret of at least 32 characters, and `APP_URL` as the production HTTPS URL. Add `OPENROUTER_API_KEY` for AI lesson generation, `OPENROUTER_MODEL=openrouter/free`, and optional `OPENROUTER_FALLBACK_MODELS` as a comma-separated list of free model IDs. Never commit actual secrets.
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

## Current functionality
- SHS/WASSCE-oriented subject paths and practice
- Optional OpenRouter lesson generation with a built-in fallback
- Registration/login with hashed passwords and expiring JWTs
- User-scoped learning logs, test results, and journal entries
- PostgreSQL migration runner with migration history
- PDF/plain-text upload intake (OCR/background extraction is not implemented yet)
- Responsive browser app and Flutter client using the hosted API by default

## Production checklist
Before real student accounts are used publicly, configure HTTPS, a strong secret, PostgreSQL backups, email verification and password reset, data retention/deletion, monitoring, durable private object storage, and Android release signing. Google OAuth, OCR, push notifications, and Play Store signing require real provider credentials and are not faked by this starter.

## OpenRouter AI environment template

Set these variables in **Vercel → Project → Settings → Environment Variables** (Production and Preview if needed). Enter the real key directly in the provider dashboard; do not paste it into source code or chat.

```dotenv
OPENROUTER_API_KEY=sk-or-v1-your-real-key
OPENROUTER_MODEL=openrouter/free
OPENROUTER_FALLBACK_MODELS=google/gemma-4-31b-it:free,nvidia/nemotron-3-ultra-550b-a55b:free,qwen/qwen3.8-27b:free
OPENROUTER_SITE_URL=https://getlearny.vercel.app
OPENROUTER_APP_NAME=GetLearny
```

The `openrouter/free` router automatically selects an available free model. Named free models are fallback options, not a guarantee: IDs and provider availability change, and free endpoints have rate limits. Check the current [OpenRouter free-model catalogue](https://openrouter.ai/collections/free-models/) before pinning a model.
