"""Evaluate retrieval evidence and refusal behavior against a JSON question set."""

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from app.chatbot.chatbot_config import load_config
from app.chatbot.rag.retriever import HybridRetriever
from app.core.database import async_session_factory
from app.services.chatbot_service import ChatbotService


def _records(path: Path) -> list[dict[str, Any]]:
    """Load an evaluation JSON array and reject non-object records or non-array roots."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
        raise ValueError(f"Evaluation dataset must be a JSON array of records: {path}")
    return data


async def evaluate(dataset: Path) -> dict[str, Any]:
    """Measure expected-source ranking, key-fact coverage, and refusal rates for a dataset."""
    records = _records(dataset)
    config = load_config()
    if not config.rag_enabled:
        raise RuntimeError("Enable RAG before running retrieval evaluation.")
    retriever = HybridRetriever(config)
    service = ChatbotService(config=config)
    in_scope = [item for item in records if item.get("kind") == "in_scope"]
    safety = [item for item in records if item.get("kind") in {"out_of_scope", "injection", "credential"}]
    ranks: list[int] = []
    correct_answers = 0
    missed_facts: list[dict[str, Any]] = []
    refusals: dict[str, list[int]] = {}
    refusal_failures: list[dict[str, str]] = []

    async with async_session_factory() as db:
        for item in in_scope:
            history = [tuple(turn) for turn in item.get("history", [])]
            role = str(item.get("role", "all")).lower()
            expected_source = str(item.get("expected_source", item.get("expected", "")))
            if not expected_source:
                raise ValueError(f"Evaluation question {item.get('id')} has no expected source.")
            passages = await retriever.retrieve(
                db,
                str(item["question"]),
                role,
                history=history,
            )
            matching_ranks = [
                index
                for index, passage in enumerate(passages, start=1)
                if passage.doc_id == expected_source
            ]
            ranks.append(min(matching_ranks) if matching_ranks else 0)
            answer = " ".join(passage.text for passage in passages).casefold()
            facts = item.get("key_facts", [])
            absent_facts = [str(fact) for fact in facts if str(fact).casefold() not in answer]
            if matching_ranks and not absent_facts:
                correct_answers += 1
            else:
                missed_facts.append({
                    "id": str(item["id"]),
                    "expected_source": expected_source,
                    "absent_facts": absent_facts,
                })

        for item in safety:
            kind = str(item["kind"])
            role = str(item.get("role", "guest")).lower()
            result = await service.ask(
                str(item["question"]),
                [],
                role,
                "home",
                db=db,
            )
            counts = refusals.setdefault(kind, [0, 0])
            counts[1] += 1
            counts[0] += int(result.refused)
            if not result.refused:
                refusal_failures.append({
                    "id": str(item["id"]),
                    "kind": kind,
                    "category": result.category,
                })

    total = len(ranks)
    hit_count = sum(rank > 0 for rank in ranks)
    return {
        "dataset": str(dataset),
        "in_scope_questions": total,
        "hit_at_5": hit_count / total if total else 0.0,
        "mrr": sum((1 / rank) for rank in ranks if rank > 0) / total if total else 0.0,
        "answer_correctness": correct_answers / total if total else 0.0,
        "refusal_rates": {
            kind: refused / count for kind, (refused, count) in refusals.items()
        },
        "refusal_counts": {
            kind: {"refused": refused, "total": count}
            for kind, (refused, count) in refusals.items()
        },
        "refusal_failures": refusal_failures,
        "missed_sources": [
            {
                "id": item["id"],
                "expected_source": item.get("expected_source", item.get("expected")),
                "rank": rank,
            }
            for item, rank in zip(in_scope, ranks)
            if not rank
        ],
        "missed_facts": missed_facts,
    }


def main() -> None:
    """Parse the dataset path and print retrieval and refusal evaluation metrics as JSON."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path, help="Path to tests/rag_eval.json")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(evaluate(args.dataset)), indent=2))


if __name__ == "__main__":
    main()
