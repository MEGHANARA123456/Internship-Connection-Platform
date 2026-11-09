import csv
import io
from collections.abc import Iterable
from typing import Any

from app.models import SkillQuestion


def question_key_audit_rows(questions: Iterable[SkillQuestion]) -> list[dict[str, Any]]:
    rows = []
    for question in questions:
        options = list(question.options or [])
        if question.question_type == "MULTI":
            keys = list(question.correct_answers or [])
        else:
            keys = [question.correct_index]

        issues: list[str] = []
        if len(set(str(option).casefold() for option in options)) != len(options):
            issues.append("duplicate options")
        if any(not isinstance(key, int) or isinstance(key, bool) or not 0 <= key < len(options) for key in keys):
            issues.append("key outside option range")
        if question.question_type == "MULTI":
            if len({repr(key) for key in keys}) != len(keys):
                issues.append("duplicate MULTI keys")
            if len(keys) < 2:
                issues.append("MULTI requires at least two keys")
        elif len(keys) != 1:
            issues.append("SINGLE/TRUE_FALSE requires exactly one key")
        if question.question_type != "MULTI" and question.correct_answers not in (None, [], [question.correct_index]):
            issues.append("additional key data conflicts with correct_index")

        valid_keys = [
            key for key in keys
            if isinstance(key, int) and not isinstance(key, bool) and 0 <= key < len(options)
        ]
        rows.append({
            "id": question.id,
            "topic": question.topic,
            "subtopic": question.subtopic,
            "source": question.source,
            "prompt": question.prompt,
            "numbered_options": " | ".join(f"{index + 1}. {option}" for index, option in enumerate(options)),
            "stored_key_number": ", ".join(
                str(key + 1) if isinstance(key, int) and not isinstance(key, bool) else str(key)
                for key in keys
            ),
            "key_option_text": " | ".join(str(options[key]) for key in valid_keys),
            "audit_issues": "; ".join(dict.fromkeys(issues)),
        })
    return rows


def question_key_audit_csv(questions: Iterable[SkillQuestion]) -> bytes:
    output = io.StringIO(newline="")
    fieldnames = [
        "id",
        "topic",
        "subtopic",
        "source",
        "prompt",
        "numbered_options",
        "stored_key_number",
        "key_option_text",
        "audit_issues",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(question_key_audit_rows(questions))
    return output.getvalue().encode("utf-8-sig")
