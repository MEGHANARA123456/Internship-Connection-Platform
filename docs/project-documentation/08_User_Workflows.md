# User Workflows

This chapter describes workflows present in the frontend and backend source. Provider-dependent paths are identified as conditional.

## Registration, login, and account security

1. A guest opens `/register-student` or `/register-company` and enters role-specific details.
2. The React form validates the data and posts to `POST /api/v1/auth/register/student` or `/company`.
3. FastAPI validates the registration schema, hashes the password, creates the user/profile, and initiates verification where configured.
4. The user verifies an email using the public verification route and then signs in through `POST /api/v1/auth/login`.
5. If MFA is enabled, login returns a challenge; the UI submits the MFA response to `/auth/mfa/verify-login`.
6. Successful login initializes the frontend auth store and routes the user to the correct role experience.
7. Subsequent requests use the shared Axios client and bearer token; `POST /api/v1/auth/refresh` exchanges refresh state when needed. Logout calls `/auth/logout` and clears frontend session state.
8. Account settings expose password change and MFA setup/enable/disable flows.

The UI also offers Google sign-in when browser scripts and its client ID are configured. Forgot/reset password and resend-verification use the corresponding `/auth` routes.

## Student opportunity and application workflow

1. The student browses `/opportunities`, filters/searches, and opens an internship.
2. The frontend calls `GET /api/v1/internships` and `GET /api/v1/internships/{internship_id}`; public browsing may be unauthenticated.
3. A signed-in student can save/unsave an internship using `POST`/`DELETE /api/v1/internships/{id}/save`.
4. Before applying, the frontend checks `GET /api/v1/applications/eligibility/{internship_id}` and may request an AI pitch.
5. The student submits `ApplicationCreate` to `POST /api/v1/applications/internships/{internship_id}`. The backend enforces uniqueness and eligibility and persists the application.
6. The student views applications through `/applications/mine` or `/applications/student`, opens a timeline/tracking view, and may withdraw or accept an offer.
7. Status, notification, event, and timeline rows reflect subsequent recruiter actions.
8. A student may submit a company review after the applicable workflow allows it.

## Student profile and resume

1. The student opens `/profile` and edits their profile, handles, and skills.
2. Frontend validation checks required fields; the API uses profile update schemas and ownership-scoped routes.
3. Resume upload sends multipart data to `POST /api/v1/profiles/student/resume`; the backend stores metadata and the uploaded file.
4. The student can list, download, delete, parse, or apply parsed profile details using student resume endpoints.
5. Public/profile presentation is subject to account authorization and verified-badge preferences.

## Company listing and hiring

1. The company completes its company profile and, where required, uploads verification documents.
2. It creates a draft listing using `POST /api/v1/internships`, edits using `PUT`, and submits or changes status using the listing workflow endpoints.
3. Admin moderation/verification may affect discoverability or company status.
4. The company views applications, search results, and applicant details through `/api/v1/applications/company`, `/company/search`, and `/internships/{id}`-scoped routes.
5. The company advances candidates through status/review/shortlist/select/reject endpoints, can make bulk status changes, and records notes.
6. Company and student participants communicate through conversation/message routes and may schedule an interview under an application.
7. Interview reminders/notifications and status updates are reflected in the UI.

## Skills assessment

1. A student selects an active topic and begins with `POST /api/v1/skills/assessments/start`.
2. The backend creates an attempt snapshot of questions/options and tracks attempt timing.
3. The frontend submits answers through `PUT /api/v1/skills/attempts/{attempt_id}/answers`.
4. Submission finalizes the attempt via `POST /api/v1/skills/assessments/{attempt_id}/submit`.
5. Results, history, badges, and PDF reports are read from the corresponding `/skills` endpoints.
6. Administrators manage topics, questions, learning resources, imports, and review data through the admin skill routes.

The attempt snapshot means edits to the question bank do not retroactively alter an already-created assessment.

## AI Interview Studio

1. A student opens `/interview-studio`, selects a mock test or starts a new interview, then chooses allowed setup options.
2. The frontend creates a session through the mock-test attempt or session-creation API.
3. It starts the session, requests the next question, and submits an answer for each question. Question content is served through session routes rather than the student mock-test detail payload.
4. In video mode, browser camera/microphone permissions and speech features are subject to device/browser support. Answer text remains editable; audio/video recording requires the recording consent/flow.
5. The student completes the session and opens the generated report. History and retake flows use the session ID and preserve historical records.
6. Evaluations/question generation depend on provider settings; failure states may leave a report/evaluation pending or failed and expose a retry path.
7. Administrators manage question bank entries, tests, taxonomy, settings, usage/failures, and audit records through `/admin/interview-studio`.

The codebase includes interview question generation and evaluation provider integrations; provider availability is not guaranteed by the UI. See the Interview Studio models and API tables for exact persisted entities and routes.

## Messaging, interviews, and notifications

1. Student/company pages load contacts and conversations over REST.
2. A conversation is opened or created; messages are sent/read using `/conversations` APIs.
3. The frontend connects to `/api/v1/ws/chat/{user_id}` for live events; the server verifies the token and participant identity.
4. Scheduled interviews are created under an application, then listed and updated through `/interviews` routes.
5. Notification list/read actions use `/notifications` routes, with live updates possible via WebSocket.

## Chatbot

1. A page-aware chatbot UI checks `/api/v1/chatbot/status`.
2. It sends a question/context payload to `/api/v1/chatbot/ask`.
3. The backend applies role/audience handling and available retrieval/provider logic, then returns an answer and any supported metadata/citations.
4. Authenticated users can send feedback. Administrators may trigger knowledge reindexing.
5. If providers or the index are unavailable, the UI presents its implemented disabled/offline/fallback state.

## Administrator workflows

- **User management:** search user/student/company directories, inspect details, suspend/reactivate/delete users.
- **Company verification:** review documents and set verification decisions.
- **Listing moderation:** review postings and update moderation state.
- **Reports:** review and update user-submitted reports.
- **Audit:** inspect filtered/paginated audit records.
- **Skill assessments:** manage topics, questions, imports, resources, and key review.
- **Interview Studio:** manage questions/tests/taxonomy/settings and inspect analytics/failures/audit.

Each admin page calls the corresponding `/api/v1/admin/...` endpoints and requires admin authorization server-side; frontend route guards are not the only security boundary.

## Privacy and account lifecycle

1. A visitor can read public compliance information.
2. An authenticated user reads or updates preferences and may request export, opt-out, or account deletion.
3. The frontend asks for explicit confirmation for destructive deletion.
4. The backend checks identity/confirmation, applies the operation, and returns a status/result. Actual retention and deletion behavior should be checked against the privacy service and deployment policy.

## Error and retry behavior

Forms surface field validation errors, while API errors appear as inline messages, toasts, or retry states. Token refresh is handled by the shared client; provider-dependent operations can fail independently of application persistence. Upload limits, browser permissions, network conditions, and ownership checks may prevent an otherwise visible workflow from completing.
