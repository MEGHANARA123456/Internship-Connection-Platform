# Installation Guide (Windows)

## Prerequisites

- Windows 10/11 with PowerShell.
- Git.
- Python 3.12 (the backend Docker image uses Python 3.12).
- Node.js and npm. Docker/CI configurations use Node 22/20 respectively; use a current Node version supported by Vite 8.
- Docker Desktop with Compose plugin (recommended for PostgreSQL and full-stack setup).
- Optional: provider credentials for Google sign-in, SMTP, AI interview/evaluation, speech-to-text, or chatbot features.

## Repository layout

Important directories are `backend/`, `frontend/`, `tests/`, `doc/`, `docs/`, and `project-documentation/`. Backend Python requirements are in `backend/requirements.txt`; the frontend lockfile/package manifest are in `frontend/`.

## Option A: run the application with Docker Compose

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` for local use before starting. Replace placeholder secrets, confirm DB and host ports, and add provider keys only when needed. Never commit the local `.env`. The compose configuration reads variables for PostgreSQL, API, frontend, Mailpit, uploads, AI, and chatbot integrations.

Start the development stack:

```powershell
docker compose --env-file .env -f doc/docker-compose.yml up --build
```

Typical checked-in Compose defaults:

| Service | Host URL/port |
|---|---|
| Frontend | `http://localhost:5174` |
| Backend API | `http://localhost:8011/api/v1` |
| FastAPI docs | `http://localhost:8011/docs` |
| PostgreSQL | `localhost:55432` |
| Mailpit web UI | `http://localhost:18025` |
| Mailpit SMTP | `localhost:11025` |

Compose runs PostgreSQL 16 with pgvector. The backend container applies Alembic migrations during application startup. The frontend environment defaults to the API at port 8011. On the first run, image builds and frontend dependency installation can take time.

The production override exists at `doc/docker-compose.prod.yml`:

```powershell
docker compose --env-file .env -f doc/docker-compose.yml -f doc/docker-compose.prod.yml up --build -d
```

The production compose default frontend port is 5175 and backend port is 8011. Review `VITE_API_BASE_URL`, Nginx/CSP configuration, hostnames, secrets, storage volumes, and proxy settings before deployment. The checked-in production defaults include localhost-oriented values and should not be used unchanged for a public deployment.

## Option B: run backend and frontend locally

### 1. Start PostgreSQL

The repo's Compose file can start just the database and Mailpit:

```powershell
docker compose --env-file .env -f doc/docker-compose.yml up -d db mailpit
```

With the default Compose mapping, PostgreSQL is available at `localhost:55432`. From a host process, use `localhost`, not the Compose service DNS name `db`.

### 2. Create and activate a Python environment

Run from the repository root:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

If PowerShell blocks activation, use the Python executable directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

### 3. Configure and migrate the backend

Set host-side environment values for the local process. Use a newly generated, fixed development secret; do not copy credentials into source control.

```powershell
$env:DATABASE_URL = "postgresql+asyncpg://postgres:<local-password>@localhost:55432/internship_platform"
$env:SECRET_KEY = "<stable-long-random-development-secret>"
$env:FRONTEND_URL = "http://localhost:5174"
Set-Location backend
alembic upgrade head
```

Start the API:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload --reload-dir app
```

Local API URL is `http://localhost:8010/api/v1`; interactive API documentation is `http://localhost:8010/docs`. Application startup also applies migrations and initializes seed/background tasks, so database access must be available.

### 4. Install and start the frontend

In a second PowerShell window:

```powershell
Set-Location "D:\shortfundly app\Internship Connection Platform\frontend"
npm ci
$env:VITE_API_BASE_URL = "http://localhost:8010/api/v1"
npm run dev -- --host 127.0.0.1 --port 5174
```

Open `http://localhost:5174`. The frontend `.env.example` points to port 8011, matching Compose; override it for the direct local API on port 8010.

## Repository helper script

`run-app.ps1` provides a specialized local workflow. It assumes Docker containers named `doc-db-1` and `doc-mailpit-1` already exist, activates the repository-root `.venv`, starts the frontend on port 5174, runs Alembic, and starts the backend on port 8010. It also stops an existing local Python/Uvicorn process bound to port 8010. Review the script before using it, especially if other local projects use those containers/ports.

## Environment variables

Configuration is loaded from environment settings and `.env` files. Important variables include:

- Database/security: `DATABASE_URL`, `SECRET_KEY`, `FRONTEND_URL`
- Auth and rate limits: `AUTH_RATE_LIMIT_*`, `RATE_LIMIT_*`, `RATE_LIMIT_BACKEND`, `RATE_LIMIT_REDIS_URL`
- Email: SMTP/Mailpit settings as configured in the environment
- Google: frontend Google client ID and backend provider settings
- Interview Studio: `INTERVIEW_LLM_*`, `INTERVIEW_STT_*`, `INTERVIEW_VIDEO_*`, `INTERVIEW_PROCTORING_*`
- Chatbot/retrieval: `CHATBOT_*`, `RAG_*`, `EMBEDDING_*`, `KB_PATH`
- Frontend: `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`

The full variable names/defaults are listed in `.env.example`, `frontend/.env.example`, Compose, and the settings class. Defaults in examples are for local setup only. Never include secret values in documentation or commits.

## Common troubleshooting

| Symptom | Checks |
|---|---|
| API cannot connect to PostgreSQL | Confirm the DB container is healthy, host port is `55432`, and host-side `DATABASE_URL` uses `localhost`; container-to-container uses `db`. |
| Login/token invalid after restart | Confirm `SECRET_KEY` is stable and identical across API processes; changing it invalidates existing tokens. |
| Browser reports API network/CORS errors | Confirm `VITE_API_BASE_URL`, `FRONTEND_URL`, and actual API port match; local script uses 8010 while Compose uses 8011. |
| Port already in use | Change the Compose host-port variables or stop only the known process using that port. |
| Migrations fail | Inspect the backend error and database version; back up data before manual schema repair. Do not delete the database volume as a troubleshooting shortcut. |
| Google/AI/chatbot feature unavailable | Check that the corresponding client IDs/API keys and provider base URLs are configured and valid; some features intentionally offer unavailable states. |
| Resume/recording upload fails | Verify storage volume/path permissions, supported media/file limits, and browser secure-context/device permissions. |
| First chatbot/interview request is slow | Model/embedding initialization and external provider calls may be involved; check the configured provider and logs without exposing user prompts or secrets. |

## Configuration inconsistencies to know

- `run-app.ps1` uses API port 8010, while Compose and frontend `.env.example` use 8011.
- Compose frontend development maps host 5174 to Vite 5173; production Compose maps host 5175 to Nginx 80.
- CI uses Node 20; the Docker definitions use Node 22.
- The Compose backend has a host source bind mount, so it is not an immutable production image by default.
- Validate the current environment rather than assuming old README commands match the checked-in stack.
