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

Set `DATABASE_URL`, a random `JWT_SECRET` with at least 32 characters, and optionally `OPENROUTER_API_KEY` in `api/.env`. Never commit secrets. Without an OpenRouter key, lesson generation uses a built-in fallback lesson.

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
- Browser app and Flutter client with offline/demo navigation

## Production checklist
Before real student accounts are used publicly, configure HTTPS, a strong secret, PostgreSQL backups, email verification and password reset, data retention/deletion, monitoring, durable private object storage, and Android release signing. Google OAuth, OCR, push notifications, and Play Store signing require real provider credentials and are not faked by this starter.
