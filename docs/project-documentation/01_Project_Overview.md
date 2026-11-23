# Project Overview

## Introduction and purpose

Internship Connection Platform is a browser-based internship marketplace and hiring workflow system. It connects students looking for internships with companies recruiting interns, and provides administrators with moderation and platform-management tools. Student preparation features include skill assessments and an AI-assisted interview studio.

The application aims to consolidate opportunity discovery, candidate profile/resume management, applications, hiring communication, and interview preparation into one role-aware platform.

## Problem statement

Students need a reliable way to discover suitable openings, present qualifications, submit applications, and track decisions. Employers need a structured way to publish openings and review candidates. Separate informal channels make these processes hard to follow, and students often lack practical tools to prepare before interviews.

## Objectives

- Provide public internship discovery and student application workflows.
- Help companies manage listings, candidates, and hiring stages.
- Support messaging and interview scheduling between students and companies.
- Provide skills assessments and interview practice.
- Enable administrators to moderate users, postings, reports, and content.
- Provide account security, privacy, notifications, and analytics features.

## Target users

| Role | Main capabilities |
|---|---|
| Guest | Browse public opportunities, register, sign in, and read public information. |
| Student | Manage profile/resume, search/save/apply for internships, track applications, take assessments, practice interviews, and communicate with companies. |
| Company/recruiter | Manage company profile and listings, review applicants, coordinate interviews, and monitor hiring activity. |
| Administrator | Manage users, verification, listings/moderation, reports, audit activity, and assessment/interview content. |

Backend dependencies enforce roles; frontend guards provide route-level UX but are not the security boundary.

## Key features and advantages

- Role-specific React experience with matching backend API authorization.
- Internship search, save, apply, status tracking, offer handling, and reviews.
- Company listings, applicant pipeline, messaging, notes, and interviews.
- Resume/document workflows and student profile support.
- Skills assessments with history, results, badges, and PDF output.
- Interview Studio sessions, mock tests, reports, and optional recording/proctoring flows.
- Admin tools, analytics, notifications, privacy controls, and chatbot assistance.
- Typed frontend/backend schemas, relational persistence, migrations, and Docker setup.

## Scope and limitations

The repository includes provider integrations, but source code does not prove that the current deployment has working credentials or external services. Google sign-in, email, AI generation/evaluation, speech transcription, chatbot retrieval, Redis, and browser media depend on configuration or runtime support. Some historical migration-created tables have no ORM mappings; see [Database Documentation](./07_Database_Documentation.md).

## Key source locations

- Backend entrypoint: `backend/app/main.py`
- API router registration: `backend/app/api/v1/router.py`
- Frontend routes: `frontend/src/App.tsx`, `frontend/src/lib/routes.ts`
- Backend models/schemas/services: `backend/app/models/`, `backend/app/schemas/`, `backend/app/services/`
- Existing repository notes: `docs/README.md`
