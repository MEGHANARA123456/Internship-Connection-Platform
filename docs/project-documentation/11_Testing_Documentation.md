# Testing Documentation

## Test frameworks

### Backend

- `pytest` is declared in `backend/requirements.txt`.
- Tests live in the repository-root `tests/` directory, not `backend/tests/`.
- The suite includes FastAPI client tests, auth/token and MFA tests, domain/API integration tests, migration integrity tests, WebSocket tests, skill/interview tests, and chatbot tests.
- PostgreSQL-specific behavior and live-stack tests may require services/configuration beyond an in-memory unit test.

### Frontend

- Vitest 3 runs tests in the frontend.
- React Testing Library, `user-event`, and jsdom support component and page tests.
- Test files are co-located under `frontend/src/` as `*.test.ts(x)` and include API client, auth store, routes, UI components, analytics, skill assessment, interview studio, admin, and workflow tests.

## Commands

From repository root, backend tests:

```powershell
.\.venv\Scripts\Activate.ps1
$env:MIN_TEST_COUNT = "0"
python -m pytest
```

Target an individual backend file:

```powershell
python -m pytest tests\test_interview_studio.py
```

From `frontend/`:

```powershell
npm ci
npx vitest run
npx vitest run src/pages/interviews
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npm run build
```

The `package.json` scripts are `npm test` (`vitest run`), `npm run lint` (`oxlint`), and `npm run build` (TypeScript project build plus Vite).

## Test organization and examples

- Authentication: `tests/test_auth_tokens.py`, `tests/test_auth_guard.py`, `tests/test_mfa.py`, `tests/test_refresh_reuse.py`.
- Applications and internships: `tests/test_applications.py`, `tests/test_internships.py`, concurrency/reapply/timeline/offer tests.
- Interview Studio: `tests/test_interview_studio.py`, `tests/test_interview_voice.py`, `tests/test_interview_two_categories_migration.py`.
- Skill assessments/topic repair: `tests/test_skill_assessments.py`, `tests/test_admin_skill_topics.py`, `tests/test_skill_topic_repair_migration.py`.
- Chatbot: `tests/chatbot/`.
- Frontend Interview Studio: `frontend/src/pages/interviews/InterviewPages.test.tsx`, `frontend/src/components/interviews/MockTestsLibrary.test.tsx`, `VideoInterviewRoom.test.tsx`, and `VoiceRoom.test.tsx`.
- Frontend auth/API: `frontend/src/api/client.test.ts`, `frontend/src/store/auth.test.ts`, and the login/server-error tests.

## Coverage and limitations

No coverage percentage is documented here because no coverage report was generated during this analysis. The existence of a test module does not prove every branch, integration, or deployment behavior is covered. Tests using external providers, Postgres, Docker, browser device APIs, or email services may require additional setup.

No tests or builds were run as part of this documentation-only task. Historical test results from earlier work sessions are not treated as a current full-suite pass. The auth/session changes present in the worktree require focused validation for refresh, inactivity, WebSocket reconnect, and idempotent interview start.
