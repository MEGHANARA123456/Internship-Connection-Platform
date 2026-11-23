# Future Enhancements

Recommendations below are not claims of existing functionality.

## Product and workflow improvements

- Add a guided student learning library/resource workflow backed by the migration-created learning tables, or remove unused schema through a separately planned migration if the feature is not intended.
- Complete student skill-gap reports using the existing schema, with transparent scoring explanations and freshness indicators.
- Improve recruiter collaboration, candidate feedback templates, and interview scheduling coordination.
- Add configurable notification preferences and a unified notification history.
- Improve operational guidance for provider failures and distinguish unavailable provider from temporary network/provider errors.

## Engineering and maintainability

- Standardize API response and error envelopes and generate a typed frontend API client from the FastAPI OpenAPI schema.
- Consolidate duplicated route behavior and legacy compatibility endpoints behind explicit deprecation/versioning.
- Align SQLAlchemy models, migrations, and model exports; decide whether migration-only tables are active and map them where needed.
- Reduce direct route-level business logic by consistently extracting service functions.
- Add service-level contract tests for AI providers, mail, storage, and external APIs with deterministic mocks.
- Add explicit database connection-pool, request timeout, and resource lifecycle observability.

## Security and privacy

- Audit refresh-token storage/rotation, multi-tab refresh behavior, CSRF implications, and XSS exposure.
- Consider moving refresh credentials to secure HttpOnly/SameSite cookies, with appropriate CSRF protection and a documented browser deployment model.
- Verify MFA recovery, OTP replay prevention, email enumeration, and password-reset token invalidation.
- Use centralized secret management and enforce stable `SECRET_KEY` across replicas.
- Apply server-side per-route rate limits and abuse monitoring, particularly for auth, public search, AI calls, uploads, and chat.
- Review upload malware scanning, storage isolation, signed/authorized download behavior, retention, and deletion verification.
- Document retention/legal basis for interview recordings, transcripts, assessment answers, and chatbot logs; provide data minimization/deletion controls.
- Add dependency scanning, static analysis, and security tests in CI.

## Reliability and scalability

- Move background reminders, expiry, email, and retention work to a durable task queue with retries and idempotency if throughput requires it.
- Add structured logs, metrics, tracing, redaction, alerting, and provider health dashboards.
- Replace in-memory rate limiting with a shared distributed backend for multi-worker deployments.
- Review startup-time migrations and seeds for multi-replica deployment; run schema migration as a controlled release step.
- Add pagination and query performance/index review for high-volume tables and analytics.
- Use object storage for resumes/recordings at scale, with lifecycle policies and encryption.
- Verify WebSocket scale-out (shared pub/sub/presence) and reconnect behavior across replicas.

## UX and accessibility

- Perform a WCAG-oriented accessibility audit of navigation, dialogs, charts, forms, keyboard focus, and screen-reader status announcements.
- Run cross-browser, device, and responsive visual regression tests rather than relying only on jsdom.
- Provide clearer AI-generated content provenance and user controls around AI evaluation.
- Add localization and timezone-aware display for dates/interviews.

## Deployment and documentation

- Resolve local/Compose/production API port defaults and Node version differences.
- Remove localhost-only CSP/API values from production defaults and bind production containers to explicit trusted hosts.
- Separate development Compose configuration (hot reload and source bind mounts) from immutable production images.
- Document supported environment variables in one generated reference with no secret values.
- Add CI for migration tests against PostgreSQL, full frontend/backend suites, build/lint, and deployment configuration checks.
