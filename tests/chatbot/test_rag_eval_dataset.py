import json
from collections import Counter
from pathlib import Path


def test_rag_eval_covers_each_audience_and_safety_case() -> None:
    dataset_path = Path(__file__).parents[1] / "rag_eval.json"
    records = json.loads(dataset_path.read_text(encoding="utf-8"))
    in_scope = [record for record in records if record["kind"] == "in_scope"]

    assert len(records) >= 59
    assert Counter(record["role"] for record in in_scope) == {
        "student": 15,
        "company": 24,
        "admin": 15,
        "all": 15,
    }
    assert all(record.get("expected_source") and record.get("key_facts") for record in in_scope)
    company_sources = Counter(
        record["expected_source"]
        for record in in_scope
        if record["role"] == "company"
    )
    assert all(
        company_sources[source] >= 3
        for source in (
            "company-hiring-pipeline",
            "company-applicant-review",
            "company-interview-scheduling",
        )
    )
    assert {"out_of_scope", "injection", "credential"} <= {
        record["kind"] for record in records
    }
    assert any(record.get("history") for record in in_scope)
    assert any("ignore previous instructions" in record["question"].lower() for record in records)
