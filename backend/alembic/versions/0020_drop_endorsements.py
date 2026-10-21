"""Remove the endorsement feature table.

Revision ID: 0020_drop_endorsements
Revises: 0019_internship_closed_at
"""

from alembic import op
import sqlalchemy as sa


revision = "0020_drop_endorsements"
down_revision = "0019_internship_closed_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_endorsements_token_digest"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_endorsements_student_status"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_endorsements_status"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_endorsements_student_id"))
    op.execute(sa.text("DROP TABLE IF EXISTS endorsements"))


def downgrade() -> None:
    op.create_table(
        "endorsements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("referrer_name", sa.String(length=255), nullable=False),
        sa.Column("referrer_email", sa.String(length=254), nullable=False),
        sa.Column("referrer_title", sa.String(length=255), nullable=False),
        sa.Column("organization", sa.String(length=255), nullable=True),
        sa.Column("request_message", sa.Text(), nullable=True),
        sa.Column("endorsement_text", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index("ix_endorsements_student_id", "endorsements", ["student_id"])
    op.create_index("ix_endorsements_status", "endorsements", ["status"])
    op.create_index(
        "ix_endorsements_student_status",
        "endorsements",
        ["student_id", "status"],
    )
