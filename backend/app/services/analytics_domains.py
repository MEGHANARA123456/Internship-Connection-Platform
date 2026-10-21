from collections import defaultdict
import re
from typing import Iterable


DOMAIN_TAXONOMY = (
    "AI & Machine Learning",
    "Software Development",
    "Data & Analytics",
    "Web Development",
    "Marketing",
    "Finance",
    "Design",
    "Operations",
    "Other",
)


def normalize_domain(value: str | None) -> str:
    """Map stored industry text to the platform's stable analytics taxonomy."""
    label = " ".join((value or "").casefold().replace("&", " and ").split())
    if any(term in label for term in ("artificial intelligence", "machine learning", "deep learning")) or re.search(r"\bai\b", label):
        return DOMAIN_TAXONOMY[0]
    if any(term in label for term in ("web", "website", "e-commerce", "ecommerce")):
        return DOMAIN_TAXONOMY[3]
    if any(term in label for term in ("data", "analytics", "business intelligence", "bi ")):
        return DOMAIN_TAXONOMY[2]
    if any(term in label for term in ("software", "programming", "developer", "engineering", "technology", "tech ")):
        return DOMAIN_TAXONOMY[1]
    if any(term in label for term in ("marketing", "growth", "seo", "advertising", "social media", "content")):
        return DOMAIN_TAXONOMY[4]
    if any(term in label for term in ("finance", "fintech", "banking", "accounting", "investment")):
        return DOMAIN_TAXONOMY[5]
    if any(term in label for term in ("design", "ux", "ui", "graphic", "creative")):
        return DOMAIN_TAXONOMY[6]
    if any(term in label for term in ("operation", "human resources", " hr ", "logistics", "supply chain", "administration")):
        return DOMAIN_TAXONOMY[7]
    return DOMAIN_TAXONOMY[8]


def normalize_domain_rows(
    rows: Iterable[tuple[str | None, int]],
    limit: int = 6,
) -> list[dict[str, object]]:
    grouped: dict[str, dict[str, object]] = defaultdict(
        lambda: {"count": 0, "names": set()}
    )
    for raw_name, raw_count in rows:
        category = normalize_domain(raw_name)
        grouped[category]["count"] = int(grouped[category]["count"]) + int(raw_count)
        names = grouped[category]["names"]
        if raw_name and isinstance(names, set):
            names.add(raw_name)

    ranked = sorted(
        grouped.items(),
        key=lambda item: (-int(item[1]["count"]), DOMAIN_TAXONOMY.index(item[0])),
    )
    ranked_categories = [(category, details) for category, details in ranked if category != "Other"]
    visible = ranked_categories[:limit]
    overflow = [(category, details) for category, details in ranked if category == "Other"] + ranked_categories[limit:]
    other_count = sum(int(details["count"]) for _, details in overflow)
    if other_count:
        other_names = {
            name
            for _, details in overflow
            for name in details["names"]
        }
        visible.append(("Other", {"count": other_count, "names": other_names}))

    total = sum(int(details["count"]) for _, details in ranked) or 1
    output: list[dict[str, object]] = []
    for category, details in visible:
        count = int(details["count"])
        names = sorted(details["names"])
        label = f"Other ({count})" if category == "Other" else category
        output.append(
            {
                "name": label,
                "fullName": ", ".join(names) if names else category,
                "count": count,
                "pct": round(count * 100 / total),
            }
        )
    return output
