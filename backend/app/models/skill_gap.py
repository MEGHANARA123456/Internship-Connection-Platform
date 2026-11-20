from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Skill(Base):
    __tablename__ = "skills"
    __table_args__ = (
        UniqueConstraint("canonical_name", name="uq_skills_canonical_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    canonical_name: Mapped[str] = mapped_column(String(100), nullable=False)
    aliases: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)


class RoleSkillRequirement(Base):
    __tablename__ = "role_skill_requirements"
    __table_args__ = (
        UniqueConstraint("role_slug", "skill_id", name="uq_role_skill_requirements_role_skill"),
        Index("ix_role_skill_requirements_role", "role_slug"),
        CheckConstraint(
            "requirement_type IN ('required', 'preferred')",
            name="ck_role_skill_requirements_type",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_slug: Mapped[str] = mapped_column(String(80), nullable=False)
    role_label: Mapped[str] = mapped_column(String(120), nullable=False)
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    requirement_type: Mapped[str] = mapped_column(String(20), nullable=False)


class SkillGapReport(Base):
    __tablename__ = "skill_gap_reports"
    __table_args__ = (
        Index("ix_skill_gap_reports_student_created", "student_id", "created_at"),
        CheckConstraint(
            "target_type IN ('ROLE', 'INTERNSHIP')",
            name="ck_skill_gap_reports_target_type",
        ),
        CheckConstraint(
            "estimated_match_score IS NULL OR "
            "(estimated_match_score >= 0 AND estimated_match_score <= 100)",
            name="ck_skill_gap_reports_score",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_label: Mapped[str] = mapped_column(String(180), nullable=False)
    estimated_match_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
