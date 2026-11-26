# Render deployment readiness

This guide targets a Render Docker web service, a Render static site, and PostgreSQL. It does not deploy anything. The current live Drive check cannot create files: the service account receives `storageQuotaExceeded` when writing to the configured My Drive folder. Set up a Shared Drive, grant the service account a role that can create and delete files, and use a folder ID from that Shared Drive before enabling the service.

## Asset and recording storage

Resumes, company verification documents, and avatars use `STORAGE_BACKEND=local|s3`. Local is the development default; set `s3` in production and configure `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_REGION`. S3 objects are private: resumes and company documents are streamed only after authorization, while avatar requests redirect to a five-minute signed URL. Keep public bucket access and public ACLs disabled.

Interview recordings have a separate selector, `INTERVIEW_VIDEO_STORAGE_BACKEND=local|gdrive`, and continue using their existing recording pipeline. This separation allows profile assets to use S3 while recordings use Google Drive. Legacy `STORAGE_BACKEND=gdrive` configurations continue to select Drive for recordings and local storage for profile assets until explicitly changed.

The interview evaluation queue and recording retention/deletion metadata are database-backed. Startup recovers stuck evaluations and uploads, and the worker loops resume processing after a restart or wake. A recording whose only assembled copy was on ephemeral disk at the moment of a restart may need to be recorded again. Chat WebSockets authenticate with a message frame rather than a token in the URL and reconnect with capped exponential backoff. Video chunk requests default to 5 MiB, plus multipart overhead, below common proxy request limits.

## 1. Prepare durable services

1. Create a Render PostgreSQL database in the same region as the API. Use a plan with a retention period suitable for your data; do not use a time-limited free database for production.
2. Create a Render web service from this repository using `render.yaml`, or configure the services manually:
   - API: Docker runtime, Dockerfile `backend/Dockerfile`, build context repository root, health path `/health`.
   - Frontend: static site, build command `cd frontend && npm ci && npm run build`, publish directory `frontend/dist`.
3. Configure the static site's rewrite route `/*` to `/index.html`. This keeps client-side routes such as `/interview-studio` working after refresh.
4. Add the environment variables from `.env.production.example` in the Render dashboard. Substitute placeholders there; never put credentials in the repository or deployment YAML.
5. Set `DATABASE_URL` to the PostgreSQL connection string. The backend accepts standard PostgreSQL URLs and translates `sslmode` to asyncpg's `ssl` parameter.
6. Generate a unique `SECRET_KEY` of at least 32 characters. Keep it stable across restarts and instances.

## 2. Configure API and frontend

1. Set `ENVIRONMENT=production`, `DEBUG=false`, `FRONTEND_URL`, and `CORS_ALLOWED_ORIGINS`. The origins must be comma-separated HTTPS origins with no wildcard.
2. Set `VITE_API_URL` to the API origin plus `/api/v1`, and `VITE_WS_URL` to the same API path using `wss://`. These are build-time values; changing them requires rebuilding the static site.
3. Add provider keys only in the backend service's secret environment settings. Configure `LLM_PROVIDERS`, provider-specific models and limits, legacy interview evaluation settings, and STT settings as required.
4. Set `STORAGE_BACKEND=s3` and configure the private bucket's S3-compatible endpoint, bucket, access key, secret key, and region. For Cloudflare R2, use the account endpoint and `auto` region. Keep bucket-level public access disabled.
5. Set `INTERVIEW_VIDEO_STORAGE_BACKEND=gdrive` to retain Drive recordings. Use a Render secret file for `GOOGLE_SERVICE_ACCOUNT_JSON` or store base64 JSON in the secret setting; set `GDRIVE_FOLDER_ID` to a folder on the Shared Drive. Set it to `local` only if ephemeral recording loss is acceptable.
6. Configure `VIDEO_RETENTION_DAYS`, `VIDEO_MAX_MB`, `VIDEO_MAX_SECONDS`, and `INTERVIEW_VIDEO_MAX_CHUNK_BYTES` to match product policy and proxy limits.
7. For production traffic, prefer a shared rate-limit backend such as Redis rather than the in-memory limiter. Keep a single API instance if using `RATE_LIMIT_BACKEND=memory`.

## 3. Deploy and verify

1. Build the API image and confirm startup runs `alembic upgrade head` before Uvicorn. The FastAPI lifespan also verifies the schema and resumes durable workers.
2. Wait for `/health` to return `200 {"status":"ok"}`. It executes `SELECT 1`; database failure returns `503`.
3. Confirm `/docs`, `/redoc`, and `/openapi.json` are disabled in production, and that HTTP origins are rejected by CORS.
4. Run `python scripts/check_drive.py` from a deployment environment with the Drive secrets configured. It uploads a 1 MiB test object to `mock/test/test`, validates a byte range and size, then deletes the object.
5. Test a mock and a regular AI Studio recording, playback, deletion, and retention expiry. Restart the API while an evaluation is queued and confirm it resumes from the database.
6. Check a chat WebSocket reconnects after the service sleeps or restarts, then confirm normal HTTPS API requests still work.

## 4. Security and persistence checks

- Production startup rejects a missing/default/short `SECRET_KEY`, debug mode, wildcard CORS, and non-HTTPS frontend/CORS origins.
- Bearer tokens are sent over HTTPS; the browser does not put long-lived tokens in WebSocket URLs.
- OpenAPI documentation is disabled in production.
- The Docker context excludes `.env` files and local storage directories. Never add credential JSON or `.env` files to Git.
- Render free services can sleep and have ephemeral disks. Configure S3 before migrating existing assets or deploying; local storage remains suitable only for development.

## Migrate existing profile assets

Before switching production traffic, take and verify both a database backup and a copy of the `RESUME_STORAGE_PATH`, `COMPANY_DOCUMENT_STORAGE_PATH`, and avatars directory. Set `STORAGE_BACKEND=s3` and its credentials, apply Alembic migrations, then run `python scripts/migrate_profile_assets.py --backend s3 --backup-confirmed`. The migration script is resumable: it copies and size-checks each object, commits the backend/key update per row, then removes the original from the configured local storage. Do not delete the separate local backup until downloads and avatar loading have been checked from the deployed app.
