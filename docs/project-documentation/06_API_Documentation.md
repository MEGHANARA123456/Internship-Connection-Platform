# API Documentation

## Conventions

- HTTP routes are mounted at `/api/v1`; all paths below include that prefix.
- Unless specified, the successful status is FastAPI's default `200`.
- `STUDENT`, `COMPANY`, and `ADMIN` indicate backend role restrictions. “Authenticated” means any accepted signed-in user, with resource ownership checks where applicable. “Optional” routes permit guests.
- Request bodies are named by their Pydantic schema. Exact fields/limits are in `backend/app/schemas/` and the route source. The running API's `/docs` is the canonical generated OpenAPI reference.
- `route-defined` means the implementation returns a dictionary or response whose shape is not declared as a Pydantic response model.

## Core and authentication

| Method and path | Access | Inputs | Response |
|---|---|---|---|
| `GET /api/v1/health` | Public | — | `dict[str,str]` |
| `GET /api/v1/navigation/counts` | Authenticated | — | `dict[str,int]` |
| `GET /api/v1/student/me` | STUDENT | — | `dict[str,Any]` |
| `GET /api/v1/students/me/nav-counts` | STUDENT | — | `dict[str,int]` |
| `GET /api/v1/company/dashboard` | COMPANY | — | `dict[str,Any]` |
| `GET /api/v1/company/overview` | COMPANY | — | `dict[str,Any]` |
| `GET /api/v1/admin/dashboard` | ADMIN | — | Dashboard dictionary |
| `POST /api/v1/auth/check-email` | Public | `CheckEmailRequest` | Dictionary |
| `POST /api/v1/auth/register/student` | Public | `StudentRegister` | `UserResponse`, **201** |
| `POST /api/v1/auth/register/company` | Public | `CompanyRegister` | `UserResponse`, **201** |
| `POST /api/v1/auth/login` | Public | `LoginRequest` | `TokenResponse` or `MFALoginChallengeResponse` |
| `POST /api/v1/auth/mfa/verify-login` | Public challenge | `MFALoginVerifyRequest` | `TokenResponse` |
| `POST /api/v1/auth/google` | Public | `GoogleAuthRequest` | `TokenResponse` |
| `POST /api/v1/auth/refresh` | Public token exchange | `RefreshRequest` | `TokenResponse` |
| `POST /api/v1/auth/logout` | Authenticated | `LogoutRequest` | Empty, **204** |
| `POST /api/v1/auth/mfa/setup-totp` | Authenticated | — | `MFATotpSetupResponse` |
| `POST /api/v1/auth/mfa/verify-totp` | Authenticated | `MFATotpVerifyRequest` | Dictionary |
| `GET /api/v1/auth/mfa/status` | Authenticated | — | `MFAStatusResponse` |
| `POST /api/v1/auth/mfa/setup-request` | Authenticated | — | `dict[str,str]` |
| `POST /api/v1/auth/mfa/enable` | Authenticated | `MFAEnableRequest` | Dictionary |
| `POST /api/v1/auth/mfa/disable` | Authenticated | `MFADisableRequest` | Dictionary |
| `GET /api/v1/auth/verify/{token}` | Public | Path `token:str` | `dict[str,str]` |
| `POST /api/v1/auth/forgot-password` | Public | `ForgotPasswordRequest` | `dict[str,str]` |
| `POST /api/v1/auth/verify-otp` | Public | `VerifyOtpRequest` | `dict[str,str]` |
| `POST /api/v1/auth/reset-password` | Public | `ResetPasswordRequest` | `dict[str,str]` |
| `POST /api/v1/auth/change-password` | Authenticated | `ChangePasswordRequest` | `dict[str,str]` |
| `POST /api/v1/auth/resend-verification` | Public | `ResendVerificationRequest` | `dict[str,str]` |
| `GET /api/v1/auth/me` | Authenticated | — | User dictionary |

## Profiles and company documents

| Method and path | Access | Inputs | Response |
|---|---|---|---|
| `GET /api/v1/profiles/student` | STUDENT | — | `ProfileResponse` |
| `PUT /api/v1/profiles/student` | STUDENT | `StudentProfileUpdate` | `ProfileResponse` |
| `PUT /api/v1/profiles/student/handles` | STUDENT | `StudentHandlesUpdate` | `ProfileResponse` |
| `DELETE /api/v1/profiles/student` | STUDENT | — | Empty, **204** |
| `GET /api/v1/profiles/company` | COMPANY | — | `ProfileResponse` |
| `PUT /api/v1/profiles/company` | COMPANY | `CompanyProfileUpdate` | `ProfileResponse` |
| `DELETE /api/v1/profiles/company` | COMPANY | — | Empty, **204** |
| `POST /api/v1/profiles/student/resume` | STUDENT | Multipart `file` | Resume record |
| `GET /api/v1/profiles/student/resume` | STUDENT | — | `ResumeResponse` |
| `GET /api/v1/profiles/resume/{resume_id}` | STUDENT/COMPANY | Path `resume_id:int` | `ResumeResponse` |
| `GET /api/v1/profiles/resume/{resume_id}/download` | STUDENT/COMPANY | Path ID | `FileResponse` |
| `DELETE /api/v1/profiles/student/resume/{resume_id}` | STUDENT | Path ID | Empty, **204** |
| `POST /api/v1/profiles/student/resume/parse` | STUDENT | Upload/parse flow | `dict[str,Any]` |
| `POST /api/v1/profiles/student/resume/apply-parsed` | STUDENT | Parsed profile data | `dict[str,Any]` |
| `POST /api/v1/profiles/avatar` | Authenticated | Multipart `file` | `dict[str,str]` |
| `GET /api/v1/profiles/avatar/{filename}` | Public | Path `filename:str` | `FileResponse` |
| `DELETE /api/v1/profiles/avatar` | Authenticated | — | Dictionary |
| `POST /api/v1/profiles/company/documents` | COMPANY | Multipart `document_type`, `file` | No declared model, **201** |
| `GET /api/v1/profiles/company/documents` | COMPANY | — | Route-defined collection |
| `GET /api/v1/profiles/company/documents/{document_id}/download` | COMPANY | Path ID | `FileResponse` |
| `DELETE /api/v1/profiles/company/documents/{document_id}` | COMPANY | Path ID | Empty, **204** |

## Internships and applications

| Method and path | Access | Inputs | Response |
|---|---|---|---|
| `POST /api/v1/internships` | COMPANY | `InternshipInput` | `InternshipResponse`, **201** |
| `GET /api/v1/internships/mine` | COMPANY | — | `list[InternshipResponse]` |
| `GET /api/v1/internships/saved` | STUDENT | Query: `search`, `location`, `industry`, `work_mode`, `min_stipend`, `skills` | `list[InternshipResponse]` |
| `GET /api/v1/internships/saved/summary` | STUDENT | — | `SavedInternshipSummary` |
| `POST /api/v1/internships/{internship_id}/save` | STUDENT | Path ID | Dictionary |
| `DELETE /api/v1/internships/{internship_id}/save` | STUDENT | Path ID | Dictionary |
| `GET /api/v1/internships` | Optional auth | Query: `location`, `industry`, `duration`, `min_stipend`, `max_stipend`, `work_mode`, `search`, `skills`, `posted_after`, `deadline_before`, `sort_by`, `page`, `page_size` | `InternshipPage` |
| `GET /api/v1/internships/{internship_id}` | Optional auth | Path ID | `InternshipResponse` |
| `PUT /api/v1/internships/{internship_id}` | COMPANY | Path ID; `InternshipInput` | `InternshipResponse` |
| `POST /api/v1/internships/{internship_id}/duplicate` | COMPANY | Path ID | `InternshipResponse`, **201** |
| `POST /api/v1/internships/{internship_id}/status` | COMPANY | Path ID; query `target` | `InternshipResponse` |
| `POST /api/v1/internships/{internship_id}/submit` | COMPANY | Path ID | `InternshipResponse` |
| `GET /api/v1/internships/{internship_id}/close-preview` | COMPANY | Path ID | Route-defined dictionary |
| `POST /api/v1/internships/{internship_id}/close` | COMPANY | Path ID; `InternshipCloseRequest` | `InternshipResponse` |
| `POST /api/v1/internships/{internship_id}/review` | COMPANY | Path ID; query `target`, optional `reason` | `InternshipResponse` |
| `DELETE /api/v1/internships/{internship_id}` | COMPANY | Path ID | Empty, **204** |
| `GET /api/v1/applications/eligibility/{internship_id}` | STUDENT | Path ID | Dictionary |
| `POST /api/v1/applications/internships/{internship_id}` | STUDENT | Path ID; `ApplicationCreate` | `ApplicationResponse`, **201** |
| `GET /api/v1/applications/{application_id}/timeline` | STUDENT/COMPANY | Path ID | Dictionary |
| `GET /api/v1/applications/mine` | STUDENT | Query `status`, `search` | `ApplicationDashboard` |
| `GET /api/v1/applications/student` | STUDENT | Query `status`, `search` | `ApplicationDashboard` |
| `GET /api/v1/applications/company` | COMPANY | — | `list[ApplicationResponse]` |
| `GET /api/v1/applications/company/search` | COMPANY | Query `status`, `internship_id`, `search`, `date_from`, `created`, `skills`, `education`, `applicant_filter`, `verified_skill`, `sort`, `page`, `page_size` | Route-defined |
| `GET /api/v1/applications/internships/{internship_id}` | COMPANY | Path ID | `list[ApplicationResponse]` |
| `POST /api/v1/applications/{application_id}/viewed` | COMPANY | Path ID | Dictionary |
| `GET /api/v1/applications/{application_id}/tracking` | STUDENT/COMPANY | Path ID | Dictionary |
| `POST /api/v1/applications/bulk-status` | COMPANY | `BulkApplicationStatusUpdate` | `BulkApplicationStatusResponse` |
| `PATCH /api/v1/applications/{application_id}/status` | COMPANY | Path ID; `ApplicationStatusUpdate` | `ApplicationResponse` |
| `PATCH /api/v1/applications/{application_id}/review` | COMPANY | Path ID | `ApplicationResponse` |
| `PATCH /api/v1/applications/{application_id}/shortlist` | COMPANY | Path ID | `ApplicationResponse` |
| `PATCH /api/v1/applications/{application_id}/select` | COMPANY | Path ID | `ApplicationResponse` |
| `PATCH /api/v1/applications/{application_id}/reject` | COMPANY | Path ID | `ApplicationResponse` |
| `PATCH /api/v1/applications/{application_id}/withdraw` | STUDENT | Path ID | `ApplicationResponse` |
| `POST /api/v1/applications/{application_id}/accept-offer` | STUDENT | Path ID; `OfferAcceptance` | `ApplicationResponse` |

## Communication, interviews, and notifications

| Method and path | Access | Inputs | Response |
|---|---|---|---|
| `POST /api/v1/conversations/with/{other_user_id}` | STUDENT/COMPANY | Path ID | `dict[str,int]`, **201** |
| `POST /api/v1/conversations` | STUDENT/COMPANY | `ConversationCreate` | `dict[str,int]`, **201** |
| `GET /api/v1/contacts` | STUDENT/COMPANY | — | `list[dict]` |
| `GET /api/v1/contacts/recommended` | STUDENT/COMPANY | — | `list[dict]` |
| `GET /api/v1/conversations` | STUDENT/COMPANY | — | `list[dict]` |
| `GET /api/v1/conversations/{conversation_id}/messages` | STUDENT/COMPANY | Path ID | `list[MessageResponse]` |
| `POST /api/v1/conversations/{conversation_id}/messages` | STUDENT/COMPANY | Path ID; `MessageCreate` | `MessageResponse`, **201** |
| `POST /api/v1/applications/{application_id}/interviews` | STUDENT/COMPANY | Path ID; `InterviewCreate` | `InterviewResponse`, **201** |
| `GET /api/v1/applications/{application_id}/interviews` | STUDENT/COMPANY | Path ID | `list[InterviewResponse]` |
| `GET /api/v1/applications/{application_id}/notes` | STUDENT/COMPANY | Path ID | `list[ApplicationNoteResponse]` |
| `POST /api/v1/applications/{application_id}/notes` | STUDENT/COMPANY | Path ID; `ApplicationNoteCreate` | `ApplicationNoteResponse`, **201** |
| `GET /api/v1/interviews/my` | Authenticated | — | `list[InterviewResponse]` |
| `GET /api/v1/interviews` | Authenticated | — | `list[InterviewResponse]` |
| `GET /api/v1/company/interviews` | COMPANY | — | Route-defined |
| `PATCH /api/v1/interviews/{interview_id}` | STUDENT/COMPANY | Path ID; `InterviewUpdate` | `InterviewResponse` |
| `PATCH /api/v1/interviews/{interview_id}/feedback` | STUDENT/COMPANY | Path ID; `InterviewFeedbackUpdate` | `InterviewFeedbackResponse` |
| `GET /api/v1/notifications` | Authenticated | — | `list[NotificationResponse]` |
| `PATCH /api/v1/interviews/invites/read` | Authenticated | — | Empty, **204** |
| `POST /api/v1/notifications/read-all` | Authenticated | — | Empty, **204** |
| `PATCH /api/v1/notifications/read-all` | Authenticated | — | Empty, **204** |
| `POST /api/v1/notifications/{notification_id}/read` | Authenticated | Path ID | Empty, **204** |
| `PATCH /api/v1/notifications/{notification_id}/read` | Authenticated | Path ID | Empty, **204** |

## AI, reports, reviews, search, analytics, insights, privacy, mailbox

| Method and path | Access | Inputs | Response |
|---|---|---|---|
| `GET /api/v1/ai/internships/{internship_id}/ats-score` | STUDENT | Path ID | Dictionary |
| `POST /api/v1/ai/internships/{internship_id}/generate-pitch` | STUDENT | Path ID | Dictionary |
| `GET /api/v1/ai/internships/{internship_id}/mock-interview` | STUDENT | Path ID | Dictionary |
| `POST /api/v1/ai/mock-interview/evaluate` | STUDENT | `EvaluateAnswerRequest` | Dictionary |
| `POST /api/v1/reports` | Authenticated | `ReportCreate` | `ReportResponse`, **201** |
| `POST /api/v1/companies/{company_id}/reviews` | STUDENT | Path ID; `ReviewCreate` | `ReviewResponse`, **201** |
| `GET /api/v1/companies/{company_id}/reviews` | Public | Path ID | `CompanyReviewsSummary` |
| `GET /api/v1/search/suggest` | Public | Query `q` | Route-defined |
| `GET /api/v1/search` | Public | Query `q` | Route-defined |
| `GET /api/v1/analytics/public-summary` | Public | — | Dictionary |
| `GET /api/v1/analytics/company/performance` | COMPANY | Query `range` | Route-defined |
| `GET /api/v1/analytics/student/insights` | STUDENT | Query `range` | Route-defined |
| `GET /api/v1/analytics/overview` | Authenticated | Query `range` | Route-defined |
| `GET /api/v1/analytics/admin/user-growth` | ADMIN | Query `range` | `list[UserGrowthPoint]` |
| `GET /api/v1/analytics/admin/application-funnel-by-company` | ADMIN | Query `range` | `list[FunnelByCompany]` |
| `GET /api/v1/analytics/admin/top-companies` | ADMIN | Query `range` | `list[TopCompanyItem]` |
| `GET /api/v1/analytics/admin/admin-action-volume` | ADMIN | Query `range` | `list[AdminActionVolume]` |
| `GET /api/v1/students/me/insights` | STUDENT | Query `range` | Route-defined |
| `GET /api/v1/analytics/dashboard` | Authenticated | Query `range` | Route-defined |
| `GET /api/v1/companies/me/insights` | COMPANY | Query `range` | Route-defined |
| `GET /api/v1/companies/me/metrics` | COMPANY | Query `range` | Route-defined |
| `GET /api/v1/admin/insights` | ADMIN | Query `range` | Route-defined |
| `GET /api/v1/privacy/compliance-info` | Public | — | `dict[str,Any]` |
| `GET /api/v1/privacy/preferences` | Authenticated | — | `dict[str,Any]` |
| `PUT /api/v1/privacy/preferences` | Authenticated | Route-defined preferences | `dict[str,Any]` |
| `POST /api/v1/privacy/ccpa-opt-out` | Authenticated | Route-defined opt-out | `dict[str,Any]` |
| `GET /api/v1/privacy/export` | Authenticated | — | `dict[str,Any]` |
| `POST /api/v1/privacy/delete-account` | Authenticated | Route-defined deletion | `dict[str,Any]` |
| `GET /api/v1/me/emails` | Authenticated | — | `list[dict]` |
| `GET /api/v1/emails/{email_id}` | Authenticated | Path ID | Dictionary |
| `GET /api/v1/mailbox/my` | Authenticated (legacy) | — | `list[dict]` |

## Administration

Every `/admin` route below requires `ADMIN`.

| Method and path | Inputs | Response |
|---|---|---|
| `GET /api/v1/admin/users` | Query `search`, `role`, `include_suspended`, `created` | `list[UserAdminResponse]` |
| `GET /api/v1/admin/students` | Query `q`, `verified`, `suspended`, `graduation_year`, `university`, `created`, `sort`, `order`, `page`, `page_size` | `AdminPage[AdminStudentListItem]` |
| `GET /api/v1/admin/students/{user_id}` | Path ID | `AdminStudentDetail` |
| `POST /api/v1/admin/admins` | `AdminCreate` | `UserAdminResponse`, **201** |
| `GET /api/v1/admin/users/{user_id}` | Path ID | `UserDetailResponse` |
| `DELETE /api/v1/admin/users/{user_id}` | Path ID; `AdminUserDeletionRequest` | Dictionary |
| `POST /api/v1/admin/users/{user_id}/suspend` | Path ID | `UserAdminResponse` |
| `POST /api/v1/admin/users/{user_id}/reactivate` | Path ID | `UserAdminResponse` |
| `GET /api/v1/admin/companies/{user_id}/documents` | Path ID | `list[dict]` |
| `GET /api/v1/admin/companies/{user_id}/documents/{document_id}/download` | Path IDs | `FileResponse` |
| `GET /api/v1/admin/verifications` | — | `list[dict]` |
| `GET /api/v1/admin/companies/unverified` | — | `list[dict]` |
| `GET /api/v1/admin/companies` | Query `q`, `search`, `verification_status`, `created`, `sort`, `order`, `page`, `page_size` | Admin page or list |
| `GET /api/v1/admin/companies/{user_id}` | Path ID | `AdminCompanyDetail` |
| `POST /api/v1/admin/companies/{user_id}/verification` | Path ID; `ModerationStatus` | Dictionary |
| `GET /api/v1/admin/companies/{company_user_id}/postings` | Path ID; query `status` | `list[dict]` |
| `POST /api/v1/admin/companies/{company_user_id}/postings/{internship_id}/moderate` | Path IDs; `ModerationStatus` | Dictionary |
| `GET /api/v1/admin/internships` | Query `status` | `list[dict]` |
| `POST /api/v1/admin/internships/{internship_id}/moderate` | Path ID; `ModerationStatus` | Dictionary |
| `POST /api/v1/admin/internships/{internship_id}/moderation` | Path ID; `ModerationStatus` | Dictionary |
| `GET /api/v1/admin/reports` | Query `status` | `list[ReportResponse]` |
| `PATCH /api/v1/admin/reports/{report_id}` | Path ID; `ReportUpdate` | `ReportResponse` |
| `GET /api/v1/admin/audit-logs` | Query `page`, `page_size`, `actor`, `action`, `target_type`, `target_id`, `search_target`, `date_from`, `date_to`, `range` | `PaginatedAuditLogs` |

### Admin Interview Studio

All routes require `ADMIN`.

| Method and path | Inputs | Response |
|---|---|---|
| `GET /api/v1/admin/interview-studio/questions` | Query `category`, `difficulty`, `active`, `q`, `page`, `page_size` | Service-defined |
| `POST /api/v1/admin/interview-studio/questions` | Admin question schema | Service-defined, **201** |
| `PATCH /api/v1/admin/interview-studio/questions/{question_id}` | Path ID; update schema | Service-defined |
| `POST /api/v1/admin/interview-studio/questions/{question_id}/approve` | Path ID | Service-defined |
| `POST /api/v1/admin/interview-studio/questions/import` | Import payload or multipart | Service-defined |
| `GET /api/v1/admin/interview-studio/tests` | Query `category`, `active`, `q` | Service-defined |
| `POST /api/v1/admin/interview-studio/tests` | Test create schema | Service-defined, **201** |
| `PUT /api/v1/admin/interview-studio/tests/{test_id}` | Path ID; update schema | Service-defined |
| `GET /api/v1/admin/interview-studio/taxonomy` | — | `dict[str,list[dict[str,Any]]]` |
| `POST /api/v1/admin/interview-studio/taxonomy/categories` | Category schema | Service-defined, **201** |
| `PATCH /api/v1/admin/interview-studio/taxonomy/categories/{category_id}` | Path ID; update schema | Service-defined |
| `PATCH /api/v1/admin/interview-studio/taxonomy/difficulties/{code}` | Path code; update schema | Service-defined |
| `GET /api/v1/admin/interview-studio/settings` | — | `dict[str,Any]` |
| `PATCH /api/v1/admin/interview-studio/settings` | Settings schema | `dict[str,Any]` |
| `GET /api/v1/admin/interview-studio/analytics` | Query `range` | Service-defined |
| `GET /api/v1/admin/interview-studio/failures` | — | Service-defined |
| `POST /api/v1/admin/interview-studio/failures/retry` | Route-defined | Service-defined |
| `GET /api/v1/admin/interview-studio/audit` | Query `page`, `page_size` | Service-defined |

## Interview Studio student APIs

All routes require `STUDENT`, with additional ownership checks on individual sessions.

| Method and path | Inputs | Response |
|---|---|---|
| `GET /api/v1/interviews/mock-tests/recommendation` | — | `MockTestRecommendationView` |
| `GET /api/v1/interviews/mock-tests` | Query `category`, `difficulty`, `format` | `list[MockTestView]` |
| `POST /api/v1/interviews/mock-tests/{test_id}/attempts` | Path ID; `MockTestAttemptCreate` | `InterviewSessionView` |
| `GET /api/v1/interviews/mock-tests/{test_id}/attempts` | Path ID | `list[MockTestAttemptSummary]` |
| `POST /api/v1/interviews/mock-tests/{test_id}/compare` | Path ID; `MockTestComparisonRequest` | `MockTestComparisonView` |
| `GET /api/v1/interviews/mock-tests/{test_id}` | Path ID | `MockTestDetailView` |
| `POST /api/v1/interviews/sessions` | `InterviewSessionCreate` | `InterviewSessionView` |
| `GET /api/v1/interviews/sessions` | — | `list[InterviewSessionView]` |
| `GET /api/v1/interviews/sessions/{session_id}` | Path ID | Session dictionary |
| `GET /api/v1/interviews/sessions/{session_id}/answers` | Path ID | `list[InterviewAnswerRecord]` |
| `POST /api/v1/interviews/sessions/{session_id}/proctoring-consent` | Path ID | `InterviewSessionView` |
| `POST /api/v1/interviews/sessions/{session_id}/proctoring-events` | Path ID; `InterviewProctoringEventCreate` | `InterviewProctoringEventResult` |
| `POST /api/v1/interviews/sessions/{session_id}/start` | Path ID | `InterviewSessionView` |
| `POST /api/v1/interviews/sessions/{session_id}/next-question` | Path ID | `InterviewNextQuestionView` |
| `POST /api/v1/interviews/sessions/{session_id}/answers` | Path ID; `InterviewAnswerSubmit` | `InterviewAnswerView` |
| `POST /api/v1/interviews/sessions/{session_id}/audio` | Query `question_id`; multipart `audio` | `InterviewAudioTranscriptView` |
| `GET /api/v1/interviews/sessions/{session_id}/recordings` | Path ID | `InterviewVideoRecordingState` |
| `POST /api/v1/interviews/sessions/{session_id}/recordings/consent` | Path ID; `InterviewRecordingConsentRequest` | `InterviewRecordingConsentView` |
| `POST /api/v1/interviews/sessions/{session_id}/recordings` | Path ID | `InterviewRecordingView` |
| `POST /api/v1/interviews/sessions/{session_id}/recordings/{recording_id}/chunks` | Path IDs; `chunk_index`; multipart `chunk` | `InterviewVideoChunkResult` |
| `POST /api/v1/interviews/sessions/{session_id}/recordings/{recording_id}/finalize` | Path IDs | `InterviewRecordingView` |
| `GET /api/v1/interviews/sessions/{session_id}/recordings/{recording_id}/content` | Path IDs | `StreamingResponse` |
| `DELETE /api/v1/interviews/sessions/{session_id}/recordings/{recording_id}` | Path IDs | Empty |
| `POST /api/v1/interviews/sessions/{session_id}/complete` | Path ID | `InterviewReportView` |
| `GET /api/v1/interviews/sessions/{session_id}/report` | Path ID | `InterviewReportView` |
| `POST /api/v1/interviews/sessions/{session_id}/evaluation/retry` | Path ID | `Any` |
| `DELETE /api/v1/interviews/sessions/{session_id}` | Path ID | Empty |
| `GET /api/v1/interview-sessions/{session_id}/answers` | STUDENT; legacy path ID | `list[InterviewAnswerRecord]` |
| `POST /api/v1/interview-sessions/{session_id}/proctoring-events` | STUDENT; `InterviewProctoringEventCreate` | `InterviewProctoringEventResult` |

## Skills

Student routes require `STUDENT`; admin routes require `ADMIN`.

| Method and path | Inputs | Response |
|---|---|---|
| `GET /api/v1/skills/topics` | — | `list[dict[str,Any]]` |
| `POST /api/v1/skills/assessments/start` | `AssessmentStart` | Dictionary |
| `GET /api/v1/skills/assessments/active` | Query `topic` | Dictionary or null |
| `PUT /api/v1/skills/attempts/{attempt_id}/answers` | Path ID; `AssessmentAnswers` | Dictionary |
| `POST /api/v1/skills/assessments/{attempt_id}/submit` | Path ID; `AssessmentSubmit` | Dictionary |
| `GET /api/v1/skills/assessments/{attempt_id}/result` | Path ID | Dictionary |
| `GET /api/v1/skills/assessments/{attempt_id}/report.pdf` | Path ID | `StreamingResponse` |
| `GET /api/v1/skills/history` | — | Dictionary |
| `GET /api/v1/skills/badges` | — | Dictionary |
| `GET /api/v1/skills/attempts` | — | Dictionary |
| `GET /api/v1/skills/admin/questions` | Query `topic`, `topic_id`, `active` | Route-defined |
| `GET /api/v1/skills/admin/questions/key-review` | — | Route-defined |
| `GET /api/v1/skills/admin/questions/key-audit` | — | `StreamingResponse` |
| `POST /api/v1/skills/admin/questions/{question_id}/key-review` | Path ID; `SkillQuestionKeyReview` | Route-defined |
| `POST /api/v1/skills/admin/questions` | `SkillQuestionCreate` | Route-defined, **201** |
| `PATCH /api/v1/skills/admin/questions/{question_id}` | Path ID; `SkillQuestionUpdate` | Route-defined |
| `DELETE /api/v1/skills/admin/questions/{question_id}` | Path ID | Empty, **204** |
| `GET /api/v1/skills/admin/questions/import/template` | Query `format`, `topic_id` | `StreamingResponse` |
| `POST /api/v1/skills/admin/questions/import` | Query `partial`, `topic_id`; multipart `file` | Route-defined |
| `GET /api/v1/skills/admin/resources` | Query `topic_id` | Route-defined |
| `POST /api/v1/skills/admin/resources` | `SkillLearningResourceCreate` | Route-defined, **201** |
| `PATCH /api/v1/skills/admin/resources/{resource_id}` | Path ID; `SkillLearningResourceUpdate` | Route-defined |
| `DELETE /api/v1/skills/admin/resources/{resource_id}` | Path ID | Empty, **204** |
| `GET /api/v1/skills/admin/stats` | Query `topic_id` | Route-defined |
| `GET /api/v1/skills/admin/topics` | Query `topic_id`, `include_archived` | Route-defined |
| `GET /api/v1/skills/admin/skill-topics` | Query `include_archived` | Route-defined |
| `GET /api/v1/skills/admin/skill-topics/{topic}/subtopics` | Path topic | Route-defined |
| `GET /api/v1/skills/admin/skill-topics/{topic}/impact` | Path topic | `dict[str,int]` |
| `POST /api/v1/skills/admin/skill-topics` | `SkillTopicCreate` | Route-defined, **201** |
| `PATCH /api/v1/skills/admin/topics/{topic}` | Path topic; `SkillTopicUpdate` | Route-defined |
| `POST /api/v1/skills/admin/skill-topics/{topic}/archive` | Path topic | Route-defined |
| `POST /api/v1/skills/admin/skill-topics/{topic}/restore` | Path topic | Route-defined |
| `GET /api/v1/skills/admin/skill-topics/{topic}/history` | Path topic | Route-defined |
| `DELETE /api/v1/skills/admin/skill-topics/{topic}` | Path topic | Route-defined |
| `GET /api/v1/skills/admin/topics/{topic}` | Path topic; query `topic_id` | Route-defined |
| `GET /api/v1/skills/admin/topics/{topic}/attempts` | Path topic; query `topic_id`, `page`, `page_size`, `status` | Route-defined |
| `GET /api/v1/skills/admin/attempts/{attempt_id}` | Path ID; query `topic_id` | Route-defined |

## Chatbot and WebSockets

| Method/path | Access | Inputs | Response |
|---|---|---|---|
| `POST /api/v1/chatbot/ask` | Optional auth | `ChatAskRequest` | `ChatAskResponse` |
| `GET /api/v1/chatbot/status` | Optional auth | — | Dictionary |
| `POST /api/v1/chatbot/reindex` | ADMIN | — | `dict[str,int]` |
| `POST /api/v1/chatbot/feedback` | Authenticated | `ChatFeedbackRequest` | Empty, **204** |
| `WS /api/v1/ws/chat/{user_id}` | Bearer; participant identity checked | Path ID; handler-defined JSON protocol | JSON WebSocket events |
| `WS /api/v1/ws/video-signal/{interview_id}` | Bearer; ownership/active-interview checks | Path ID; signalling JSON | JSON WebSocket events |

## Common errors and example

Depending on route, invalid input commonly produces `422`, missing/invalid authentication `401`, insufficient role `403`, absent resources `404`, and business-state conflicts `409`. Routes may define additional errors.

Example request (credentials redacted):

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{"email":"student@example.test","password":"<redacted>"}
```

Login returns `TokenResponse` or an MFA challenge. Never put real passwords, tokens, refresh tokens, or provider keys in logs or documentation.
