import logging
import re
from pathlib import Path
from typing import Any

from app.services.pdf import extract_text_from_pdf

logger = logging.getLogger(__name__)

# Curated taxonomy of high-value industry skills for internships
SKILL_TAXONOMY = [
    # Languages
    "Python", "JavaScript", "TypeScript", "Java", "C++", "C#", "C", "Go", "Golang", "Rust",
    "Ruby", "PHP", "Kotlin", "Swift", "Dart", "Scala", "R", "SQL", "Bash", "Shell",
    # Frontend
    "React", "React Native", "Next.js", "Vue.js", "Angular", "HTML5", "HTML", "CSS3", "CSS",
    "Tailwind CSS", "TailwindCSS", "Bootstrap", "Redux", "Zustand", "Webpack", "Vite",
    # Backend & Frameworks
    "FastAPI", "Django", "Flask", "Node.js", "Express", "NestJS", "Spring Boot", "ASP.NET",
    ".NET", "Ruby on Rails", "GraphQL", "REST API", "Microservices", "WebSockets",
    # Databases & Caching
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "DynamoDB", "Cassandra", "Elasticsearch",
    # Cloud & DevOps
    "Docker", "Kubernetes", "AWS", "Amazon Web Services", "Google Cloud", "GCP", "Azure",
    "CI/CD", "GitHub Actions", "Terraform", "Linux", "Git", "Nginx",
    # AI / ML / Data Science
    "Machine Learning", "Deep Learning", "Artificial Intelligence", "Natural Language Processing",
    "NLP", "Computer Vision", "PyTorch", "TensorFlow", "Keras", "Scikit-Learn", "Pandas",
    "NumPy", "OpenCV", "Hugging Face", "LLMs", "LangChain", "Data Analysis", "Data Visualization",
    "Tableau", "Power BI", "Spark", "Hadoop",
    # Testing & Tools
    "Pytest", "Jest", "Vitest", "Selenium", "Postman", "Figma", "Jira", "Agile", "Scrum",
]

# Major degrees and fields of study patterns
DEGREE_PATTERNS = [
    r"(?i)\b(Bachelor of Science|Bachelor of Technology|Bachelor of Engineering|B\.S\.|B\.Tech|B\.E\.|B\.A\.|BS|BTech|BE|Master of Science|Master of Technology|M\.S\.|M\.Tech|MS|MTech|MBA|Ph\.D\.|PhD)\b",
]

MAJOR_PATTERNS = [
    r"(?i)\b(Computer Science(?: and Engineering)?|Data Science|Software Engineering|Information Technology|Computer Engineering|Artificial Intelligence|Cybersecurity|Electrical Engineering|Mechanical Engineering|Mathematics|Information Systems|Applied Mathematics|Statistics)\b",
]

UNIVERSITY_PATTERNS = [
    r"(?i)([A-Z][A-Za-z\s&]+(?:University|Institute of Technology|College|Polytechnic|Academy))",
]


def extract_skills_from_text(text: str) -> list[str]:
    found_skills = set()
    lowered = text.lower()

    for skill in SKILL_TAXONOMY:
        # Exact boundary match for special skills like C++, C#, .NET
        if skill in ("C++", "C#", ".NET"):
            escaped = re.escape(skill)
            if re.search(r'(?:^|[\s,;/|])' + escaped + r'(?:$|[\s,;/|])', text, re.IGNORECASE):
                found_skills.add(skill)
        elif skill.lower() in ("c", "r"):
            # Isolated single character
            if re.search(r'\b' + skill + r'\b', text):
                found_skills.add(skill)
        else:
            escaped = re.escape(skill.lower())
            if re.search(r'\b' + escaped + r'\b', lowered):
                found_skills.add(skill)

    # Return sorted alphabetically
    return sorted(list(found_skills))


def extract_education_from_text(text: str) -> dict[str, Any]:
    university = None
    major = None
    graduation_year = None

    # University
    for pattern in UNIVERSITY_PATTERNS:
        match = re.search(pattern, text)
        if match:
            candidate = match.group(1).strip()
            # Clean up linebreaks or trailing words
            cleaned = candidate.split("\n")[0].strip()
            if len(cleaned) < 80:
                university = cleaned
                break

    # Major
    for pattern in MAJOR_PATTERNS:
        match = re.search(pattern, text)
        if match:
            major = match.group(1).strip()
            break

    # Graduation Year (looks for 2024 - 2030)
    year_match = re.search(r"(?i)(?:graduat(?:ion|ed|ing)|class of|expected|may|june|december|\b)\s*(?:in\s*)?(202[3-9]|203[0-2])\b", text)
    if year_match:
        try:
            graduation_year = int(year_match.group(1))
        except (ValueError, IndexError):
            pass
    if not graduation_year:
        # Fallback year in range
        years = [int(y) for y in re.findall(r"\b(202[4-9]|203[0-2])\b", text)]
        if years:
            graduation_year = max(years)

    return {
        "university": university,
        "major": major,
        "graduation_year": graduation_year,
    }


def extract_summary_bio(text: str) -> str | None:
    # Look for Summary / Profile / Objective section
    match = re.search(r"(?i)(?:summary|profile|objective|about me)\s*[:\n\-]\s*([^\n]+(?:\n[^\n]+){1,3})", text)
    if match:
        bio = match.group(1).strip()
        if len(bio) > 20:
            return bio[:500]
    return None


def parse_resume_pdf(pdf_path: str | Path) -> dict[str, Any]:
    text = extract_text_from_pdf(pdf_path)
    if not text:
        return {
            "skills": [],
            "university": None,
            "major": None,
            "graduation_year": None,
            "bio": None,
            "raw_length": 0,
        }

    skills = extract_skills_from_text(text)
    education = extract_education_from_text(text)
    bio = extract_summary_bio(text)

    return {
        "skills": skills,
        "university": education["university"],
        "major": education["major"],
        "graduation_year": education["graduation_year"],
        "bio": bio,
        "raw_length": len(text),
    }
