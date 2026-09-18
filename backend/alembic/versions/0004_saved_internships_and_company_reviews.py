"""add saved_internships and company_reviews

Revision ID: 0004_saved_internships_and_reviews
Revises: 0003_email_messages
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_saved_and_reviews"
down_revision = "0003_email_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_internships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("internship_id", sa.Integer(), sa.ForeignKey("internships.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("student_id", "internship_id", name="uq_saved_internship"),
    )
    op.create_index("ix_saved_internships_student_id", "saved_internships", ["student_id"])
    op.create_index("ix_saved_internships_internship_id", "saved_internships", ["internship_id"])

    op.create_table(
        "company_reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("internship_id", sa.Integer(), sa.ForeignKey("internships.id"), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("review_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("student_id", "internship_id", name="uq_company_review"),
    )
    op.create_index("ix_company_reviews_company_id", "company_reviews", ["company_id"])
    op.create_index("ix_company_reviews_student_id", "company_reviews", ["student_id"])
    op.create_index("ix_company_reviews_internship_id", "company_reviews", ["internship_id"])


def downgrade() -> None:
    op.drop_index("ix_company_reviews_internship_id", table_name="company_reviews")
    op.drop_index("ix_company_reviews_student_id", table_name="company_reviews")
    op.drop_index("ix_company_reviews_company_id", table_name="company_reviews")
    op.drop_table("company_reviews")

    op.drop_index("ix_saved_internships_internship_id", table_name="saved_internships")
    op.drop_index("ix_saved_internships_student_id", table_name="saved_internships")
    op.drop_table("saved_internships")
