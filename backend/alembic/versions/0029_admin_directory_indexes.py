"""indexes for searchable and paginated admin directories

Revision ID: 0029_admin_directory_indexes
Revises: 0028_skill_attempt_resumption
"""

from alembic import op


revision = "0029_admin_directory_indexes"
down_revision = "0028_skill_attempt_resumption"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_users_role_created_id", "users", ["role", "created_at", "id"])
    op.create_index("ix_users_suspended_id", "users", ["suspended_at", "id"])
    op.create_index(
        "ix_student_profiles_university_user",
        "student_profiles",
        ["university", "user_id"],
    )
    op.create_index(
        "ix_student_profiles_grad_year_user",
        "student_profiles",
        ["graduation_year", "user_id"],
    )
    op.create_index(
        "ix_company_profiles_verification_user",
        "company_profiles",
        ["verification_status", "user_id"],
    )
    op.create_index(
        "ix_applications_student_created_id",
        "applications",
        ["student_id", "created_at", "id"],
    )
    op.create_index(
        "ix_skill_badges_student_expires",
        "skill_badges",
        ["student_id", "expires_at"],
    )
    op.create_index(
        "ix_internships_company_created_id",
        "internships",
        ["company_id", "created_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_internships_company_created_id", table_name="internships")
    op.drop_index("ix_skill_badges_student_expires", table_name="skill_badges")
    op.drop_index("ix_applications_student_created_id", table_name="applications")
    op.drop_index(
        "ix_company_profiles_verification_user",
        table_name="company_profiles",
    )
    op.drop_index(
        "ix_student_profiles_grad_year_user",
        table_name="student_profiles",
    )
    op.drop_index(
        "ix_student_profiles_university_user",
        table_name="student_profiles",
    )
    op.drop_index("ix_users_suspended_id", table_name="users")
    op.drop_index("ix_users_role_created_id", table_name="users")
