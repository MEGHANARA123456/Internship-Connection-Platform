# Security Documentation

This document separates controls present in the inspected source from deployment recommendations. It is not a penetration-test report or formal security certification.

## Implemented measures

### Authentication and password handling

- Passwords are stored as Argon2 hashes, not plaintext.
- The API issues and validates JWT access tokens and stores refresh-token records in the database with expiration, revocation, rotation, and reuse tracking.
- Email verification and account recovery flows use expiring tokens/OTP-related state.
- MFA functionality includes TOTP support and login challenges.
- Google authentication is supported when provider configuration is supplied.
- The current worktree includes changes for a remembered-device refresh lifetime and shared frontend refresh/retry, proactive refresh, idle timeout/warning, and WebSocket reconnection. These recent changes were not validated as part of this documentation-only task; treat their exact operational behavior as requiring test confirmation.

### Authorization

- Backend dependencies enforce authentication and roles (`STUDENT`, `COMPANY`, `ADMIN`).
- Resource routes perform ownership and participant checks for sensitive entities.
- WebSocket chat and interview signalling validate bearer identity and participant/ownership conditions.
- Frontend `ProtectedRoute` improves navigation UX but does not replace backend authorization.

### Validation and data access

- Pydantic validates request data and SQLAlchemy binds values through parameterized queries.
- Database uniqueness, foreign keys, check constraints, and deletion policies protect important relationships.
- Upload handling uses multipart routes and file metadata; several frontend upload controls impose file type/size limits.
- Student interview APIs separate administrative question details from student/session flows; recording endpoints require consent state.
- Account deletion and privacy/export endpoints are explicitly implemented.

### Transport and browser protections

- CORS and security middleware are configured in the FastAPI application.
- WebSocket endpoints require bearer authentication.
- Browser authentication state is held in the frontend auth store, using session or persistent browser storage according to the selected sign-in behavior.

## Sensitive data

Sensitive information includes password hashes, access/refresh tokens, MFA secrets/OTP state, resumes and company documents, application notes, interview answers, evaluation content, recordings, and chatbot user content. Logs and diagnostics must not contain credentials, raw tokens, question/answer prompts, uploaded document contents, or unnecessary personal data.

## Potential weaknesses and areas to verify

- **Secret stability:** production `SECRET_KEY` must be a fixed high-entropy secret shared consistently by workers. A regenerated or mismatched key invalidates tokens and can create intermittent authentication failures.
- **Browser storage:** access/refresh state behavior should be reviewed against XSS and device-sharing risks. HttpOnly refresh cookies are safer against direct JavaScript token theft when implemented with suitable CSRF controls; the current source uses database-backed refresh tokens and frontend-managed auth state.
- **Refresh rotation and concurrency:** verify rotation/reuse handling under concurrent requests, multiple tabs, and refresh races with tests.
- **Recent auth changes:** the worktree contains unvalidated refresh, idle-timeout, retry, and WebSocket reconnect changes. Confirm token lifetime, `Keep me signed in`, `next` redirects, active interview answer preservation, and expired-refresh behavior before release.
- **CORS/security headers:** review allowed origins, credentials policy, CSP, and production headers against the deployed hostnames. Some deployment defaults still mention localhost.
- **File storage:** ensure uploaded files and recordings are stored outside public web roots, filenames are not user-controlled paths, download routes authorize every access, and retention/deletion jobs are monitored.
- **AI provider data:** confirm provider contracts, data residency/retention, redaction, and consent before sending user prompts/answers. Provider errors should not leak prompts or responses into logs.
- **Logging:** the data model includes chatbot low-confidence question logs and interview usage metadata. Review retention/access controls, because prompts/questions may be personal or sensitive.
- **Rate limiting and abuse controls:** the frontend handles some 429 responses, but verify server-side limits on login, OTP, registration, uploads, AI operations, chat, and public search.
- **MFA and recovery:** test OTP expiry, replay prevention, recovery flows, email enumeration behavior, and token invalidation after password changes.
- **Database migration:** apply migrations with backups and least-privilege DB credentials; migration execution during app startup may be unsuitable for multi-worker production unless startup concurrency is controlled.
- **Optional integrations:** absent provider configuration should fail closed and not produce success-shaped responses.

## Environment and secret management

Use environment variables/secret stores for database credentials, signing keys, SMTP credentials, Google credentials, and AI provider keys. `.env.example` files may document variable names but must not contain live secrets. Do not commit `backend/.env`, local credentials, tokens, or provider keys. Rotate any secret that has been exposed.

## Security review boundary

The source inspection identified architectural controls and consistency issues but did not execute penetration tests, threat modeling, dependency vulnerability scanning, or production configuration validation. Do not treat this documentation as evidence those activities passed.
