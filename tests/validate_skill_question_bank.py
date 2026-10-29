"""Print every structural problem in the curated skill question additions."""

from collections import Counter
import json
from pathlib import Path
import re
import sys
from typing import Any


QUESTION_BANK = (
    Path(__file__).parents[1]
    / "backend"
    / "app"
    / "data"
    / "skill_question_additions.json"
)
ASSESSMENT_MIX = {"EASY": 4, "MEDIUM": 4, "HARD": 2}


def _normalized_prompt(value: object) -> str:
    return re.sub(r"\s+", " ", str(value)).strip().casefold()


def validate_questions(questions: list[Any]) -> list[str]:
    problems: list[str] = []
    seen_prompts: dict[tuple[str, str], int] = {}
    counts: Counter[tuple[str, str]] = Counter()
    topics: set[str] = set()

    for index, question in enumerate(questions, start=1):
        location = f"question {index}"
        if not isinstance(question, dict):
            problems.append(f"{location}: record is not an object")
            continue

        topic = str(question.get("topic", "")).strip().lower()
        difficulty = str(question.get("difficulty", "")).strip().upper()
        prompt = _normalized_prompt(question.get("prompt", ""))
        if topic:
            topics.add(topic)
            if difficulty:
                counts[(topic, difficulty)] += 1
        if prompt:
            prompt_key = (topic, prompt)
            previous = seen_prompts.get(prompt_key)
            if previous is not None:
                problems.append(
                    f"{location}: duplicate prompt for topic {topic!r} "
                    f"(also question {previous})"
                )
            else:
                seen_prompts[prompt_key] = index

        options = question.get("options")
        if not isinstance(options, list) or len(options) < 2:
            problems.append(f"{location}: options must contain at least two entries")
            options = options if isinstance(options, list) else []
        normalized_options = [str(option).strip().casefold() for option in options]
        seen_options: set[str] = set()
        for option_index, option in enumerate(normalized_options):
            if option in seen_options:
                problems.append(
                    f"{location}: duplicate option at index {option_index}"
                )
            seen_options.add(option)

        correct_index = question.get("correct_index")
        if correct_index is not None and (
            not isinstance(correct_index, int)
            or isinstance(correct_index, bool)
            or not 0 <= correct_index < len(options)
        ):
            problems.append(f"{location}: correct_index is outside options")

        correct_answers = question.get("correct_answers")
        if correct_answers is not None:
            if not isinstance(correct_answers, list):
                problems.append(f"{location}: correct_answers must be a list")
                correct_answers = []
            for answer_index in correct_answers:
                if (
                    not isinstance(answer_index, int)
                    or isinstance(answer_index, bool)
                    or not 0 <= answer_index < len(options)
                ):
                    problems.append(
                        f"{location}: correct_answers index {answer_index!r} "
                        "is outside options"
                    )

        if str(question.get("question_type", "")).upper() == "MULTI":
            valid_correct_answers = (
                {
                    answer
                    for answer in correct_answers
                    if isinstance(answer, int) and not isinstance(answer, bool)
                }
                if isinstance(correct_answers, list)
                else set()
            )
            if len(valid_correct_answers) < 2:
                problems.append(
                    f"{location}: MULTI question has fewer than two correct answers"
                )

        if not str(question.get("explanation", "")).strip():
            problems.append(f"{location}: explanation is missing")

    for topic in sorted(topics):
        for difficulty, required in ASSESSMENT_MIX.items():
            available = counts[(topic, difficulty)]
            if available < required:
                problems.append(
                    f"topic {topic!r}: {difficulty} has {available}; "
                    f"needs {required} to fill an assessment"
                )

    return problems


def main() -> int:
    questions = json.loads(QUESTION_BANK.read_text(encoding="utf-8"))
    if not isinstance(questions, list):
        print(f"Question bank must be a JSON array: {QUESTION_BANK}")
        return 2
    problems = validate_questions(questions)
    if problems:
        for problem in problems:
            print(problem)
        print(f"{len(problems)} structural problem(s) found.")
        return 1
    print(f"No structural problems found in {len(questions)} questions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
