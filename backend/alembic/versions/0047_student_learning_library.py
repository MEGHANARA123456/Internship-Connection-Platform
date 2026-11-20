"""add student learning library and paths

Revision ID: 0047_student_learning_library
Revises: 0046_interview_admin_management
"""

from alembic import op
import sqlalchemy as sa


revision = "0047_student_learning_library"
down_revision = "0046_interview_admin_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=80), nullable=False, unique=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "learning_resources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("learning_categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("resource_type", sa.String(length=20), nullable=False),
        sa.Column("level", sa.String(length=20), nullable=False, server_default="ALL"),
        sa.Column("role_tags", sa.JSON(), nullable=False),
        sa.Column("topic_tags", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("slug", name="uq_learning_resources_slug"),
        sa.CheckConstraint(
            "resource_type IN ('link', 'video', 'pdf', 'notes', 'course')",
            name="ck_learning_resources_type",
        ),
        sa.CheckConstraint(
            "level IN ('ALL', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED')",
            name="ck_learning_resources_level",
        ),
    )
    op.create_index(
        "ix_learning_resources_active_verified_category",
        "learning_resources",
        ["active", "verified_at", "category_id"],
    )
    op.create_table(
        "learning_paths",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("learning_categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("role_tags", sa.JSON(), nullable=False),
        sa.Column("topic_tags", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("slug", name="uq_learning_paths_slug"),
    )
    op.create_table(
        "learning_path_resources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "learning_path_id",
            sa.Integer(),
            sa.ForeignKey("learning_paths.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resource_id",
            sa.Integer(),
            sa.ForeignKey("learning_resources.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "learning_path_id", "position",
            name="uq_learning_path_resources_position",
        ),
        sa.UniqueConstraint(
            "learning_path_id", "resource_id",
            name="uq_learning_path_resources_resource",
        ),
        sa.CheckConstraint("position > 0", name="ck_learning_path_resources_position"),
    )
    op.create_index(
        "ix_learning_path_resources_learning_path_id",
        "learning_path_resources",
        ["learning_path_id"],
    )
    op.create_index(
        "ix_learning_path_resources_resource_id",
        "learning_path_resources",
        ["resource_id"],
    )
    op.create_table(
        "student_resource_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "student_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resource_id",
            sa.Integer(),
            sa.ForeignKey("learning_resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column(
            "viewed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "student_id", "resource_id", name="uq_student_resource_progress"
        ),
        sa.CheckConstraint(
            "status IN ('VIEWED', 'COMPLETED')",
            name="ck_student_resource_progress_status",
        ),
    )
    op.create_index(
        "ix_student_resource_progress_student_status",
        "student_resource_progress",
        ["student_id", "status"],
    )
    op.create_table(
        "student_bookmarks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "student_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resource_id",
            sa.Integer(),
            sa.ForeignKey("learning_resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("student_id", "resource_id", name="uq_student_bookmarks"),
    )
    op.create_table(
        "student_learning_preferences",
        sa.Column(
            "student_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("target_role", sa.String(length=80), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("student_learning_preferences")
    op.drop_table("student_bookmarks")
    op.drop_index(
        "ix_student_resource_progress_student_status",
        table_name="student_resource_progress",
    )
    op.drop_table("student_resource_progress")
    op.drop_index(
        "ix_learning_path_resources_resource_id",
        table_name="learning_path_resources",
    )
    op.drop_index(
        "ix_learning_path_resources_learning_path_id",
        table_name="learning_path_resources",
    )
    op.drop_table("learning_path_resources")
    op.drop_table("learning_paths")
    op.drop_index(
        "ix_learning_resources_active_verified_category",
        table_name="learning_resources",
    )
    op.drop_table("learning_resources")
    op.drop_table("learning_categories")
