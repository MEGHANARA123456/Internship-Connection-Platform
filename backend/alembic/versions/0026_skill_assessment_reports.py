"""expand assessments with weighted scoring and feedback data

Revision ID: 0026_skill_assessment_reports
Revises: 0025_skill_assessments
"""

import json
from pathlib import Path

from alembic import op
import sqlalchemy as sa


revision = "0026_skill_assessment_reports"
down_revision = "0025_skill_assessments"
branch_labels = None
depends_on = None


def _level(score: float) -> str:
    if score >= 80:
        return "Advanced"
    if score >= 60:
        return "Intermediate"
    return "Beginner"


def upgrade() -> None:
    op.add_column(
        "skill_questions",
        sa.Column("correct_answers", sa.JSON(), nullable=True),
    )
    op.add_column(
        "skill_questions",
        sa.Column("subtopic", sa.String(length=100), server_default="fundamentals", nullable=False),
    )
    op.add_column(
        "skill_questions",
        sa.Column("question_type", sa.String(length=20), server_default="SINGLE", nullable=False),
    )
    op.add_column(
        "skill_questions",
        sa.Column("source", sa.String(length=500), server_default="InternSphere curated assessment bank", nullable=False),
    )
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE skill_questions SET difficulty = 'MEDIUM'"))

    op.add_column("skill_attempts", sa.Column("raw_score", sa.Float(), nullable=True))
    op.add_column("skill_attempts", sa.Column("weighted_percentage", sa.Float(), nullable=True))
    op.add_column("skill_attempts", sa.Column("level", sa.String(length=20), nullable=True))
    op.add_column("skill_attempts", sa.Column("time_taken_seconds", sa.Integer(), nullable=True))
    op.add_column(
        "skill_attempts",
        sa.Column("attempt_number", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column("skill_attempts", sa.Column("question_time_seconds", sa.JSON(), nullable=True))
    op.add_column("skill_attempts", sa.Column("subtopic_scores", sa.JSON(), nullable=True))
    op.add_column("skill_attempts", sa.Column("difficulty_scores", sa.JSON(), nullable=True))
    op.add_column("skill_attempts", sa.Column("percentile", sa.Float(), nullable=True))

    attempts = sa.Table(
        "skill_attempts",
        sa.MetaData(),
        sa.Column("id", sa.Integer()),
        sa.Column("student_id", sa.Integer()),
        sa.Column("topic", sa.String()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("score", sa.Integer()),
        sa.Column("question_ids", sa.JSON()),
    )
    attempt_numbers: dict[tuple[int, str], int] = {}
    for attempt in bind.execute(
        sa.select(attempts.c.id, attempts.c.student_id, attempts.c.topic, attempts.c.started_at,
                  attempts.c.score, attempts.c.question_ids)
        .order_by(attempts.c.student_id, attempts.c.topic, attempts.c.started_at, attempts.c.id)
    ):
        key = (attempt.student_id, attempt.topic)
        attempt_numbers[key] = attempt_numbers.get(key, 0) + 1
        score = float(attempt.score or 0)
        raw_score = round(score * len(attempt.question_ids or []) / 100, 2)
        bind.execute(
            sa.text(
                "UPDATE skill_attempts SET raw_score = :raw_score, "
                "weighted_percentage = :score, level = :level, attempt_number = :number "
                "WHERE id = :id"
            ),
            {
                "raw_score": raw_score,
                "score": score,
                "level": _level(score),
                "number": attempt_numbers[key],
                "id": attempt.id,
            },
        )

    bind.execute(
        sa.text(
            "UPDATE skill_badges SET level = CASE "
            "WHEN score >= 80 THEN 'Advanced' "
            "WHEN score >= 60 THEN 'Intermediate' ELSE 'Beginner' END"
        )
    )

    op.create_table(
        "skill_learning_resources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("topic", sa.String(length=100), nullable=False),
        sa.Column("subtopic", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("topic", "subtopic", "url", name="uq_skill_learning_resource_url"),
    )
    op.create_index("ix_skill_learning_resources_topic", "skill_learning_resources", ["topic"])
    op.create_index("ix_skill_learning_resources_subtopic", "skill_learning_resources", ["subtopic"])

    additions_path = Path(__file__).resolve().parents[2] / "app" / "data" / "skill_question_additions.json"
    with additions_path.open(encoding="utf-8") as additions_file:
        additions = json.load(additions_file)
    question_table = sa.table(
        "skill_questions",
        sa.column("topic", sa.String()),
        sa.column("prompt", sa.Text()),
        sa.column("options", sa.JSON()),
        sa.column("correct_index", sa.Integer()),
        sa.column("correct_answers", sa.JSON()),
        sa.column("explanation", sa.Text()),
        sa.column("difficulty", sa.String()),
        sa.column("subtopic", sa.String()),
        sa.column("question_type", sa.String()),
        sa.column("source", sa.String()),
        sa.column("active", sa.Boolean()),
    )
    op.bulk_insert(
        question_table,
        [
            {
                **question,
                "correct_answers": None,
                "active": True,
            }
            for question in additions
        ],
    )

    resource_table = sa.table(
        "skill_learning_resources",
        sa.column("topic", sa.String()),
        sa.column("subtopic", sa.String()),
        sa.column("title", sa.String()),
        sa.column("url", sa.String()),
        sa.column("active", sa.Boolean()),
    )
    resources = [
        ("python", "general", "Python tutorial", "https://docs.python.org/3/tutorial/"),
        ("python", "general", "FastAPI documentation", "https://fastapi.tiangolo.com/tutorial/"),
        ("react", "general", "React learn", "https://react.dev/learn"),
        ("react", "general", "TypeScript with React", "https://www.typescriptlang.org/docs/"),
        ("sql", "general", "PostgreSQL documentation", "https://www.postgresql.org/docs/current/"),
        ("sql", "general", "SQLBolt interactive lessons", "https://sqlbolt.com/"),
        ("dsa", "general", "VisuAlgo visualizations", "https://visualgo.net/en"),
        ("dsa", "general", "Open Data Structures", "https://opendatastructures.org/"),
        ("ai", "general", "scikit-learn user guide", "https://scikit-learn.org/stable/user_guide.html"),
        ("ai", "general", "PyTorch tutorials", "https://pytorch.org/tutorials/"),
        ("devops", "general", "Docker getting started", "https://docs.docker.com/get-started/"),
        ("devops", "general", "Kubernetes tutorials", "https://kubernetes.io/docs/tutorials/"),
        ("security", "general", "OWASP Cheat Sheet Series", "https://cheatsheetseries.owasp.org/"),
        ("security", "general", "MDN web security", "https://developer.mozilla.org/en-US/docs/Web/Security"),
        ("typescript", "general", "TypeScript handbook", "https://www.typescriptlang.org/docs/handbook/"),
        ("typescript", "general", "TypeScript playground", "https://www.typescriptlang.org/play/"),
    ]
    op.bulk_insert(
        resource_table,
        [
            {"topic": topic, "subtopic": subtopic, "title": title, "url": url, "active": True}
            for topic, subtopic, title, url in resources
        ],
    )


def downgrade() -> None:
    additions_path = Path(__file__).resolve().parents[2] / "app" / "data" / "skill_question_additions.json"
    with additions_path.open(encoding="utf-8") as additions_file:
        additions = json.load(additions_file)
    question_table = sa.table(
        "skill_questions",
        sa.column("topic", sa.String()),
        sa.column("prompt", sa.Text()),
    )
    bind = op.get_bind()
    for question in additions:
        bind.execute(
            sa.delete(question_table).where(
                question_table.c.topic == question["topic"],
                question_table.c.prompt == question["prompt"],
            )
        )
    bind.execute(
        sa.text(
            "UPDATE skill_questions SET difficulty = CASE difficulty "
            "WHEN 'EASY' THEN 'beginner' "
            "WHEN 'MEDIUM' THEN 'intermediate' "
            "WHEN 'HARD' THEN 'advanced' ELSE difficulty END"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE skill_badges SET level = CASE level "
            "WHEN 'Advanced' THEN 'Gold' "
            "WHEN 'Intermediate' THEN 'Silver' "
            "WHEN 'Beginner' THEN 'Bronze' ELSE level END"
        )
    )
    op.drop_index("ix_skill_learning_resources_subtopic", table_name="skill_learning_resources")
    op.drop_index("ix_skill_learning_resources_topic", table_name="skill_learning_resources")
    op.drop_table("skill_learning_resources")
    op.drop_column("skill_attempts", "percentile")
    op.drop_column("skill_attempts", "difficulty_scores")
    op.drop_column("skill_attempts", "subtopic_scores")
    op.drop_column("skill_attempts", "question_time_seconds")
    op.drop_column("skill_attempts", "attempt_number")
    op.drop_column("skill_attempts", "time_taken_seconds")
    op.drop_column("skill_attempts", "level")
    op.drop_column("skill_attempts", "weighted_percentage")
    op.drop_column("skill_attempts", "raw_score")
    op.drop_column("skill_questions", "source")
    op.drop_column("skill_questions", "question_type")
    op.drop_column("skill_questions", "subtopic")
    op.drop_column("skill_questions", "correct_answers")
