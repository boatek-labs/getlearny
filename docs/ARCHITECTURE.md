# Architecture and implementation notes

## System shape

- Flutter client (`app/`) targets Android. It keeps the interface navigable without an API and uses `GETLEARNY_API_URL` to connect to the API.
- Express API (`api/`) is a separate deployable service. PostgreSQL stores accounts, subjects/topics, learning logs, test logs, journal entries, quiz attempts, and document metadata.
- OpenRouter lesson generation is optional. The server always has a built-in lesson fallback, and the API key remains server-side.
- GitHub Actions builds a debug APK artifact. A release APK/AAB requires signing secrets and a release workflow configured by the repository owner.

## API routes

All paths below are prefixed by `/api/v1`.

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | No | Service and database health |
| POST | `/auth/register` | No | Create account |
| POST | `/auth/login` | No | Login and issue JWT |
| GET | `/me` | Yes | Current user profile |
| GET | `/subjects` | No | Subject catalogue |
| GET | `/dashboard` | Yes | Personal progress summary |
| GET/POST | `/learning-logs` | Yes | Learning history |
| GET/POST | `/tests` | Yes | Test score history |
| GET/POST | `/journal` | Yes | Reflection journal |
| POST | `/lessons/generate` | Yes | Lesson generation |
| POST | `/documents` | Yes | Upload PDF/text for processing |

## Production work that requires real services/credentials

- Connect Google OAuth through a verified OAuth client; do not trust client-supplied identity claims.
- Add a background worker and OCR/text extraction provider for scanned PDFs; this API currently stores uploads and metadata but does not claim OCR is complete.
- Move uploaded files to private object storage and implement deletion/retention policies.
- Add a curated, versioned Ghana Education Service/WASSCE syllabus dataset and map topics/prerequisites to it.
- Persist quiz attempts through a dedicated graded quiz API; the mobile demo quiz currently works offline.
- Add password reset/email verification, refresh-token rotation, audit logs, privacy/consent screens, and abuse monitoring before public production use.
- Configure backups, HTTPS, secrets, monitoring, and Android release signing.
