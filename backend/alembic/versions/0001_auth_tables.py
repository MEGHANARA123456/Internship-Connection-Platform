"""add authentication tables

Revision ID: 0001_auth_tables
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_auth_tables"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    user_role = sa.Enum("STUDENT", "COMPANY", "ADMIN", name="userrole")
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("suspended_at", sa.DateTime(timezone=True)),
        sa.Column("verification_token", sa.String(255)),
        sa.Column("reset_token", sa.String(255)),
        sa.Column("reset_token_expires_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("verification_token"),
        sa.UniqueConstraint("reset_token"),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_role", "users", ["role"])
    op.create_table(
        "student_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("university", sa.String(255), nullable=False),
        sa.Column("major", sa.String(255), nullable=False),
        sa.Column("graduation_year", sa.Integer(), nullable=False),
        sa.Column("bio", sa.Text()),
        sa.Column("skills", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("user_id"),
    )
    op.create_table(
        "company_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("company_name", sa.String(255), nullable=False),
        sa.Column("industry", sa.String(255), nullable=False),
        sa.Column("website", sa.String(500)),
        sa.Column("description", sa.Text()),
        sa.Column("verification_status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("jti", sa.String(255), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("jti"),
    )
    op.create_index("ix_refresh_tokens_jti", "refresh_tokens", ["jti"])
    op.create_table("internships", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("company_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("title", sa.String(255), nullable=False), sa.Column("description", sa.Text(), nullable=False), sa.Column("location", sa.String(255), nullable=False), sa.Column("industry", sa.String(255), nullable=False), sa.Column("duration_months", sa.Integer(), nullable=False), sa.Column("stipend", sa.Integer()), sa.Column("work_mode", sa.String(30), nullable=False), sa.Column("skills", sa.Text(), nullable=False, server_default=""), sa.Column("deadline", sa.Date(), nullable=False), sa.Column("status", sa.String(30), nullable=False, server_default="DRAFT"), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_internships_company_id", "internships", ["company_id"])
    op.create_table("applications", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("internship_id", sa.Integer(), sa.ForeignKey("internships.id"), nullable=False), sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("status", sa.String(30), nullable=False, server_default="APPLIED"), sa.Column("cover_note", sa.Text()), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_applications_internship_id", "applications", ["internship_id"])
    op.create_index("ix_applications_student_id", "applications", ["student_id"])
    op.create_table("resumes", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("original_filename", sa.String(255), nullable=False), sa.Column("stored_filename", sa.String(255), nullable=False), sa.Column("content_type", sa.String(100), nullable=False), sa.Column("file_size", sa.Integer(), nullable=False), sa.UniqueConstraint("student_id"), sa.UniqueConstraint("stored_filename"))
    op.create_index("ix_resumes_student_id", "resumes", ["student_id"])
    op.create_table("conversations", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("company_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_conversations_student_id", "conversations", ["student_id"])
    op.create_index("ix_conversations_company_id", "conversations", ["company_id"])
    op.create_table("messages", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id"), nullable=False), sa.Column("sender_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("body", sa.Text(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("read_at", sa.DateTime(timezone=True)))
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_sender_id", "messages", ["sender_id"])
    op.create_table("interviews", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id"), nullable=False), sa.Column("scheduled_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False), sa.Column("interview_type", sa.String(30), nullable=False), sa.Column("meeting_link", sa.String(500)), sa.Column("notes", sa.Text()), sa.Column("status", sa.String(20), nullable=False, server_default="SCHEDULED"))
    op.create_index("ix_interviews_application_id", "interviews", ["application_id"])
    op.create_table("notifications", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("notification_type", sa.String(50), nullable=False), sa.Column("title", sa.String(255), nullable=False), sa.Column("body", sa.Text(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("read_at", sa.DateTime(timezone=True)))
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_table("reports", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("reporter_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False), sa.Column("reported_user_id", sa.Integer(), sa.ForeignKey("users.id")), sa.Column("internship_id", sa.Integer(), sa.ForeignKey("internships.id")), sa.Column("reason", sa.Text(), nullable=False), sa.Column("status", sa.String(20), nullable=False, server_default="OPEN"), sa.Column("resolution_notes", sa.Text()), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_reports_reporter_id", "reports", ["reporter_id"])
    op.create_index("ix_reports_status", "reports", ["status"])


def downgrade() -> None:
    op.drop_index("ix_reports_status", table_name="reports")
    op.drop_index("ix_reports_reporter_id", table_name="reports")
    op.drop_table("reports")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_interviews_application_id", table_name="interviews")
    op.drop_table("interviews")
    op.drop_index("ix_messages_sender_id", table_name="messages")
    op.drop_index("ix_messages_conversation_id", table_name="messages")
    op.drop_table("messages")
    op.drop_index("ix_conversations_company_id", table_name="conversations")
    op.drop_index("ix_conversations_student_id", table_name="conversations")
    op.drop_table("conversations")
    op.drop_index("ix_resumes_student_id", table_name="resumes")
    op.drop_table("resumes")
    op.drop_index("ix_applications_student_id", table_name="applications")
    op.drop_index("ix_applications_internship_id", table_name="applications")
    op.drop_table("applications")
    op.drop_index("ix_internships_company_id", table_name="internships")
    op.drop_table("internships")
    op.drop_index("ix_refresh_tokens_jti", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_table("company_profiles")
    op.drop_table("student_profiles")
    op.drop_index("ix_users_role", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    sa.Enum(name="userrole").drop(op.get_bind(), checkfirst=True)