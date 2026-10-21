"""prevent duplicate applications

Revision ID: 0018_unique_applications
Revises: 0017_refresh_reuse
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_unique_applications"
down_revision = "0017_refresh_reuse"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("applications") as batch_op:
            batch_op.create_unique_constraint(
                "uq_application_student_internship",
                ["student_id", "internship_id"],
            )
    else:
        op.create_unique_constraint(
            "uq_application_student_internship",
            "applications",
            ["student_id", "internship_id"],
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("applications") as batch_op:
            batch_op.drop_constraint(
                "uq_application_student_internship",
                type_="unique",
            )
    else:
        op.drop_constraint(
            "uq_application_student_internship",
            "applications",
            type_="unique",
        )
