# Technology Stack

Versions below are those declared in repository manifests/configuration when pinned. Deployment and CI versions are not fully aligned.

## Frontend

| Technology | Use |
|---|---|
| React 19 | Component-based user interface. |
| TypeScript 6 | Static typing for components and client data. |
| Vite 8 | Development server and production bundling. |
| React Router 7 | Client-side navigation and protected routes. |
| Axios | HTTP calls, bearer tokens, refresh/retry handling. |
| Zustand | Authentication, theme, and view-mode stores. |
| TanStack Query | Selective asynchronous query/cache usage. |
| React Hook Form + Zod | Form state and schema validation. |
| Tailwind CSS 4 | Utility-driven responsive styling. |
| Recharts | Analytics visualizations. |
| Lucide React | Interface icons. |
| Vitest, Testing Library, jsdom | Frontend component and unit tests. |
| Oxlint | Frontend linting. |

Evidence: `frontend/package.json`, Vite config, and `frontend/src/`.

## Backend and data

| Technology | Use |
|---|---|
| Python 3.12 | Backend runtime (used in backend Docker image). |
| FastAPI 0.116.1 | Async HTTP API, WebSockets, dependency injection, OpenAPI. |
| Pydantic 2.8.2 / pydantic-settings 2.10.1 | Request/response validation and configuration. |
| SQLAlchemy 2.0.43 async | ORM and database interactions. |
| Alembic 1.16.5 | Versioned schema migrations. |
| PostgreSQL 16 / asyncpg | Relational storage and async driver. |
| pgvector 0.4.1 | Vector data support for retrieval. |
| Argon2 (`argon2-cffi`) | Password hashing. |
| python-jose and cryptography | JWT operations. |
| pyotp | TOTP multi-factor authentication. |
| httpx | Async HTTP integrations and API testing. |
| Redis | Optional cache/coordination integration. |
| fastembed | Embedding generation for retrieval. |
| openpyxl, xlrd, odfpy | Spreadsheet import formats. |
| pypdf | PDF processing. |
| python-multipart | Multipart file uploads. |
| Uvicorn | ASGI server. |
| pytest | Backend tests. |

Evidence: `backend/requirements.txt`, `backend/app/`, `backend/alembic/`.

## Tooling and external/browser services

The project uses npm and `package-lock.json`; Python dependencies are managed through pip and `requirements.txt`. Docker Compose definitions live under `doc/`; GitHub Actions provide CI. Third-party/browser features include Google Identity Services, SMTP/Mailpit, optional AI endpoints, browser notifications, WebRTC/MediaRecorder, and browser speech recognition.

## Configuration discrepancies

- CI uses Node 20; frontend Docker uses Node 22.
- The local PowerShell script binds the API to port 8010; Compose and the frontend env example use 8011.
- Optional services are not guaranteed to be configured in a given deployment.

See the [Installation Guide](./10_Installation_Guide.md) before choosing a runtime workflow.
