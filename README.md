# Internship Connection Platform

A FastAPI + PostgreSQL backend and React + TypeScript frontend connecting students, companies, and administrators through the internship recruitment lifecycle.

## Stack

- Backend: Python 3.12, FastAPI, SQLAlchemy async, Alembic, PostgreSQL 16
- Auth: JWT access/refresh tokens, Argon2 password hashing
- Frontend: React, TypeScript, Vite, Tailwind CSS, React Router, Zustand, Axios
- Local email: Mailpit
- Tests: pytest/httpx and Vitest/Testing Library

## Prerequisites

For local development install Python 3.12, Node.js 22+, npm, and Docker Desktop with the Linux engine enabled. Docker is recommended because it provides PostgreSQL and Mailpit consistently.

## Development Setup

1. Copy `.env.dev.example` to `.env`.
2. Start the complete development stack:

```powershell
docker compose up --build
```

The API is available at `http://localhost:8000`, Swagger UI at `http://localhost:8000/docs`, the frontend at `http://localhost:5173`, and Mailpit at `http://localhost:8025`. The backend container runs `alembic upgrade head` before Uvicorn starts.

If a development port is already in use, set `BACKEND_PORT`, `FRONTEND_PORT`, `DB_PORT`, and `VITE_API_BASE_URL` before starting Compose, for example: `$env:BACKEND_PORT = "8010"; $env:FRONTEND_PORT = "5174"; $env:DB_PORT = "55432"; $env:VITE_API_BASE_URL = "http://localhost:8010/api/v1"`.

To run services directly without Docker, start PostgreSQL, install the backend dependencies, and run:

```powershell
cd backend
python -m pip install -r requirements.txt
$env:PYTHONPATH = "."
alembic upgrade head
python -m uvicorn app.main:app --reload
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

## Database Migrations

Every schema change must be an Alembic migration. With the database available:

```powershell
cd backend
$env:PYTHONPATH = "."
alembic upgrade head
```

Create a revision after changing models:

```powershell
alembic revision --autogenerate -m "describe the schema change"
alembic upgrade head
```

Never edit a running database schema manually. To roll back one revision, use `alembic downgrade -1`.

## Production Compose

1. Copy `.env.prod.example` to `.env` on the deployment host.
2. Replace every placeholder secret and set the public HTTPS API URL.
3. Build and start the production override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

The production frontend is served by Nginx on port 80. The API binds to loopback port 8000 for a reverse proxy. Put TLS termination and public routing in a managed reverse proxy or load balancer. Do not expose Postgres publicly in production.

The current email implementation targets Mailpit for development. Configure a production SMTP provider or transactional mail adapter before enabling real production email.

## API Notes

FastAPI generates the OpenAPI document at `/openapi.json` and interactive Swagger UI at `/docs`. All application endpoints are versioned under `/api/v1/`. Authentication uses `Authorization: Bearer <access_token>`. Role checks are enforced server-side for student, company, and admin operations.

## Testing

Backend:

```powershell
cd backend
$env:PYTHONPATH = "."
python -m pytest tests -q
```

Frontend:

```powershell
cd frontend
npm test
npm run build
```

The backend suite includes a complete registration-to-selection integration flow using an isolated async SQLite database, plus security-header, rate-limit, and sanitized-error checks.

## Operational Notes

- The development rate limiter is in-memory and per process. Use a shared store such as Redis only when multi-instance deployment requires it.
- Resume files are stored under the configured private storage path and are never served as public static files.
- Set `SECRET_KEY`, database credentials, and public URLs through environment variables only.

## Future Enhancements / Deferred

- AI-powered internship matching and ranking
- OAuth/social login
- Real-time WebSocket messaging and presence
- Embedded video interviews
- Redis-backed distributed rate limiting and background queues
- Production transactional email provider and template management
- Object storage for resumes with malware scanning and retention policies
- Advanced search indexing and recommendation analytics
- Mobile applications and push notifications
- Calendar provider integration
- Multi-company/group chat
- Expanded admin audit logs, exports, and analytics
- CI deployment environments, TLS automation, backups, and observability infrastructure
