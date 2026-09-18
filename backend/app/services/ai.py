import re
from typing import Any

def compute_ats_score(
    resume_text: str,
    student_skills: list[str],
    job_title: str,
    job_description: str,
    job_skills: list[str],
) -> dict[str, Any]:
    # Normalize text
    full_candidate_text = f"{resume_text} {' '.join(student_skills)}".lower()
    job_full_text = f"{job_title} {job_description} {' '.join(job_skills)}".lower()

    # Match skills
    normalized_job_skills = [s.strip().lower() for s in job_skills if s.strip()]
    normalized_student_skills = [s.strip().lower() for s in student_skills if s.strip()]

    matched_skills = []
    missing_skills = []

    for skill in normalized_job_skills:
        # Check in student skills or resume text
        if skill in normalized_student_skills or re.search(r'\b' + re.escape(skill) + r'\b', full_candidate_text):
            matched_skills.append(skill)
        else:
            missing_skills.append(skill)

    # Base score on skills overlap
    total_skills = max(len(normalized_job_skills), 1)
    skill_match_ratio = len(matched_skills) / total_skills

    # Check for job title keywords
    title_words = [w for w in re.findall(r'\b\w+\b', job_title.lower()) if len(w) > 3 and w not in {"intern", "internship", "engineer", "specialist"}]
    title_matches = sum(1 for w in title_words if w in full_candidate_text)
    title_ratio = (title_matches / max(len(title_words), 1)) if title_words else 0.8

    # Overall weighted score
    raw_score = (skill_match_ratio * 70) + (title_ratio * 20) + (10 if len(resume_text) > 100 else 0)
    score = min(max(int(raw_score), 35), 98)

    # Suggested improvement tips
    suggestions = []
    if missing_skills:
        top_missing = missing_skills[:3]
        suggestions.append(f"Add projects or experience demonstrating skills in: {', '.join(top_missing).title()}.")
    if len(resume_text) < 200:
        suggestions.append("Upload a detailed PDF resume to showcase course projects, metrics, and technical accomplishments.")
    if not suggestions:
        suggestions.append("Your profile is exceptionally well-aligned! Emphasize measurable achievements in your cover note.")

    return {
        "score": score,
        "matched_skills": [s.title() for s in matched_skills],
        "missing_skills": [s.title() for s in missing_skills],
        "strengths": [f"Demonstrated proficiency in {', '.join(matched_skills[:3]).title()}." if matched_skills else "Academic foundation"],
        "suggestions": suggestions,
    }


def compute_match_score_fast(student_skills: list[str], job_skills: list[str], job_title: str = "") -> dict[str, Any]:
    normalized_job_skills = [s.strip().lower() for s in job_skills if s.strip()]
    normalized_student_skills = [s.strip().lower() for s in student_skills if s.strip()]

    if not normalized_job_skills:
        return {"score": 85 if normalized_student_skills else 70, "matched_skills": []}

    matched = [s for s in normalized_job_skills if s in normalized_student_skills]
    ratio = len(matched) / len(normalized_job_skills)

    score = min(max(int(45 + ratio * 53), 45), 98)
    return {"score": score, "matched_skills": [s.title() for s in matched]}



def generate_tailored_pitch(
    student_name: str,
    university: str,
    major: str,
    skills: list[str],
    bio: str | None,
    job_title: str,
    company_name: str,
    job_description: str,
) -> str:
    skills_text = ", ".join(skills[:4]) if skills else "modern software development technologies"
    first_paragraph = (
        f"I am writing to express my strong interest in the {job_title} role at {company_name}. "
        f"As a {major} student at {university} with a solid foundation in {skills_text}, "
        f"I have developed practical experience building scalable and user-focused applications."
    )
    
    second_paragraph = (
        f"I am particularly inspired by {company_name}'s mission and the technical challenges outlined in the job description. "
        f"With my background in collaborative problem solving and hands-on project execution, "
        f"I am confident in my ability to make an immediate impact on your engineering team while rapidly learning your core systems. "
        f"Thank you for considering my application, and I look forward to the opportunity to discuss how my skills align with your goals."
    )

    return f"{first_paragraph}\n\n{second_paragraph}"


def generate_mock_interview_questions(job_title: str, industry: str, skills: list[str]) -> list[dict[str, Any]]:
    skill_list = [s.strip() for s in skills if s.strip()] or ["Python", "Problem Solving", "Web Architecture"]
    
    questions = [
        {
            "id": 1,
            "type": "TECHNICAL",
            "question": f"How would you architect and implement a core feature for this {job_title} role using {skill_list[0]}?",
            "rubric": f"Evaluates practical technical knowledge of {skill_list[0]}, component separation, and scalability considerations.",
        },
        {
            "id": 2,
            "type": "TECHNICAL",
            "question": f"Describe a challenging bug or performance bottleneck you solved involving {skill_list[1] if len(skill_list) > 1 else skill_list[0]}. How did you diagnose and resolve it?",
            "rubric": "Looks for systematic debugging methodology, profiling, and verification of fixes.",
        },
        {
            "id": 3,
            "type": "SYSTEM_DESIGN",
            "question": f"If our application experiences a 10x traffic spike during a recruitment drive, how would you design our API and database layer to remain resilient?",
            "rubric": "Focuses on caching, database indexing, rate limiting, connection pooling, and horizontal scaling.",
        },
        {
            "id": 4,
            "type": "BEHAVIORAL",
            "question": f"Tell me about a time when you received constructive feedback on code or a project from a teammate or mentor. How did you handle it?",
            "rubric": "Assesses coachability, open-mindedness, team-first mentality, and growth mindset.",
        },
        {
            "id": 5,
            "type": "BEHAVIORAL",
            "question": f"Why are you passionate about joining this company in the {industry} industry, and what do you hope to learn during your internship?",
            "rubric": "Measures intrinsic motivation, role alignment, industry curiosity, and long-term career ambition.",
        },
    ]
    return questions


def evaluate_mock_interview_answer(question: str, answer: str, rubric: str) -> dict[str, Any]:
    cleaned = answer.strip()
    word_count = len(cleaned.split())
    
    if word_count < 15:
        score = 4
        feedback = "Answer is too brief. Provide concrete context, actions you took, and measurable results (STAR method: Situation, Task, Action, Result)."
        strengths = ["Prompt was directly addressed"]
        improvements = ["Elaborate with specific technical details", "Structure your answer with situation and outcome"]
    elif word_count < 40:
        score = 7
        feedback = "Good foundation. You conveyed the main point clearly, but could strengthen it by mentioning specific trade-offs or technical tools."
        strengths = ["Clear communication", "Relevant to question"]
        improvements = ["Provide a specific project example to prove your point"]
    else:
        score = 9
        feedback = "Outstanding response! Structured, specific, and showcases both technical depth and self-awareness."
        strengths = ["Comprehensive details", "Clear reasoning and terminology", "Professional delivery"]
        improvements = ["Practice keeping your delivery within 90-120 seconds during live interviews"]

    return {
        "score": score,
        "max_score": 10,
        "feedback": feedback,
        "strengths": strengths,
        "improvements": improvements,
    }
