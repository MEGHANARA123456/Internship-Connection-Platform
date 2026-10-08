"""add company verification documents and first login tracking

Revision ID: 0011_company_documents_first_login
Revises: 0010_clean_interview_links
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_company_documents_first_login"
down_revision = "0010_clean_interview_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "company_profiles",
        sa.Column("verification_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("first_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "company_documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("document_type", sa.String(length=40), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("stored_filename"),
    )
    op.create_index("ix_company_documents_company_id", "company_documents", ["company_id"])
    op.create_index("ix_company_documents_document_type", "company_documents", ["document_type"])


def downgrade() -> None:
    op.drop_index("ix_company_documents_document_type", table_name="company_documents")
    op.drop_index("ix_company_documents_company_id", table_name="company_documents")
    op.drop_table("company_documents")
    op.drop_column("users", "first_login_at")
    op.drop_column("company_profiles", "verification_note")
