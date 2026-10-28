"""add verified skill assessment storage

Revision ID: 0025_skill_assessments
Revises: 0024_resume_uploaded_at
"""

import json
from pathlib import Path

from alembic import op
import sqlalchemy as sa


revision = "0025_skill_assessments"
down_revision = "0024_resume_uploaded_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "student_profiles",
        sa.Column("show_verified_badges", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.create_table(
        "skill_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("topic", sa.String(length=100), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("correct_index", sa.Integer(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("difficulty", sa.String(length=30), server_default="intermediate", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("topic", "prompt", name="uq_skill_question_topic_prompt"),
    )
    op.create_index("ix_skill_questions_topic", "skill_questions", ["topic"])

    op.create_table(
        "skill_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("topic", sa.String(length=100), nullable=False),
        sa.Column("question_ids", sa.JSON(), nullable=False),
        sa.Column("question_snapshots", sa.JSON(), nullable=False),
        sa.Column("option_orders", sa.JSON(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_skill_attempts_student_id", "skill_attempts", ["student_id"])
    op.create_index("ix_skill_attempts_topic", "skill_attempts", ["topic"])

    op.create_table(
        "skill_badges",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("topic", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("level", sa.String(length=20), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("attempt_id", sa.Integer(), sa.ForeignKey("skill_attempts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("earned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_skill_badges_student_id", "skill_badges", ["student_id"])
    op.create_index("ix_skill_badges_topic", "skill_badges", ["topic"])
    op.create_index("ix_skill_badges_attempt_id", "skill_badges", ["attempt_id"])

    seed_path = Path(__file__).resolve().parents[2] / "app" / "data" / "skill_questions.json"
    with seed_path.open(encoding="utf-8") as seed_file:
        questions = json.load(seed_file)
    question_table = sa.table(
        "skill_questions",
        sa.column("topic", sa.String()),
        sa.column("prompt", sa.Text()),
        sa.column("options", sa.JSON()),
        sa.column("correct_index", sa.Integer()),
        sa.column("explanation", sa.Text()),
        sa.column("difficulty", sa.String()),
        sa.column("active", sa.Boolean()),
    )
    op.bulk_insert(
        question_table,
        [
            {
                **question,
                "active": True,
            }
            for question in questions
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_skill_badges_attempt_id", table_name="skill_badges")
    op.drop_index("ix_skill_badges_topic", table_name="skill_badges")
    op.drop_index("ix_skill_badges_student_id", table_name="skill_badges")
    op.drop_table("skill_badges")
    op.drop_index("ix_skill_attempts_topic", table_name="skill_attempts")
    op.drop_index("ix_skill_attempts_student_id", table_name="skill_attempts")
    op.drop_table("skill_attempts")
    op.drop_index("ix_skill_questions_topic", table_name="skill_questions")
    op.drop_table("skill_questions")
    op.drop_column("student_profiles", "show_verified_badges")
