# Frontend integration assumptions

- Company registration uses the existing `POST /auth/register/company` JSON endpoint. Once the account is created, the wizard signs in with the submitted credentials through `POST /auth/login`, stores the returned session, then uploads documents via authenticated `POST /profiles/company/documents`.
- The company document upload uses multipart fields `file` and `document_type`. Supported types are `BUSINESS_REGISTRATION`, `GST_OR_PAN`, `AUTHORIZATION_LETTER`, and `OTHER`; the browser enforces PDF/JPG/PNG and a 5 MB maximum. Business registration is required for initial wizard submission.
- Company profile document APIs are `GET /profiles/company/documents`, `POST /profiles/company/documents`, and `DELETE /profiles/company/documents/{document_id}`. GET returns a list or an object containing `documents`/`items`; upload and delete responses are expected to provide document metadata (including `id`, type, filename, and review status). The company profile response may include `verification_note`.
- Admin verifications are loaded from `GET /admin/verifications`. Document metadata can be nested as `verification_documents` or `documents`; it may include a protected `download_url`/`file_url`, or an id for the authenticated `GET /admin/companies/{user_id}/documents/{document_id}/download` fallback. Date display prefers `uploaded_at`, then document `created_at`, then company `created_at`.
- Reject submissions call `POST /admin/companies/{user_id}/verification` with `{ status: "REJECTED", reason }`; this endpoint already accepts the optional reason field.
- The first-login demo mail prompt uses the API's `is_first_login` login response flag, only for company accounts when `VITE_DEMO_MODE=true`. Configure the demo inbox URL with `VITE_MAILPIT_URL`; it defaults to the local demo inbox.

The existing registration response does not issue a session. If the subsequent login or a document upload fails, the wizard keeps the created-account state and selected files, offers a retry without repeating registration, and skips files already successfully uploaded.

## Removed product surfaces

There is no college placement dashboard or institution placement-statistics API. There is also no student or public faculty/mentor endorsement flow or endorsement API. Unknown frontend paths fall through to the application catch-all, and calls to the removed API paths return 404. Student university/profile data, institutional-email validation, education fields in resumes, and recommended internships remain supported.
