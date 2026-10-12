# GetLearny

GetLearny is a WASSCE-focused learning platform for Ghanaian Senior High School students. This repository contains a Flutter Android app and a Node.js API backed by PostgreSQL.

## Repository layout
- `app/` — Flutter Android client.
- `api/` — Express REST API, PostgreSQL schema/migrations, authentication, lesson/quiz/journal/progress endpoints.
- `.github/workflows/android-apk.yml` — builds a debug APK on pushes and manual runs; APK is uploaded as a workflow artifact.
- `.github/workflows/api-checks.yml` — runs backend tests and syntax checks.

## Build Android APK in GitHub Actions
1. Push this repository to GitHub.
2. Open **Actions** → **Build GetLearny Android APK**.
3. Select **Run workflow** (or push a commit to `main`/`master`).
4. Open the completed run and download the `getlearny-android-apk` artifact.
5. Extract it; install `app-debug.apk` on an Android device. Android may ask you to allow installation from your browser/file manager.

The workflow creates the standard Android platform scaffolding with Flutter before building, so generated platform files do not need to be committed.

## Run the API locally
Requirements: Node.js 20+, PostgreSQL 15+.

```bash
cd api
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Set `DATABASE_URL`, `JWT_SECRET` (32+ random characters), and optionally `OPENROUTER_API_KEY` in `api/.env`. Never commit secrets. Without an OpenRouter key, lessons use a safe built-in curriculum template. Set `OPENROUTER_MODEL` to a model available to your account.

## Connect app to API
Set `GETLEARNY_API_URL` when building the app. For a local Android emulator, use `http://10.0.2.2:4000/api/v1`; for a hosted HTTPS API, use its HTTPS `/api/v1` base URL. Example:

```bash
cd app
flutter run --dart-define=GETLEARNY_API_URL=https://your-api.example.com/api/v1
```

The APK workflow accepts a repository variable named `GETLEARNY_API_URL`; if unset, the app starts in demo/offline mode and can still be navigated.

## Security and production readiness
- Passwords are hashed with bcrypt; JWT access tokens expire.
- Authenticated endpoints are user-scoped; request validation, rate limits, CORS allowlist, and security headers are enabled.
- Use HTTPS, a strong `JWT_SECRET`, managed PostgreSQL backups, object storage for uploaded files, and provider secrets in deployment before serving real users.
- Google OAuth, a production OCR provider, push notifications, and Play Store signing require credentials/configuration and are intentionally not faked. PDF upload is stored locally in development; configure durable object storage before production.

## Main capabilities
- SHS learning dashboard and subject progress
- Ghana/WASSCE-oriented lesson generation with optional OpenRouter
- Topic practice quizzes with server-scored answers
- Learning journal and test-score tracking
- Revision priorities and learning history
- PDF upload endpoint with safe file limits and text extraction hook point
- User registration/login, profile, API health, and PostgreSQL migrations
- Flutter Android client with responsive navigation and API/offline fallback

## License
Private project. Add a license before redistributing.

## Web app
The `web/` folder contains a responsive browser app with dashboard, subjects, lesson generation, quick practice, learning journal, test tracker, sign-in/register, and API connection settings. For local preview, run `python3 -m http.server 8080` from the repository root and open `http://localhost:8080/web/`. Configure the API URL in Account; the API CORS allowlist must include the web origin.
