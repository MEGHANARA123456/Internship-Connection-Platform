import pytest
from app.services.ai import compute_explicit_eligibility_fit, compute_match


def _match(
    student_skills: list[str],
    resume_text: str = "",
    job_title: str = "",
    job_description: str = "",
    job_skills: list[str] | None = None,
    eligibility_data=None,
):
    return compute_match(
        student_skills,
        resume_text,
        job_title,
        job_description,
        job_skills or [],
        eligibility_data=eligibility_data,
    )


def test_full_match_scores_all_available_skill_coverage():
    result = _match(["Python", "React"], job_skills=["python", "REACT"])

    assert result["score"] == 100
    assert result["matched"] == ["Python", "React"]
    assert result["missing"] == []
    assert result["matched_skills"] == result["matched"]
    assert result["missing_skills"] == result["missing"]
    assert result["reason"] == "full_match"


def test_partial_match_uses_proportional_available_weights():
    result = _match(
        ["Python", "Data"],
        job_title="Data Analyst",
        job_skills=["Python", "SQL"],
    )

    assert result["score"] == 50
    assert result["matched"] == ["Python"]
    assert result["missing"] == ["Sql"]
    assert result["score_breakdown"]["weights"] == {
        "skill_coverage": 0.7778,
        "title_relevance": 0.2222,
    }
    assert result["reason"] == "partial_match"


def test_zero_overlap_can_score_zero_without_a_floor():
    result = _match(
        ["Rust"],
        job_title="Backend Engineer",
        job_skills=["Python", "SQL"],
    )

    assert result["score"] == 0
    assert result["matched"] == []
    assert result["missing"] == ["Python", "Sql"]
    assert result["reason"] == "no_overlap"


@pytest.mark.parametrize(
    ("candidate", "required"),
    [
        ("ML", "Machine Learning"),
        ("Artificial Intelligence", "AI"),
        ("DL", "Deep Learning"),
        ("JavaScript", "JS"),
        ("Java-Script", "JavaScript"),
        ("Postgres", "PostgreSQL"),
        ("React.js", "React"),
        ("Node.js", "Node"),
    ],
)
def test_common_skill_aliases_match(candidate, required):
    result = _match([candidate], job_skills=[required])

    assert result["matched"] == [required.title()]
    assert result["missing"] == []
    assert result["score"] == 100


def test_empty_skills_and_resume_return_null_profile_score():
    result = _match([], job_title="Backend Engineer", job_skills=["Python"])

    assert result["score"] is None
    assert result["reason"] == "no_profile_data"
    assert result["confidence"] == "low"


def test_resume_text_counts_as_candidate_skill_evidence():
    result = _match(
        [],
        resume_text="Built predictive models with Machine-Learning tools.",
        job_skills=["ML"],
    )

    assert result["matched"] == ["Ml"]
    assert result["missing"] == []
    assert result["score"] == 100


def test_r_does_not_match_react_as_a_substring():
    result = _match(["React"], job_skills=["R"])

    assert result["matched"] == []
    assert result["missing"] == ["R"]
    assert result["score"] == 0


def test_resume_presence_has_no_bonus_and_scores_stay_in_range():
    without_resume = _match(
        ["Python"],
        job_title="Backend Engineer",
        job_skills=["Python", "React"],
    )
    with_unrelated_resume = _match(
        ["Python"],
        resume_text="A detailed resume describing unrelated accounting and finance work. " * 8,
        job_title="Backend Engineer",
        job_skills=["Python", "React"],
    )
    full_match = _match(["Python", "React"], job_skills=["Python", "React"])

    assert with_unrelated_resume["score"] == without_resume["score"]
    assert 0 <= without_resume["score"] <= 100
    assert 0 <= with_unrelated_resume["score"] <= 100
    assert 0 <= full_match["score"] <= 100


def test_explicit_eligibility_uses_ten_percent_weight():
    result = _match(
        ["Python"],
        job_title="Python Developer",
        job_skills=["Python"],
        eligibility_data={"fit": 0.5},
    )

    assert result["score"] == 95
    assert result["score_breakdown"]["eligibility_fit"] == 50
    assert result["score_breakdown"]["weights"]["eligibility_fit"] == 0.1


def test_missing_job_skills_uses_lower_confidence_keyword_fallback():
    result = _match(
        ["Python"],
        job_title="Python Developer",
        job_description="Python",
    )

    assert result["score"] == 100
    assert result["matched"]
    assert result["confidence"] == "low"
    assert result["reason"] == "keyword_fallback"


def test_explicit_eligibility_fit_counts_matching_graduation_and_major():
    fit = compute_explicit_eligibility_fit(
        "Applicants must graduate in 2027 and be majoring in Computer Science.",
        2027,
        "B.S. in Computer Science",
    )

    assert fit == {"matched": 2, "required": 2}


def test_explicit_eligibility_fit_supports_year_ranges_and_punctuation():
    fit = compute_explicit_eligibility_fit(
        "Graduation year between 2026 and 2028. Degree in data-science required.",
        2027,
        "MSc Data Science",
    )

    assert fit == {"matched": 2, "required": 2}


def test_explicit_eligibility_fit_returns_none_without_clear_requirements():
    assert compute_explicit_eligibility_fit(
        "We welcome students interested in learning and growing with our team.",
        2027,
        "Computer Science",
    ) is None


def test_unavailable_candidate_education_does_not_match_explicit_major():
    fit = compute_explicit_eligibility_fit(
        "A degree in Computer Science is required.",
        None,
        None,
    )

    assert fit == {"matched": 0, "required": 1}
