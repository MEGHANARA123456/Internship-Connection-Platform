"""Idempotent starter skill catalog and role requirements."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RoleSkillRequirement, Skill


SKILL_CATALOG = (
    ("Python", ["py"]),
    ("SQL", ["structured query language"]),
    ("Excel", ["microsoft excel", "ms excel"]),
    ("Statistics", ["statistical analysis"]),
    ("Pandas", ["pd"]),
    ("NumPy", ["np"]),
    ("Data Visualization", ["data viz"]),
    ("Machine Learning", ["ml"]),
    ("Scikit-learn", ["sklearn", "scikit learn"]),
    ("Deep Learning", ["dl"]),
    ("PyTorch", ["torch"]),
    ("TensorFlow", ["tf"]),
    ("Natural Language Processing", ["nlp"]),
    ("A/B Testing", ["ab testing", "experimentation"]),
    ("Data Modeling", ["data modelling"]),
    ("Tableau", []),
    ("Power BI", ["powerbi"]),
    ("Java", []),
    ("Spring Boot", ["spring"]),
    ("REST APIs", ["rest api", "restful api", "restful apis"]),
    ("Git", ["version control"]),
    ("Testing", ["unit testing", "automated testing"]),
    ("Docker", ["containerization"]),
    ("Cloud Computing", ["cloud", "aws", "amazon web services"]),
    ("HTML", ["html5"]),
    ("CSS", ["css3"]),
    ("JavaScript", ["js", "ecmascript"]),
    ("TypeScript", ["ts"]),
    ("React", ["react.js", "reactjs"]),
    ("Responsive Design", ["responsive web design"]),
    ("Web Accessibility", ["accessibility", "a11y"]),
    ("Object-Oriented Programming", ["oop", "object oriented programming"]),
    ("FastAPI", []),
    ("Django", []),
    ("Flask", []),
    ("Data Storytelling", ["data communication"]),
    ("Feature Engineering", ["feature extraction"]),
    ("Model Deployment", ["model serving"]),
)


ROLE_REQUIREMENTS = {
    "data-scientist": {
        "label": "Data Scientist",
        "required": ["Python", "SQL", "Statistics", "Pandas", "Machine Learning", "Scikit-learn"],
        "preferred": ["Data Visualization", "A/B Testing", "Deep Learning", "Data Storytelling"],
    },
    "data-analyst": {
        "label": "Data Analyst",
        "required": ["SQL", "Excel", "Statistics", "Data Visualization", "Data Storytelling"],
        "preferred": ["Python", "Pandas", "Tableau", "Power BI", "A/B Testing"],
    },
    "python-developer": {
        "label": "Python Developer",
        "required": ["Python", "REST APIs", "SQL", "Git", "Testing"],
        "preferred": ["FastAPI", "Django", "Flask", "Docker", "Cloud Computing"],
    },
    "java-developer": {
        "label": "Java Developer",
        "required": ["Java", "Object-Oriented Programming", "Spring Boot", "REST APIs", "SQL", "Git"],
        "preferred": ["Testing", "Docker", "Cloud Computing"],
    },
    "frontend-developer": {
        "label": "Frontend Developer",
        "required": ["HTML", "CSS", "JavaScript", "TypeScript", "React"],
        "preferred": ["Responsive Design", "Web Accessibility", "Testing", "Git"],
    },
    "ml-engineer": {
        "label": "ML Engineer",
        "required": ["Python", "Machine Learning", "Scikit-learn", "Model Deployment", "Docker", "Cloud Computing"],
        "preferred": ["PyTorch", "TensorFlow", "Deep Learning", "Feature Engineering", "REST APIs"],
    },
}


async def seed_skill_gap_catalog(db: AsyncSession) -> dict[str, int]:
    existing = {
        skill.canonical_name.casefold(): skill
        for skill in (await db.execute(select(Skill))).scalars().all()
    }
    inserted_skills = 0
    for canonical_name, aliases in SKILL_CATALOG:
        if canonical_name.casefold() not in existing:
            skill = Skill(canonical_name=canonical_name, aliases=aliases)
            db.add(skill)
            existing[canonical_name.casefold()] = skill
            inserted_skills += 1
    await db.flush()

    existing_requirements = set(
        (
            await db.execute(
                select(RoleSkillRequirement.role_slug, RoleSkillRequirement.skill_id)
            )
        ).all()
    )
    inserted_requirements = 0
    for role_slug, role in ROLE_REQUIREMENTS.items():
        for requirement_type in ("required", "preferred"):
            for name in role[requirement_type]:
                skill = existing[name.casefold()]
                key = (role_slug, skill.id)
                if key not in existing_requirements:
                    db.add(
                        RoleSkillRequirement(
                            role_slug=role_slug,
                            role_label=role["label"],
                            skill_id=skill.id,
                            requirement_type=requirement_type,
                        )
                    )
                    existing_requirements.add(key)
                    inserted_requirements += 1
    await db.commit()
    return {"skills": inserted_skills, "requirements": inserted_requirements}
