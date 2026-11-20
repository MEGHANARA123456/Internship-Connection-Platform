from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LearningCategory(Base):
    __tablename__ = "learning_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())


class LearningResource(Base):
    __tablename__ = "learning_resources"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_learning_resources_slug"),
        CheckConstraint(
            "resource_type IN ('link', 'video', 'pdf', 'notes', 'course')",
            name="ck_learning_resources_type",
        ),
        CheckConstraint(
            "level IN ('ALL', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED')",
            name="ck_learning_resources_level",
        ),
        Index(
            "ix_learning_resources_active_verified_category",
            "active",
            "verified_at",
            "category_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("learning_categories.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="ALL")
    role_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    topic_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class LearningPath(Base):
    __tablename__ = "learning_paths"
    __table_args__ = (UniqueConstraint("slug", name="uq_learning_paths_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("learning_categories.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    role_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    topic_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class LearningPathResource(Base):
    __tablename__ = "learning_path_resources"
    __table_args__ = (
        UniqueConstraint(
            "learning_path_id", "position",
            name="uq_learning_path_resources_position",
        ),
        UniqueConstraint(
            "learning_path_id", "resource_id",
            name="uq_learning_path_resources_resource",
        ),
        CheckConstraint("position > 0", name="ck_learning_path_resources_position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learning_path_id: Mapped[int] = mapped_column(
        ForeignKey("learning_paths.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("learning_resources.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class StudentResourceProgress(Base):
    __tablename__ = "student_resource_progress"
    __table_args__ = (
        UniqueConstraint(
            "student_id", "resource_id", name="uq_student_resource_progress"
        ),
        CheckConstraint(
            "status IN ('VIEWED', 'COMPLETED')",
            name="ck_student_resource_progress_status",
        ),
        Index("ix_student_resource_progress_student_status", "student_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("learning_resources.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="VIEWED")
    viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StudentLearningBookmark(Base):
    __tablename__ = "student_bookmarks"
    __table_args__ = (
        UniqueConstraint("student_id", "resource_id", name="uq_student_bookmarks"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("learning_resources.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


class StudentLearningPreference(Base):
    __tablename__ = "student_learning_preferences"

    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    target_role: Mapped[str | None] = mapped_column(String(80), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
