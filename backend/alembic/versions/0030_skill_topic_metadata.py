"""persist skill assessment topic metadata

Revision ID: 0030_skill_topic_metadata
Revises: 0029_admin_directory_indexes
"""

import sqlalchemy as sa
from alembic import op


revision = "0030_skill_topic_metadata"
down_revision = "0029_admin_directory_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "skill_topics",
        sa.Column("slug", sa.String(length=100), primary_key=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("icon", sa.String(length=80), nullable=False, server_default="✦"),
        sa.Column("badge_title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    topics = sa.table(
        "skill_topics",
        sa.column("slug", sa.String()),
        sa.column("name", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("icon", sa.String()),
        sa.column("badge_title", sa.String()),
        sa.column("active", sa.Boolean()),
    )
    op.bulk_insert(
        topics,
        [
            {"slug": "python", "name": "Python & Backend Architecture", "description": "Build dependable Python services and backend systems.", "icon": "🐍", "badge_title": "Verified Python Specialist", "active": True},
            {"slug": "react", "name": "React & Modern Frontend", "description": "Create responsive interfaces with modern React.", "icon": "⚛️", "badge_title": "Verified React Pro", "active": True},
            {"slug": "sql", "name": "SQL & Database Design", "description": "Query, model, and reason about relational data.", "icon": "🗄️", "badge_title": "Verified SQL Specialist", "active": True},
            {"slug": "dsa", "name": "Data Structures & Algorithms", "description": "Practice core structures, complexity, and algorithms.", "icon": "🧮", "badge_title": "Verified DSA Problem Solver", "active": True},
            {"slug": "ai", "name": "Machine Learning & AI Engineering", "description": "Explore machine learning concepts and practical AI.", "icon": "🤖", "badge_title": "Verified AI/ML Engineer", "active": True},
            {"slug": "devops", "name": "Cloud, Docker & DevOps", "description": "Understand cloud infrastructure and delivery workflows.", "icon": "☁️", "badge_title": "Verified Cloud & DevOps Specialist", "active": True},
            {"slug": "security", "name": "Web Security & System Design", "description": "Apply secure design principles to web systems.", "icon": "🛡️", "badge_title": "Verified Security & Systems Pro", "active": True},
            {"slug": "typescript", "name": "JavaScript & TypeScript Mastery", "description": "Strengthen typed JavaScript and application design.", "icon": "🔷", "badge_title": "Verified TypeScript Specialist", "active": True},
        ],
    )


def downgrade() -> None:
    op.drop_table("skill_topics")
