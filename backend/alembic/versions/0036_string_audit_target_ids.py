"""allow audit targets to use non-numeric keys

Revision ID: 0036_string_audit_target_ids
Revises: 0035_repair_chatbot_knowledge
"""

from alembic import op
import sqlalchemy as sa


revision = "0036_string_audit_target_ids"
down_revision = "0035_repair_chatbot_knowledge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column(
            "audit_logs",
            "target_id",
            existing_type=sa.Integer(),
            type_=sa.String(length=100),
            existing_nullable=True,
            postgresql_using="target_id::text",
        )
    else:
        with op.batch_alter_table("audit_logs") as batch_op:
            batch_op.alter_column(
                "target_id",
                existing_type=sa.Integer(),
                type_=sa.String(length=100),
                existing_nullable=True,
            )


def downgrade() -> None:
    connection = op.get_bind()
    has_non_numeric_ids = connection.execute(
        sa.text(
            "SELECT 1 FROM audit_logs "
            "WHERE target_id IS NOT NULL AND target_id !~ '^[0-9]+$' LIMIT 1"
        )
    ).first() if connection.dialect.name == "postgresql" else connection.execute(
        sa.text(
            "SELECT 1 FROM audit_logs "
            "WHERE target_id IS NOT NULL AND target_id GLOB '*[^0-9]*' LIMIT 1"
        )
    ).first()
    if has_non_numeric_ids:
        raise RuntimeError("Cannot downgrade while audit logs contain non-numeric target IDs.")
    if connection.dialect.name == "postgresql":
        op.alter_column(
            "audit_logs",
            "target_id",
            existing_type=sa.String(length=100),
            type_=sa.Integer(),
            existing_nullable=True,
            postgresql_using="target_id::integer",
        )
    else:
        with op.batch_alter_table("audit_logs") as batch_op:
            batch_op.alter_column(
                "target_id",
                existing_type=sa.String(length=100),
                type_=sa.Integer(),
                existing_nullable=True,
            )
