from app.services.analytics_domains import normalize_domain, normalize_domain_rows


def test_normalize_domain_maps_raw_industry_names_to_fixed_categories() -> None:
    assert normalize_domain("AI & ML") == "AI & Machine Learning"
    assert normalize_domain("Software Engineering") == "Software Development"
    assert normalize_domain("Business Intelligence") == "Data & Analytics"
    assert normalize_domain("Web applications") == "Web Development"
    assert normalize_domain("Growth Marketing") == "Marketing"
    assert normalize_domain("Fintech") == "Finance"
    assert normalize_domain("UX Design") == "Design"
    assert normalize_domain("Human Resources") == "Operations"
    assert normalize_domain("Aerospace") == "Other"


def test_normalize_domain_rows_merges_aliases_and_adds_one_other_overflow_bucket() -> None:
    rows = [
        ("AI", 12),
        ("Artificial Intelligence", 4),
        ("Software", 10),
        ("Analytics", 8),
        ("Web development", 7),
        ("Marketing", 6),
        ("Finance", 5),
        ("Design", 4),
        ("Unclassified 1", 3),
        ("Unclassified 2", 2),
    ]

    result = normalize_domain_rows(rows)

    assert [row["name"] for row in result] == [
        "AI & Machine Learning",
        "Software Development",
        "Data & Analytics",
        "Web Development",
        "Marketing",
        "Finance",
        "Other (9)",
    ]
    assert result[0]["count"] == 16
    assert result[-1]["fullName"] == "Design, Unclassified 1, Unclassified 2"
    assert sum(int(row["count"]) for row in result) == 61
