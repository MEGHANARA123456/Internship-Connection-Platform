"""align indexes with current SQLAlchemy metadata

Revision ID: 0012_align_model_indexes
Revises: 0011_company_docs_login
"""

from alembic import op


revision = "0012_align_model_indexes"
down_revision = "0011_company_docs_login"
branch_labels = None
depends_on = None


def _drop_unique(table_name: str, postgres_name: str, sqlite_name: str) -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table(
            table_name,
            naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"},
        ) as batch_op:
            batch_op.drop_constraint(sqlite_name, type_="unique")
    else:
        op.drop_constraint(postgres_name, table_name, type_="unique")


def _create_unique(table_name: str, constraint_name: str, columns: list[str]) -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.create_unique_constraint(constraint_name, columns)
    else:
        op.create_unique_constraint(constraint_name, table_name, columns)


def upgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    _drop_unique("users", "users_email_key", "uq_users_email")

    op.create_index("ix_company_profiles_user_id", "company_profiles", ["user_id"], unique=True)
    _drop_unique("company_profiles", "company_profiles_user_id_key", "uq_company_profiles_user_id")

    op.create_index("ix_student_profiles_user_id", "student_profiles", ["user_id"], unique=True)
    _drop_unique("student_profiles", "student_profiles_user_id_key", "uq_student_profiles_user_id")

    op.drop_index("ix_refresh_tokens_jti", table_name="refresh_tokens")
    op.create_index("ix_refresh_tokens_jti", "refresh_tokens", ["jti"], unique=True)
    _drop_unique("refresh_tokens", "refresh_tokens_jti_key", "uq_refresh_tokens_jti")
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    op.drop_index("ix_email_verification_tokens_token_digest", table_name="email_verification_tokens")
    op.create_index(
        "ix_email_verification_tokens_token_digest",
        "email_verification_tokens",
        ["token_digest"],
        unique=True,
    )
    _drop_unique(
        "email_verification_tokens",
        "email_verification_tokens_token_digest_key",
        "uq_email_verification_tokens_token_digest",
    )

    op.drop_index("ix_resumes_student_id", table_name="resumes")
    op.create_index("ix_resumes_student_id", "resumes", ["student_id"], unique=True)
    _drop_unique("resumes", "resumes_student_id_key", "uq_resumes_student_id")

    op.create_index("ix_applications_status", "applications", ["status"])
    op.create_index("ix_internships_status", "internships", ["status"])


def downgrade() -> None:
    op.drop_index("ix_internships_status", table_name="internships")
    op.drop_index("ix_applications_status", table_name="applications")

    _create_unique("resumes", "resumes_student_id_key", ["student_id"])
    op.drop_index("ix_resumes_student_id", table_name="resumes")
    op.create_index("ix_resumes_student_id", "resumes", ["student_id"])

    _create_unique(
        "email_verification_tokens",
        "email_verification_tokens_token_digest_key",
        ["token_digest"],
    )
    op.drop_index("ix_email_verification_tokens_token_digest", table_name="email_verification_tokens")
    op.create_index("ix_email_verification_tokens_token_digest", "email_verification_tokens", ["token_digest"])

    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    _create_unique("refresh_tokens", "refresh_tokens_jti_key", ["jti"])
    op.drop_index("ix_refresh_tokens_jti", table_name="refresh_tokens")
    op.create_index("ix_refresh_tokens_jti", "refresh_tokens", ["jti"])

    _create_unique("student_profiles", "student_profiles_user_id_key", ["user_id"])
    op.drop_index("ix_student_profiles_user_id", table_name="student_profiles")

    _create_unique("company_profiles", "company_profiles_user_id_key", ["user_id"])
    op.drop_index("ix_company_profiles_user_id", table_name="company_profiles")

    _create_unique("users", "users_email_key", ["email"])
    op.drop_index("ix_users_email", table_name="users")
    op.create_index("ix_users_email", "users", ["email"])
