"""Idempotently seed learning paths with URLs verified against their publishers."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LearningCategory, LearningPath, LearningPathResource, LearningResource

_CATEGORIES = {
    "programming": ("Programming", "Language fundamentals and development practice."),
    "data": ("Data and machine learning", "Data analysis, statistics, and machine learning."),
    "web": ("Web development", "Frontend development and browser fundamentals."),
    "interview": ("Interview preparation", "General and video interview preparation."),
}

_RESOURCES = (
    {
        "slug": "python-language-tutorial",
        "category": "programming",
        "title": "The Python Tutorial",
        "description": "Official Python language tutorial covering core syntax, data structures, modules, and exceptions.",
        "url": "https://docs.python.org/3/tutorial/",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["python-developer", "data-scientist", "data-analyst", "ml-engineer"],
        "topics": ["python", "programming-fundamentals", "courses"],
    },
    {
        "slug": "hackerrank-python-practice",
        "category": "programming",
        "title": "HackerRank Python Practice",
        "description": "Interactive Python challenges for practicing syntax and problem solving.",
        "url": "https://www.hackerrank.com/domains/python",
        "type": "link",
        "level": "BEGINNER",
        "roles": ["python-developer", "data-scientist", "ml-engineer"],
        "topics": ["python", "coding-practice", "practice-tests"],
    },
    {
        "slug": "freecodecamp-learn",
        "category": "web",
        "title": "freeCodeCamp Learn",
        "description": "Free interactive coding curriculum and projects from freeCodeCamp.",
        "url": "https://www.freecodecamp.org/learn/",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["python-developer", "frontend-developer", "java-developer"],
        "topics": ["programming-fundamentals", "javascript", "web-development", "courses"],
    },
    {
        "slug": "dev-java-learn",
        "category": "programming",
        "title": "Learn Java",
        "description": "Official Java learning materials covering first steps, language features, and APIs.",
        "url": "https://dev.java/learn/",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["java-developer"],
        "topics": ["java", "programming-fundamentals", "courses"],
    },
    {
        "slug": "hackerrank-java-practice",
        "category": "programming",
        "title": "HackerRank Java Practice",
        "description": "Interactive Java exercises for practicing language fundamentals.",
        "url": "https://www.hackerrank.com/domains/java",
        "type": "link",
        "level": "BEGINNER",
        "roles": ["java-developer"],
        "topics": ["java", "coding-practice", "practice-tests"],
    },
    {
        "slug": "mdn-javascript-guide",
        "category": "web",
        "title": "MDN JavaScript Guide",
        "description": "A comprehensive guide to the JavaScript language from MDN.",
        "url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["frontend-developer"],
        "topics": ["javascript", "web-development", "courses"],
    },
    {
        "slug": "react-learn",
        "category": "web",
        "title": "Learn React",
        "description": "Official React documentation introducing components, state, events, and everyday React concepts.",
        "url": "https://react.dev/learn",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["frontend-developer"],
        "topics": ["react", "javascript", "web-development", "courses"],
    },
    {
        "slug": "kaggle-python",
        "category": "data",
        "title": "Kaggle Learn: Python",
        "description": "Hands-on Python lessons designed for data science workflows.",
        "url": "https://www.kaggle.com/learn/python",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["data-scientist", "data-analyst", "ml-engineer"],
        "topics": ["python", "data-science", "courses"],
    },
    {
        "slug": "kaggle-pandas",
        "category": "data",
        "title": "Kaggle Learn: Pandas",
        "description": "Practical exercises for loading, exploring, and transforming tabular data with pandas.",
        "url": "https://www.kaggle.com/learn/pandas",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["data-scientist", "data-analyst", "ml-engineer"],
        "topics": ["pandas", "data-analysis", "data-science", "courses"],
    },
    {
        "slug": "kaggle-intro-ml",
        "category": "data",
        "title": "Kaggle Learn: Intro to Machine Learning",
        "description": "Learn core machine-learning concepts and build introductory models.",
        "url": "https://www.kaggle.com/learn/intro-to-machine-learning",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["data-scientist", "ml-engineer"],
        "topics": ["machine-learning", "modeling", "courses"],
    },
    {
        "slug": "kaggle-data-visualization",
        "category": "data",
        "title": "Kaggle Learn: Data Visualization",
        "description": "Hands-on lessons for creating and interpreting data visualizations.",
        "url": "https://www.kaggle.com/learn/data-visualization",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["data-scientist", "data-analyst"],
        "topics": ["data-visualization", "data-analysis", "courses"],
    },
    {
        "slug": "sqlbolt-lessons",
        "category": "data",
        "title": "SQLBolt Interactive Lessons",
        "description": "Browser-based SQL lessons and exercises for relational data querying.",
        "url": "https://sqlbolt.com/",
        "type": "course",
        "level": "BEGINNER",
        "roles": ["data-analyst", "data-scientist"],
        "topics": ["sql", "databases", "coding-practice", "courses"],
    },
    {
        "slug": "hackerrank-sql-practice",
        "category": "data",
        "title": "HackerRank SQL Practice",
        "description": "SQL challenges covering common query patterns and database concepts.",
        "url": "https://www.hackerrank.com/domains/sql",
        "type": "link",
        "level": "BEGINNER",
        "roles": ["data-analyst", "data-scientist"],
        "topics": ["sql", "databases", "coding-practice", "practice-tests"],
    },
    {
        "slug": "google-ml-crash-course",
        "category": "data",
        "title": "Google Machine Learning Crash Course",
        "description": "A practical machine-learning course with videos, interactive visualizations, and exercises.",
        "url": "https://developers.google.com/machine-learning/crash-course",
        "type": "course",
        "level": "INTERMEDIATE",
        "roles": ["ml-engineer", "data-scientist"],
        "topics": ["machine-learning", "modeling", "practice-tests", "courses"],
    },
    {
        "slug": "scikit-learn-user-guide",
        "category": "data",
        "title": "scikit-learn User Guide",
        "description": "Official reference and conceptual guide for scikit-learn estimators and workflows.",
        "url": "https://scikit-learn.org/stable/user_guide.html",
        "type": "link",
        "level": "INTERMEDIATE",
        "roles": ["ml-engineer", "data-scientist"],
        "topics": ["python", "machine-learning", "modeling", "notes"],
    },
    {
        "slug": "hackerrank-interview-preparation-kit",
        "category": "interview",
        "title": "HackerRank Interview Preparation Kit",
        "description": "Structured coding challenges organized around interview problem-solving concepts.",
        "url": "https://www.hackerrank.com/interview/interview-preparation-kit",
        "type": "link",
        "level": "INTERMEDIATE",
        "roles": [
            "python-developer", "java-developer", "frontend-developer",
            "data-scientist", "data-analyst", "ml-engineer",
        ],
        "topics": ["coding-practice", "practice-tests", "interview-questions", "algorithms"],
    },
    {
        "slug": "google-interview-tips",
        "category": "interview",
        "title": "Grow with Google: Interview Tips",
        "description": "Google's guide to preparing for an interview and communicating your value.",
        "url": "https://grow.google/grow-your-career/articles/interview-tips/",
        "type": "link",
        "level": "ALL",
        "roles": ["hr-interview", "video-interview"],
        "topics": ["interview-questions", "communication", "behavioral-interview"],
    },
    {
        "slug": "zoom-meeting-test",
        "category": "interview",
        "title": "Zoom Meeting Test",
        "description": "Official Zoom test meeting for checking internet connection and device setup before a video interview.",
        "url": "https://zoom.us/test",
        "type": "link",
        "level": "ALL",
        "roles": ["video-interview"],
        "topics": ["video-interview", "device-check", "communication"],
    },
)

_PATHS = (
    {
        "slug": "data-scientist",
        "category": "data",
        "title": "Data Scientist",
        "description": "Build Python, data preparation, visualization, and introductory modeling skills.",
        "roles": ["data-scientist"],
        "topics": ["python", "pandas", "data-visualization", "machine-learning"],
        "resources": ["kaggle-python", "kaggle-pandas", "kaggle-data-visualization", "kaggle-intro-ml"],
    },
    {
        "slug": "data-analyst",
        "category": "data",
        "title": "Data Analyst",
        "description": "Practice SQL and develop a workflow for exploring and presenting data.",
        "roles": ["data-analyst"],
        "topics": ["sql", "pandas", "data-analysis", "data-visualization"],
        "resources": ["sqlbolt-lessons", "hackerrank-sql-practice", "kaggle-pandas", "kaggle-data-visualization"],
    },
    {
        "slug": "python-developer",
        "category": "programming",
        "title": "Python Developer",
        "description": "Strengthen core Python, solve coding challenges, and explore guided projects.",
        "roles": ["python-developer"],
        "topics": ["python", "programming-fundamentals", "algorithms"],
        "resources": ["python-language-tutorial", "hackerrank-python-practice", "freecodecamp-learn", "hackerrank-interview-preparation-kit"],
    },
    {
        "slug": "java-developer",
        "category": "programming",
        "title": "Java Developer",
        "description": "Learn Java language fundamentals and practice implementation and interview problems.",
        "roles": ["java-developer"],
        "topics": ["java", "programming-fundamentals", "algorithms"],
        "resources": ["dev-java-learn", "hackerrank-java-practice", "freecodecamp-learn", "hackerrank-interview-preparation-kit"],
    },
    {
        "slug": "frontend-developer",
        "category": "web",
        "title": "Frontend Developer",
        "description": "Study JavaScript and React, then apply the concepts through guided coding curriculum.",
        "roles": ["frontend-developer"],
        "topics": ["javascript", "react", "web-development"],
        "resources": ["mdn-javascript-guide", "react-learn", "freecodecamp-learn", "hackerrank-interview-preparation-kit"],
    },
    {
        "slug": "ml-engineer",
        "category": "data",
        "title": "Machine Learning Engineer",
        "description": "Progress from Python and introductory ML to practical model training and scikit-learn.",
        "roles": ["ml-engineer"],
        "topics": ["python", "machine-learning", "modeling"],
        "resources": ["kaggle-python", "kaggle-intro-ml", "google-ml-crash-course", "scikit-learn-user-guide"],
    },
    {
        "slug": "hr-interview-preparation",
        "category": "interview",
        "title": "HR Interview Preparation",
        "description": "Prepare structured examples, thoughtful questions, and clear interview responses.",
        "roles": ["hr-interview"],
        "topics": ["interview-questions", "communication", "behavioral-interview"],
        "resources": ["google-interview-tips", "hackerrank-interview-preparation-kit"],
    },
    {
        "slug": "video-interview-preparation",
        "category": "interview",
        "title": "Video Interview Preparation",
        "description": "Prepare your interview responses and check your video-call setup in advance.",
        "roles": ["video-interview"],
        "topics": ["video-interview", "device-check", "communication", "interview-questions"],
        "resources": ["google-interview-tips", "zoom-meeting-test"],
    },
)


async def seed_learning_library(db: AsyncSession) -> dict[str, int]:
    categories = {
        row.slug: row
        for row in (await db.scalars(select(LearningCategory))).all()
    }
    for slug, (title, description) in _CATEGORIES.items():
        if slug not in categories:
            category = LearningCategory(
                slug=slug, title=title, description=description, active=True
            )
            db.add(category)
            categories[slug] = category
    await db.flush()

    resources = {
        row.slug: row
        for row in (await db.scalars(select(LearningResource))).all()
    }
    verified_at = datetime.now(timezone.utc)
    for definition in _RESOURCES:
        slug = str(definition["slug"])
        if slug in resources:
            continue
        resource = LearningResource(
            slug=slug,
            category_id=categories[str(definition["category"])].id,
            title=str(definition["title"]),
            description=str(definition["description"]),
            url=str(definition["url"]),
            resource_type=str(definition["type"]),
            level=str(definition["level"]),
            role_tags=list(definition["roles"]),
            topic_tags=list(definition["topics"]),
            active=True,
            verified_at=verified_at,
        )
        db.add(resource)
        resources[slug] = resource
    await db.flush()

    paths = {
        row.slug: row for row in (await db.scalars(select(LearningPath))).all()
    }
    inserted_paths = 0
    inserted_assignments = 0
    for definition in _PATHS:
        slug = str(definition["slug"])
        path = paths.get(slug)
        if path is None:
            path = LearningPath(
                slug=slug,
                category_id=categories[str(definition["category"])].id,
                title=str(definition["title"]),
                description=str(definition["description"]),
                role_tags=list(definition["roles"]),
                topic_tags=list(definition["topics"]),
                active=True,
            )
            db.add(path)
            await db.flush()
            paths[slug] = path
            inserted_paths += 1
        existing_count = int(
            await db.scalar(
                select(LearningPathResource.id)
                .where(LearningPathResource.learning_path_id == path.id)
                .limit(1)
            )
            is not None
        )
        if existing_count:
            continue
        for position, resource_slug in enumerate(definition["resources"], start=1):
            db.add(
                LearningPathResource(
                    learning_path_id=path.id,
                    resource_id=resources[resource_slug].id,
                    position=position,
                )
            )
            inserted_assignments += 1
    await db.commit()
    return {
        "resources": len(_RESOURCES),
        "paths": len(_PATHS),
        "inserted_paths": inserted_paths,
        "inserted_assignments": inserted_assignments,
    }
