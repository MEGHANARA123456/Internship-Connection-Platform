"""add student skill gap analysis

Revision ID: 0048_skill_gap_analysis
Revises: 0047_student_learning_library
"""

from alembic import op
import sqlalchemy as sa


revision = "0048_skill_gap_analysis"
down_revision = "0047_student_learning_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("canonical_name", sa.String(length=100), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.UniqueConstraint("canonical_name", name="uq_skills_canonical_name"),
    )
    op.create_table(
        "role_skill_requirements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("role_slug", sa.String(length=80), nullable=False),
        sa.Column("role_label", sa.String(length=120), nullable=False),
        sa.Column(
            "skill_id",
            sa.Integer(),
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requirement_type", sa.String(length=20), nullable=False),
        sa.UniqueConstraint(
            "role_slug", "skill_id", name="uq_role_skill_requirements_role_skill"
        ),
        sa.CheckConstraint(
            "requirement_type IN ('required', 'preferred')",
            name="ck_role_skill_requirements_type",
        ),
    )
    op.create_index(
        "ix_role_skill_requirements_role",
        "role_skill_requirements",
        ["role_slug"],
    )
    op.create_table(
        "skill_gap_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "student_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("target_label", sa.String(length=180), nullable=False),
        sa.Column("estimated_match_score", sa.Integer(), nullable=True),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "target_type IN ('ROLE', 'INTERNSHIP')",
            name="ck_skill_gap_reports_target_type",
        ),
        sa.CheckConstraint(
            "estimated_match_score IS NULL OR "
            "(estimated_match_score >= 0 AND estimated_match_score <= 100)",
            name="ck_skill_gap_reports_score",
        ),
    )
    op.create_index(
        "ix_skill_gap_reports_student_created",
        "skill_gap_reports",
        ["student_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_skill_gap_reports_student_created", table_name="skill_gap_reports")
    op.drop_table("skill_gap_reports")
    op.drop_index("ix_role_skill_requirements_role", table_name="role_skill_requirements")
    op.drop_table("role_skill_requirements")
    op.drop_table("skills")
