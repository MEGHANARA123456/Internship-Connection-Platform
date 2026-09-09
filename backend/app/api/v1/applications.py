from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select

from app.api.v1.dependencies import DbSession, get_current_user, require_roles
from app.models import Application, Internship, Notification, Resume, StudentProfile, User, UserRole
from app.services.mail import send_dev_email
from app.schemas.application import ApplicationCreate, ApplicationDashboard, ApplicationResponse, ApplicationStatusUpdate

router = APIRouter(prefix="/applications", tags=["applications"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]
company_only = Annotated[User, Depends(require_roles(UserRole.COMPANY))]

TRANSITIONS = {
    "APPLIED": {"UNDER_REVIEW", "WITHDRAWN"},
    "UNDER_REVIEW": {"SHORTLISTED", "REJECTED", "WITHDRAWN"},
    "SHORTLISTED": {"INTERVIEW_SCHEDULED", "REJECTED", "WITHDRAWN"},
    "INTERVIEW_SCHEDULED": {"SELECTED", "REJECTED"},
    "SELECTED": set(),
    "REJECTED": set(),
    "WITHDRAWN": set(),
}


def application_transition_allowed(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(current, set())


async def serialize(application: Application, db: DbSession) -> dict:
    student = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == application.student_id))
    resume = await db.scalar(select(Resume).where(Resume.student_id == application.student_id))
    internship = await db.scalar(select(Internship).where(Internship.id == application.internship_id))
    return {
        "id": application.id,
        "internship_id": application.internship_id,
        "internship_title": internship.title if internship else None,
        "student_id": application.student_id,
        "status": application.status,
        "cover_note": application.cover_note,
        "created_at": application.created_at,
        "updated_at": application.updated_at,
        "student_name": student.full_name if student else None,
        "student_university": student.university if student else None,
        "student_skills": [skill for skill in (student.skills if student else "").split(",") if skill],
        "resume_id": resume.id if resume else None,
    }


@router.post("/internships/{internship_id}", response_model=ApplicationResponse, status_code=201)
async def apply(internship_id: int, data: ApplicationCreate, user: student_only, db: DbSession) -> dict:
    internship = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.status == "PUBLISHED"))
    if internship is None: raise HTTPException(404, "Internship not found")
    existing = await db.scalar(select(Application).where(Application.internship_id == internship_id, Application.student_id == user.id))
    if existing: raise HTTPException(409, "You have already applied to this internship")
    application = Application(internship_id=internship_id, student_id=user.id, cover_note=data.cover_note)
    db.add(application); await db.commit(); await db.refresh(application)
    return await serialize(application, db)


@router.get("/mine", response_model=ApplicationDashboard)
@router.get("/student", response_model=ApplicationDashboard)
async def student_dashboard(user: student_only, db: DbSession) -> dict:
    applications = list(await db.scalars(select(Application).where(Application.student_id == user.id).order_by(Application.created_at.desc())))
    counts = {name: count for name, count in (await db.execute(select(Application.status, func.count()).where(Application.student_id == user.id).group_by(Application.status))).all()}
    return {"counts": counts, "applications": [await serialize(application, db) for application in applications]}


@router.get("/company", response_model=list[ApplicationResponse])
async def list_all_company_applications(user: company_only, db: DbSession) -> list[dict]:
    applications = await db.scalars(
        select(Application)
        .join(Internship, Application.internship_id == Internship.id)
        .where(Internship.company_id == user.id)
        .order_by(Application.created_at.desc())
    )
    return [await serialize(application, db) for application in applications]


@router.get("/internships/{internship_id}", response_model=list[ApplicationResponse])
async def company_applications(internship_id: int, user: company_only, db: DbSession) -> list[dict]:
    internship = await db.scalar(select(Internship).where(Internship.id == internship_id, Internship.company_id == user.id))
    if internship is None: raise HTTPException(404, "Internship not found")
    applications = await db.scalars(select(Application).where(Application.internship_id == internship_id).order_by(Application.created_at.desc()))
    return [await serialize(application, db) for application in applications]


@router.patch("/{application_id}/status", response_model=ApplicationResponse)
async def update_status(application_id: int, data: ApplicationStatusUpdate, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    application = await db.scalar(select(Application).where(Application.id == application_id))
    if application is None: raise HTTPException(404, "Application not found")
    internship = await db.scalar(select(Internship).where(Internship.id == application.internship_id))
    if internship is None: raise HTTPException(404, "Internship not found")
    if user.role == UserRole.STUDENT:
        if application.student_id != user.id or data.status != "WITHDRAWN": raise HTTPException(403, "Students may only withdraw their own applications")
    elif user.role == UserRole.COMPANY:
        if internship.company_id != user.id or data.status not in {"UNDER_REVIEW", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED", "REJECTED"}: raise HTTPException(403, "Company cannot update this application")
    else: raise HTTPException(403, "Insufficient permissions")
    if not application_transition_allowed(application.status, data.status): raise HTTPException(409, f"Cannot move {application.status} to {data.status}")
    application.status = data.status
    recipient_id = application.student_id if user.role == UserRole.COMPANY else internship.company_id
    recipient = await db.scalar(select(User).where(User.id == recipient_id))
    if recipient:
        title = f"Application status: {data.status.replace('_', ' ').title()}"
        body = f"Your application has moved to {data.status.replace('_', ' ').title()}"
        db.add(Notification(user_id=recipient.id, notification_type="APPLICATION_STATUS", title=title, body=body))
        background_tasks.add_task(send_dev_email, recipient.email, title, body)
        try:
            from app.api.v1.ws import manager
            await manager.send_personal_message(
                recipient.id,
                {
                    "type": "application_status_updated",
                    "application_id": application.id,
                    "status": data.status,
                    "internship_id": application.internship_id,
                    "title": title,
                    "body": body,
                },
            )
        except Exception:
            pass
    await db.commit(); await db.refresh(application)
    return await serialize(application, db)


@router.patch("/{application_id}/review", response_model=ApplicationResponse)
async def mark_under_review(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="UNDER_REVIEW"), background_tasks, user, db)


@router.patch("/{application_id}/shortlist", response_model=ApplicationResponse)
async def mark_shortlist(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="SHORTLISTED"), background_tasks, user, db)


@router.patch("/{application_id}/select", response_model=ApplicationResponse)
async def mark_select(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="SELECTED"), background_tasks, user, db)


@router.patch("/{application_id}/reject", response_model=ApplicationResponse)
async def mark_reject(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="REJECTED"), background_tasks, user, db)


@router.patch("/{application_id}/withdraw", response_model=ApplicationResponse)
async def mark_withdraw(application_id: int, background_tasks: BackgroundTasks, user: Annotated[User, Depends(get_current_user)], db: DbSession) -> dict:
    return await update_status(application_id, ApplicationStatusUpdate(status="WITHDRAWN"), background_tasks, user, db)