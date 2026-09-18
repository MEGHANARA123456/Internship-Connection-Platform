from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.v1.dependencies import DbSession, get_current_user_optional, require_roles
from app.models import Application, CompanyProfile, CompanyReview, Internship, StudentProfile, User, UserRole

router = APIRouter(prefix="/companies", tags=["reviews"])
student_only = Annotated[User, Depends(require_roles(UserRole.STUDENT))]
optional_user = Annotated[User | None, Depends(get_current_user_optional)]


class ReviewCreate(BaseModel):
    internship_id: int
    rating: int = Field(ge=1, le=5, description="Rating from 1 to 5 stars")
    review_text: str = Field(min_length=10, max_length=2000, description="Constructive feedback from intern experience")


class ReviewResponse(BaseModel):
    id: int
    company_id: int
    student_id: int
    internship_id: int
    rating: int
    review_text: str
    created_at: datetime
    student_name: str
    internship_title: str


class CompanyReviewsSummary(BaseModel):
    company_id: int
    average_rating: float
    total_reviews: int
    reviews: list[ReviewResponse]


@router.post("/{company_id}/reviews", response_model=ReviewResponse, status_code=201)
async def submit_company_review(
    company_id: int,
    data: ReviewCreate,
    user: student_only,
    db: DbSession,
) -> dict[str, Any]:
    # Verify company exists
    company = await db.scalar(select(User).where(User.id == company_id, User.role == UserRole.COMPANY))
    if company is None:
        raise HTTPException(404, "Company not found")

    # Verify internship belongs to this company
    internship = await db.scalar(
        select(Internship).where(Internship.id == data.internship_id, Internship.company_id == company_id)
    )
    if internship is None:
        raise HTTPException(404, "Internship does not belong to this company")

    # Verify student was SELECTED for this internship
    application = await db.scalar(
        select(Application).where(
            Application.student_id == user.id,
            Application.internship_id == data.internship_id,
            Application.status == "SELECTED",
        )
    )
    if application is None:
        raise HTTPException(
            403,
            "Only interns who were selected and hired for an internship at this company can submit a verified review.",
        )

    # Check for duplicate review
    existing = await db.scalar(
        select(CompanyReview).where(
            CompanyReview.student_id == user.id,
            CompanyReview.internship_id == data.internship_id,
        )
    )
    if existing:
        raise HTTPException(409, "You have already reviewed this internship experience")

    review = CompanyReview(
        company_id=company_id,
        student_id=user.id,
        internship_id=data.internship_id,
        rating=data.rating,
        review_text=data.review_text.strip(),
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)

    student_prof = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    student_name = student_prof.full_name if student_prof else "Verified Intern"

    return {
        "id": review.id,
        "company_id": review.company_id,
        "student_id": review.student_id,
        "internship_id": review.internship_id,
        "rating": review.rating,
        "review_text": review.review_text,
        "created_at": review.created_at,
        "student_name": student_name,
        "internship_title": internship.title,
    }


@router.get("/{company_id}/reviews", response_model=CompanyReviewsSummary)
async def get_company_reviews(
    company_id: int,
    db: DbSession,
) -> dict[str, Any]:
    company = await db.scalar(select(User).where(User.id == company_id, User.role == UserRole.COMPANY))
    if company is None:
        raise HTTPException(404, "Company not found")

    reviews = list(
        await db.scalars(
            select(CompanyReview)
            .where(CompanyReview.company_id == company_id)
            .order_by(CompanyReview.created_at.desc())
        )
    )

    if not reviews:
        return {
            "company_id": company_id,
            "average_rating": 0.0,
            "total_reviews": 0,
            "reviews": [],
        }

    total_reviews = len(reviews)
    avg_rating = sum(r.rating for r in reviews) / total_reviews

    results = []
    for r in reviews:
        sp = await db.scalar(select(StudentProfile).where(StudentProfile.user_id == r.student_id))
        internship = await db.scalar(select(Internship).where(Internship.id == r.internship_id))
        results.append({
            "id": r.id,
            "company_id": r.company_id,
            "student_id": r.student_id,
            "internship_id": r.internship_id,
            "rating": r.rating,
            "review_text": r.review_text,
            "created_at": r.created_at,
            "student_name": sp.full_name if sp else "Verified Intern",
            "internship_title": internship.title if internship else "Internship",
        })

    return {
        "company_id": company_id,
        "average_rating": round(avg_rating, 1),
        "total_reviews": total_reviews,
        "reviews": results,
    }
