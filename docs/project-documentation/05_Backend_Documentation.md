# Backend Documentation

## Structure

| Path | Purpose |
|---|---|
| `backend/app/main.py` | FastAPI app, middleware, lifespan startup/shutdown, exception handling. |
| `backend/app/api/v1/` | Versioned HTTP routers and central registration. |
| `backend/app/core/` | Settings, database, security, and shared dependencies. |
| `backend/app/models/` | SQLAlchemy ORM mappings. |
| `backend/app/schemas/` | Pydantic request/response types. |
| `backend/app/services/` | Business logic and integration orchestration. |
| `backend/app/chatbot/` | Chatbot routes and retrieval-related logic. |
| `backend/alembic/` | Migration environment and revision files. |
| `backend/requirements.txt` | Python dependency declarations. |
| `tests/` | Backend pytest suite at repository root. |

## Startup and request flow

The app lifecycle applies Alembic migrations to head, seeds Interview Studio question/mock-test catalogs, optionally initializes chatbot knowledge, starts interview reminder/expiry and video-retention workers, and conditionally starts Mailpit. HTTP requests pass through CORS/security middleware and route handling; dependencies resolve database sessions and authenticated roles; Pydantic validates inputs; route/service code reads/writes PostgreSQL or calls integrations; responses are serialized or streamed.

The asynchronous PostgreSQL engine and request-scoped sessions are defined in `backend/app/core/database.py`. Current migration head is `0052_interview_two_categories`.

## Router groups

The `/api/v1` router mounts core/navigation, auth, profiles, internships, applications, communication, AI, reports, reviews, documents, privacy, search, analytics, insights, interviews, skills, admin, chatbot, and WebSockets. The exact route inventory is in [API Documentation](./06_API_Documentation.md).

## Security and authorization

Passwords use Argon2 hashing. JWT access tokens are validated by shared dependencies; refresh-token state is database-backed with expiry/revocation/rotation metadata. Endpoint dependencies enforce student/company/admin roles; resource-specific ownership checks protect private records. Email verification, MFA/TOTP, and Google sign-in are implemented, subject to configuration.

Pydantic performs request validation; SQLAlchemy provides bound query parameters; database keys/checks enforce selected invariants. CORS/security middleware and a global exception handler are configured in `main.py`. Uploads and WebSocket actions have feature-specific authorization.

## Services, integrations, and background work

`backend/app/services/` contains Interview Studio orchestration and LLM calls as well as other feature helpers. Some business logic remains directly in route modules, so the repository does not have a strict controller/domain/repository split. Integrations include email/Mailpit, Google, interview AI/STT, chatbot retrieval/embeddings, Redis, GitHub lookup, PDF/spreadsheet processing, and file/media storage. Availability is provider/configuration dependent.

Startup workers perform reminders, interview expiry, and recording retention. No universal task-queue system is configured.

## Caveats

- Migration-created `learning_*` and skill-gap tables have no ORM model classes.
- `KBChunk` is mapped but not exported from `models/__init__.py`.
- `endorsements` is historical/dropped.
- API response schemas are not explicit on all routes; some return dictionaries or service-defined data.
- Running migrations automatically on app startup requires care in multi-replica production.
- The current worktree contains recent auth/session modifications that were not validated during this documentation task.
