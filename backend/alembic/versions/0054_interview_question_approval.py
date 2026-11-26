"""Disable unapproved interview questions and tests that depend on them."""

from alembic import op


revision = "0054_interview_question_approval"
down_revision = "0053_interview_eval_queue"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute(
            """
            UPDATE interview_question_bank
            SET active = 0
            WHERE COALESCE(json_extract(source_metadata, '$.status'), 'DRAFT-for-review')
                <> 'APPROVED'
            """
        )
        op.execute(
            """
            UPDATE mock_tests
            SET active = 0
            WHERE id IN (
                SELECT DISTINCT assignments.mock_test_id
                FROM mock_test_questions AS assignments
                JOIN interview_question_bank AS questions
                  ON questions.id = assignments.question_bank_id
                JOIN mock_tests AS tests
                  ON tests.id = assignments.mock_test_id
                 AND tests.version = assignments.version
                WHERE questions.active = 0
                   OR COALESCE(
                       json_extract(questions.source_metadata, '$.status'),
                       'DRAFT-for-review'
                   ) <> 'APPROVED'
            )
            """
        )
    else:
        op.execute(
            """
            UPDATE interview_question_bank
            SET active = FALSE
            WHERE COALESCE(source_metadata ->> 'status', 'DRAFT-for-review')
                <> 'APPROVED'
            """
        )
        op.execute(
            """
            UPDATE mock_tests
            SET active = FALSE
            WHERE id IN (
                SELECT DISTINCT assignments.mock_test_id
                FROM mock_test_questions AS assignments
                JOIN interview_question_bank AS questions
                  ON questions.id = assignments.question_bank_id
                JOIN mock_tests AS tests
                  ON tests.id = assignments.mock_test_id
                 AND tests.version = assignments.version
                WHERE questions.active = FALSE
                   OR COALESCE(
                       questions.source_metadata ->> 'status',
                       'DRAFT-for-review'
                   ) <> 'APPROVED'
            )
            """
        )


def downgrade() -> None:
    pass
