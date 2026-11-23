# Frontend Documentation

## Structure

The SPA is under `frontend/`. `src/App.tsx` mounts the application; `src/lib/routes.ts` declares routes; `src/pages/` contains pages; `src/components/` contains reusable UI; `src/api/client.ts` configures Axios; `src/services/` wraps domain APIs; `src/store/` contains Zustand stores; `src/hooks/` contains reusable hooks; `src/chatbot/` contains chatbot client/UI logic.

## Routes and access

`ProtectedRoute` preserves an unauthenticated destination using `next`; disallowed roles receive an account-unavailable view.

| Route(s) | Access | Purpose |
|---|---|---|
| `/` | Public | Landing page. |
| `/dashboard` | Authenticated | Redirect by role. |
| `/login`, `/register-student`, `/register-company` | Public | Authentication and registration. |
| `/forgot-password`, `/reset-password`, `/verify`, `/verify/:token` | Public | Recovery and verification. |
| `/opportunities`, `/opportunities/:id` | Public browse; actions gated | Internship discovery/detail. |
| `/saved`, `/applications`, `/applications/:id` | Student | Saved opportunities and applications/timeline. |
| `/profile`, `/profile/student` | Student | Student profile/resume. |
| `/student/analytics` | Student | Analytics and insights. |
| `/skills/history`, `/skills/results/:attemptId` | Student | Assessment history/results. |
| `/interview-studio`, `/interview-studio/setup`, `/interview-studio/session/:sessionId`, `/interview-studio/report/:sessionId`, `/interview-studio/history` | Student | Interview setup, session, report, history. |
| `/company`, `/company/dashboard` | Company | Company overview. |
| `/company/jobs`, `/company/jobs/:id`, `/company/jobs/:id/applicants`, `/company/internships/new`, `/company/internships/:id/edit` | Company | Listings and applicants. |
| `/company/applicants`, `/company/pipeline`, `/company/shortlisted`, `/company/analytics`, `/company/settings`, `/profile/company` | Company | Hiring, analytics, profile/settings. |
| `/interviews`, `/messages` | Student or company | Interviews and messaging. |
| `/notifications` | Student/company/admin | Notifications. |
| `/admin`, `/admin/users`, `/admin/verifications`, `/admin/moderation`, `/admin/reports` | Admin | Administration. |
| `/admin/students`, `/admin/students/:userId`, `/admin/companies`, `/admin/companies/:userId`, `/admin/companies/:companyId/postings`, `/admin/audit-logs` | Admin | Directory, detail, postings, audit. |
| `/admin/skill-assessments`, `/admin/interview-studio` | Admin | Content management. |
| `/privacy`, `/privacy-policy`, `/privacy-security`, `/privacy-center`, `/settings/privacy` | Public page or authenticated data actions | Privacy controls/information. |
| `*` | Public | Not found. |

## Main role workflows

- **Students:** browse/search internships; save/apply/track; manage profile and resume; take skills assessments; complete practice interviews; use messages, scheduled interviews, notifications, analytics, and privacy/security tools.
- **Companies:** manage listings and company profile/documents; search applicants; update hiring stages; add notes; schedule interviews; communicate; view analytics.
- **Administrators:** manage users, companies, verification, postings, reports, audit logs, skills content, and Interview Studio.
- **Guests:** view landing/public opportunity pages and use registration/sign-in.

## State, APIs, forms, and error handling

Zustand stores auth, theme, and view mode. Most pages use local React state and direct API calls; TanStack Query is selective. The Axios client attaches tokens, handles refresh/retry behavior, and exposes errors. Interview APIs are wrapped by `src/services/interviewService.ts`.

Forms use Zod/React Hook Form in selected pages and inline validation elsewhere. Upload controls enforce client-side file constraints (student resumes: PDF/DOC/DOCX up to 5 MB; company documents: PDF/JPG/PNG up to 5 MB), with backend validation still required. Errors appear as field messages, alerts, toasts, modal states, or retry controls.

## Responsive behavior and integrations

Tailwind responsive classes, role-specific navigation, mobile/table layouts, and a mobile preview simulator support different screen sizes. The theme store supports light/dark/system. Browser integrations include Google sign-in, notifications, speech recognition, camera/microphone/MediaRecorder, WebRTC signalling, GitHub profile lookup, and calendar/email links; browser permissions and provider settings apply.

## Important files

- Routes: `src/App.tsx`, `src/lib/routes.ts`
- API/auth: `src/api/client.ts`, `src/pages/AuthPages.tsx`, `src/store/auth.ts`
- Student/company/admin pages: `src/pages/StudentPages.tsx`, `CompanyPages.tsx`, `AdminPages.tsx`
- Interview Studio: `src/pages/interviews/`, `src/services/interviewService.ts`
- Chat and communications: `src/pages/CommunicationPages.tsx`, `src/lib/useWebSocketChat.ts`
- Analytics/chatbot: `src/components/analytics/`, `src/chatbot/`
