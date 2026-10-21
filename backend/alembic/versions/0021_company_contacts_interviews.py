"""Add company contact details, private notes, and interview outcomes/reminders."""

from alembic import op
import sqlalchemy as sa


revision = "0021_company_contacts_interviews"
down_revision = "0020_drop_endorsements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("company_profiles", sa.Column("company_size", sa.String(length=40), nullable=True))
    op.add_column("company_profiles", sa.Column("location", sa.String(length=255), nullable=True))
    op.add_column("company_profiles", sa.Column("recruiter_contact_name", sa.String(length=255), nullable=True))
    op.add_column("company_profiles", sa.Column("recruiter_contact_phone", sa.String(length=40), nullable=True))
    op.add_column("company_profiles", sa.Column("recruiter_contact_email", sa.String(length=255), nullable=True))

    op.add_column("interviews", sa.Column("result", sa.String(length=20), nullable=True))
    op.add_column("interviews", sa.Column("rating", sa.Integer(), nullable=True))
    op.add_column("interviews", sa.Column("feedback", sa.Text(), nullable=True))
    op.add_column("interviews", sa.Column("feedback_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("interviews", sa.Column("change_reason", sa.Text(), nullable=True))
    op.add_column("interviews", sa.Column("reminder_24h_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("interviews", sa.Column("reminder_1h_sent_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "application_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_application_notes_application_id", "application_notes", ["application_id"])
    op.create_index("ix_application_notes_author_user_id", "application_notes", ["author_user_id"])
    op.create_index("ix_application_notes_created_at", "application_notes", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_application_notes_created_at", table_name="application_notes")
    op.drop_index("ix_application_notes_author_user_id", table_name="application_notes")
    op.drop_index("ix_application_notes_application_id", table_name="application_notes")
    op.drop_table("application_notes")
    op.drop_column("interviews", "reminder_1h_sent_at")
    op.drop_column("interviews", "reminder_24h_sent_at")
    op.drop_column("interviews", "change_reason")
    op.drop_column("interviews", "feedback_at")
    op.drop_column("interviews", "feedback")
    op.drop_column("interviews", "rating")
    op.drop_column("interviews", "result")
    op.drop_column("company_profiles", "recruiter_contact_email")
    op.drop_column("company_profiles", "recruiter_contact_phone")
    op.drop_column("company_profiles", "recruiter_contact_name")
    op.drop_column("company_profiles", "location")
    op.drop_column("company_profiles", "company_size")
