"""Run the deterministic chatbot evaluation corpus and print per-role accuracy."""

import asyncio
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.chatbot.chatbot_config import ChatbotConfig
from app.chatbot.orchestrator import classify_intent # type: ignore
from app.services.chatbot_service import ChatbotService


async def evaluate(records: list[dict[str, object]]) -> int:
    service = ChatbotService(config=ChatbotConfig(enabled=True, min_score=0.5))
    scores: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    failures: list[str] = []

    for record in records:
        role = record.get("role", "guest")
        kind = record["kind"]
        passed = False
        if kind == "in_scope":
            if record["expected_path"] == "live_data":
                intent = classify_intent(record["question"], role)
                passed = (
                    intent.category in {"live_data", "both"}
                    and intent.tool_name == record["expected_tool"]
                )
            else:
                previous_suggestions = record.get("previous_suggestions", [])
                result = await service.ask(
                    record["question"],
                    [],
                    role,
                    "home",
                    previous_suggestions=previous_suggestions,
                )
                passed = (
                    record["expected_source"] in result.matched_ids
                    and any(route in record["expected_links"] for _, route in result.links)
                    and all(
                        str(fact).casefold() in result.answer.casefold()
                        for fact in record.get("answer_contains", [])
                    )
                )
                if record.get("suggested_followups_exclude"):
                    excluded_topics = [
                        str(topic).casefold()
                        for topic in record["suggested_followups_exclude"]
                    ]
                    passed = passed and all(
                        not any(topic in suggestion.casefold() for topic in excluded_topics)
                        for suggestion in result.suggested_followups
                    )
                if previous_suggestions:
                    prior = {
                        " ".join(str(item).casefold().split())
                        for item in previous_suggestions
                    }
                    passed = passed and all(
                        " ".join(item.casefold().split()) not in prior
                        for item in result.suggested_followups
                    )
        elif kind == "personal_data_export":
            result = await service.ask(
                record["question"], [], role, "home"
            )
            passed = (
                result.refused
                and result.answer == record["expected_answer"]
                and not result.suggested_followups
            )
        elif kind == "cross_role_privacy":
            result = await service.ask(record["question"], [], role, "home")
            passed = (
                result.refused
                and result.category == "privacy"
                and not result.suggested_followups
            )
        else:
            result = await service.ask(record["question"], [], role, "home")
            expected_category = {
                "injection": "injection",
                "credential": "credential",
                "out_of_scope": "out_of_scope",
            }[kind]
            passed = result.refused and result.category == expected_category

        scores[role][0] += int(passed)
        scores[role][1] += 1
        if not passed:
            failures.append(f"{record['id']}: {record['question']}")

    print("| Role | Pass | Total | Accuracy |")
    print("|---|---:|---:|---:|")
    for role in ("guest", "student", "company", "admin"):
        passed, total = scores[role]
        accuracy = passed / total if total else 0
        print(f"| {role} | {passed} | {total} | {accuracy:.0%} |")

    below_threshold = [
        role for role, (passed, total) in scores.items()
        if total < 60 or passed / total < 0.95
    ]
    if below_threshold or failures:
        if failures:
            print("Failed cases:")
            print("\n".join(failures))
        return 1
    return 0


def main() -> int:
    records = json.loads(
        (Path(__file__).with_name("eval_questions.yaml")).read_text(encoding="utf-8")
    )
    return asyncio.run(evaluate(records))


if __name__ == "__main__":
    raise SystemExit(main())
