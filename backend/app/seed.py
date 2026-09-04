import asyncio
from datetime import date, timedelta
from app.core.database import async_session_factory
from app.core.security import hash_password
from app.models import User, UserRole, StudentProfile, CompanyProfile, Internship
from sqlalchemy import select

async def seed_data():
    async with async_session_factory() as session:
        # 1. Seed Admin Accounts
        admin_emails = [
            ("kamatammeghana.143@gmail.com", "MeghaN@123"),
            ("meghanakamatam.143@gmail.com", "MeghaN@123"),
            ("admin@platform.com", "Admin123!"),
            ("admin@internship.local", "AdminPass123!"),
        ]
        for email, pwd in admin_emails:
            existing = await session.scalar(select(User).where(User.email == email.lower()))
            if not existing:
                u = User(
                    email=email.lower(),
                    password_hash=hash_password(pwd),
                    role=UserRole.ADMIN,
                    is_verified=True,
                    is_active=True,
                )
                session.add(u)
            else:
                existing.password_hash = hash_password(pwd)
                existing.role = UserRole.ADMIN
                existing.is_verified = True
                existing.is_active = True

        # 2. Seed Company Account
        comp = await session.scalar(select(User).where(User.email == "recruiter@techcorp.com"))
        if not comp:
            comp = User(
                email="recruiter@techcorp.com",
                password_hash=hash_password("Company123!"),
                role=UserRole.COMPANY,
                is_verified=True,
                is_active=True,
            )
            session.add(comp)
            await session.flush()
            cp = CompanyProfile(
                user_id=comp.id,
                company_name="TechCorp AI",
                industry="Artificial Intelligence & Software",
                website="https://techcorp.ai",
                description="Global leader in autonomous AI engineering systems and cloud infrastructure.",
                verification_status="VERIFIED",
            )
            session.add(cp)
        else:
            comp.password_hash = hash_password("Company123!")
            comp.is_verified = True
            comp.is_active = True
            await session.flush()

        # 3. Seed Student Account
        stud = await session.scalar(select(User).where(User.email == "student@stanford.edu"))
        if not stud:
            stud = User(
                email="student@stanford.edu",
                password_hash=hash_password("Student123!"),
                role=UserRole.STUDENT,
                is_verified=True,
                is_active=True,
            )
            session.add(stud)
            await session.flush()
            sp = StudentProfile(
                user_id=stud.id,
                full_name="Alex Johnson",
                university="Stanford University",
                major="Computer Science & AI",
                graduation_year=2026,
                skills="Python, React, TypeScript, FastAPI, PostgreSQL",
                bio="Passionate software engineer focused on distributed web architectures and frontend UX.",
            )
            session.add(sp)
        else:
            stud.password_hash = hash_password("Student123!")
            stud.is_verified = True
            stud.is_active = True
            await session.flush()

        # 4. Seed Live Published Internships if none exist
        active_jobs = (await session.scalars(select(Internship).where(Internship.status == "PUBLISHED"))).all()
        if len(active_jobs) < 3 and comp:
            jobs_to_add = [
                {
                    "title": "Full Stack AI Engineer Intern",
                    "description": "Work directly with our core engineering team building LinkedIn-scale distributed microservices with FastAPI, React 19, and PostgreSQL.",
                    "location": "San Francisco, CA / Remote",
                    "industry": "Artificial Intelligence",
                    "duration_months": 3,
                    "stipend": 5500,
                    "work_mode": "HYBRID",
                    "skills": "Python,React,TypeScript,FastAPI",
                    "deadline": date.today() + timedelta(days=90),
                    "status": "PUBLISHED",
                },
                {
                    "title": "Frontend Software Engineer Intern",
                    "description": "Design and build beautiful, high-density user interfaces with Tailwind CSS, TypeScript, and modern component systems.",
                    "location": "New York, NY / Remote",
                    "industry": "Software Engineering",
                    "duration_months": 4,
                    "stipend": 4800,
                    "work_mode": "REMOTE",
                    "skills": "React,TypeScript,Tailwind,CSS",
                    "deadline": date.today() + timedelta(days=60),
                    "status": "PUBLISHED",
                },
                {
                    "title": "Backend Systems & Database Intern",
                    "description": "Optimize async SQLAlchemy 2 queries, architect resilient database migrations, and build high-throughput REST APIs.",
                    "location": "Seattle, WA / Remote",
                    "industry": "Cloud Computing",
                    "duration_months": 6,
                    "stipend": 5200,
                    "work_mode": "ONSITE",
                    "skills": "Python,FastAPI,PostgreSQL,Docker",
                    "deadline": date.today() + timedelta(days=45),
                    "status": "PUBLISHED",
                },
            ]
            for j in jobs_to_add:
                session.add(Internship(company_id=comp.id, **j))

        await session.commit()
        print("Data seeding completed successfully!")

if __name__ == "__main__":
    asyncio.run(seed_data())
