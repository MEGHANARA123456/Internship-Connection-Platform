from app.services.resume_parser import extract_education_from_text, extract_skills_from_text, extract_summary_bio


def test_extract_skills_comprehensive():
    sample_text = """
    Jane Doe
    Software Engineer with hands-on experience in Python, FastAPI, React, and TypeScript.
    Built machine learning pipelines using PyTorch, Pandas, and Docker.
    Deployed cloud services on AWS with PostgreSQL database and Redis cache.
    Comfortable with Git, Linux, and CI/CD pipelines.
    """
    skills = extract_skills_from_text(sample_text)
    assert "Python" in skills
    assert "FastAPI" in skills
    assert "React" in skills
    assert "TypeScript" in skills
    assert "Docker" in skills
    assert "AWS" in skills
    assert "PostgreSQL" in skills
    assert "Redis" in skills
    assert "PyTorch" in skills


def test_extract_education_fields():
    sample_text = """
    Education:
    Stanford University
    Bachelor of Science in Computer Science
    Expected Graduation: May 2026
    GPA: 3.9/4.0
    """
    edu = extract_education_from_text(sample_text)
    assert edu["university"] is not None and "Stanford" in edu["university"]
    assert edu["major"] is not None and "Computer Science" in edu["major"]
    assert edu["graduation_year"] == 2026


def test_extract_summary_bio():
    sample_text = """
    Summary:
    Enthusiastic computer science student passionate about distributed systems and cloud architecture.
    Looking for a high-impact software engineering internship.
    """
    bio = extract_summary_bio(sample_text)
    assert bio is not None
    assert "distributed systems" in bio
