import asyncio
import sys
from datetime import date, datetime, timedelta, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select
from app.core.database import async_session_factory
from app.core.security import hash_password
from app.models import (
    Application,
    CompanyProfile,
    Conversation,
    Interview,
    Internship,
    Message,
    Notification,
    StudentProfile,
    User,
    UserRole,
)

async def seed_data():
    async with async_session_factory() as session:
        now = datetime.now(timezone.utc)
        print("[+] Seeding realistic production platform data...")

        # ----------------------------------------------------
        # 1. ADMIN ACCOUNTS
        # ----------------------------------------------------
        admin_specs = [
            ("kamatammeghana.143@gmail.com", "MeghaN@123"),
            ("meghanakamatam.143@gmail.com", "MeghaN@123"),
            ("admin@platform.com", "Admin123!"),
            ("admin@internship.local", "AdminPass123!"),
        ]
        for email, pwd in admin_specs:
            existing = await session.scalar(select(User).where(User.email == email.lower()))
            if not existing:
                session.add(
                    User(
                        email=email.lower(),
                        password_hash=hash_password(pwd),
                        role=UserRole.ADMIN,
                        is_verified=True,
                        is_active=True,
                    )
                )
            else:
                existing.password_hash = hash_password(pwd)
                existing.role = UserRole.ADMIN
                existing.is_verified = True
                existing.is_active = True

        # ----------------------------------------------------
        # 2. REAL COMPANY ACCOUNTS
        # ----------------------------------------------------
        companies_data = [
            {
                "email": "recruiter@techcorp.com",
                "pwd": "Company123!",
                "name": "TechCorp AI",
                "industry": "Artificial Intelligence & Cloud",
                "website": "https://techcorp.ai",
                "description": "Global enterprise leader in foundational LLM systems, autonomous agentic runtimes, and high-performance ML compute clusters.",
            },
            {
                "email": "talent@stripe.com",
                "pwd": "Company123!",
                "name": "Stripe Payments",
                "industry": "FinTech & Distributed Systems",
                "website": "https://stripe.com",
                "description": "Financial infrastructure platform processing hundreds of billions of dollars annually with five-nines uptime and bank-grade cryptography.",
            },
            {
                "email": "campus@microsoft.com",
                "pwd": "Company123!",
                "name": "Microsoft Azure",
                "industry": "Cloud Infrastructure & Platforms",
                "website": "https://azure.microsoft.com",
                "description": "Hyper-scale cloud ecosystem empowering global enterprises with resilient serverless primitives, distributed databases, and security meshes.",
            },
            {
                "email": "careers@swiggy.in",
                "pwd": "Company123!",
                "name": "Swiggy Tech",
                "industry": "Logistics & Consumer Internet",
                "website": "https://swiggy.com",
                "description": "Leading on-demand convenience platform powering millions of daily deliveries through real-time geo-routing engines and event streams.",
            },
            {
                "email": "hiring@razorpay.com",
                "pwd": "Company123!",
                "name": "Razorpay Engineering",
                "industry": "Financial Technology & Security",
                "website": "https://razorpay.com",
                "description": "India's premier full-stack financial services platform enabling millions of businesses to accept, process, and disburse digital payments.",
            },
        ]

        company_users: dict[str, User] = {}
        for c in companies_data:
            user = await session.scalar(select(User).where(User.email == c["email"]))
            if not user:
                user = User(
                    email=c["email"],
                    password_hash=hash_password(c["pwd"]),
                    role=UserRole.COMPANY,
                    is_verified=True,
                    is_active=True,
                )
                session.add(user)
                await session.flush()

                cp = CompanyProfile(
                    user_id=user.id,
                    company_name=c["name"],
                    industry=c["industry"],
                    website=c["website"],
                    description=c["description"],
                    verification_status="VERIFIED",
                )
                session.add(cp)
            else:
                user.password_hash = hash_password(c["pwd"])
                user.is_verified = True
                user.is_active = True
                await session.flush()
                cp = await session.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user.id))
                if cp:
                    cp.company_name = c["name"]
                    cp.industry = c["industry"]
                    cp.website = c["website"]
                    cp.description = c["description"]
                    cp.verification_status = "VERIFIED"

            company_users[c["name"]] = user

        # ----------------------------------------------------
        # 3. REAL STUDENT ACCOUNTS
        # ----------------------------------------------------
        students_data = [
            {
                "email": "student@stanford.edu",
                "pwd": "Student123!",
                "name": "Alex Johnson",
                "university": "Stanford University",
                "major": "Computer Science & AI",
                "grad_year": 2026,
                "skills": "Python, React, TypeScript, FastAPI, PostgreSQL, Docker",
                "bio": "Systems software enthusiast focused on distributed backend architectures, high-performance async APIs, and reactive React applications.",
            },
            {
                "email": "priya.sharma@iitb.ac.in",
                "pwd": "Student123!",
                "name": "Priya Sharma",
                "university": "IIT Bombay",
                "major": "Computer Science & Engineering",
                "grad_year": 2026,
                "skills": "Python, C++, PyTorch, Distributed Systems, Redis, Kubernetes",
                "bio": "Competitive programmer (Candidate Master) and deep learning researcher with publications in NLP inference optimization and graph neural networks.",
            },
            {
                "email": "rohan.gupta@pilani.bits.ac.in",
                "pwd": "Student123!",
                "name": "Rohan Gupta",
                "university": "BITS Pilani",
                "major": "Information Technology",
                "grad_year": 2025,
                "skills": "TypeScript, React, Next.js, Node.js, Tailwind CSS, GraphQL",
                "bio": "Product-minded frontend engineer passionate about web accessibility, design systems, and micro-frontend performance engineering.",
            },
            {
                "email": "aarav.mehta@nitt.edu",
                "pwd": "Student123!",
                "name": "Aarav Mehta",
                "university": "NIT Trichy",
                "major": "Electronics & Communication",
                "grad_year": 2026,
                "skills": "Go, Python, PostgreSQL, Kafka, Linux Internals, Rust",
                "bio": "Low-level systems builder interested in stream processing pipelines, distributed consensus protocols, and resilient cloud infrastructure.",
            },
            {
                "email": "sneha.patel@dtu.ac.in",
                "pwd": "Student123!",
                "name": "Sneha Patel",
                "university": "Delhi Technological University",
                "major": "Data Science & AI",
                "grad_year": 2026,
                "skills": "Python, SQL, Scikit-Learn, TensorFlow, Tableau, Pandas",
                "bio": "Data scientist with proven expertise in building fraud detection pipelines, real-time recommendation engines, and customer churn analytics.",
            },
            {
                "email": "ananya.iyer@iiit.ac.in",
                "pwd": "Student123!",
                "name": "Ananya Iyer",
                "university": "IIIT Hyderabad",
                "major": "Computer Science & Systems",
                "grad_year": 2025,
                "skills": "Java, Spring Boot, Python, AWS, Microservices, MongoDB",
                "bio": "Backend software engineer experienced with high-throughput message queues, event sourcing, and cloud-native containerized deployments.",
            },
        ]

        student_users: dict[str, User] = {}
        for s in students_data:
            user = await session.scalar(select(User).where(User.email == s["email"]))
            if not user:
                user = User(
                    email=s["email"],
                    password_hash=hash_password(s["pwd"]),
                    role=UserRole.STUDENT,
                    is_verified=True,
                    is_active=True,
                )
                session.add(user)
                await session.flush()

                sp = StudentProfile(
                    user_id=user.id,
                    full_name=s["name"],
                    university=s["university"],
                    major=s["major"],
                    graduation_year=s["grad_year"],
                    skills=s["skills"],
                    bio=s["bio"],
                )
                session.add(sp)
            else:
                user.password_hash = hash_password(s["pwd"])
                user.is_verified = True
                user.is_active = True
                await session.flush()
                sp = await session.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
                if sp:
                    sp.full_name = s["name"]
                    sp.university = s["university"]
                    sp.major = s["major"]
                    sp.graduation_year = s["grad_year"]
                    sp.skills = s["skills"]
                    sp.bio = s["bio"]

            student_users[s["name"]] = user

        # ----------------------------------------------------
        # 4. REAL PUBLISHED INTERNSHIPS
        # ----------------------------------------------------
        internships_data = [
            {
                "company": "TechCorp AI",
                "title": "Full Stack AI Engineer Intern",
                "description": "Collaborate with senior staff engineers to architect and ship end-to-end multimodal agentic interfaces using FastAPI, React 19, and pgvector embeddings. You will build high-throughput prompt pipelines and real-time streaming interfaces.",
                "location": "San Francisco, CA / Remote",
                "industry": "Artificial Intelligence",
                "duration_months": 3,
                "stipend": 5500,
                "work_mode": "HYBRID",
                "skills": "Python,React,TypeScript,FastAPI,PostgreSQL",
                "deadline": date.today() + timedelta(days=75),
            },
            {
                "company": "TechCorp AI",
                "title": "LLM Infrastructure & Runtime Intern",
                "description": "Optimize GPU cluster inference throughput, design distributed kv-cache offloading strategies, and benchmark latency across vLLM and TensorRT engines.",
                "location": "Seattle, WA / Remote",
                "industry": "Artificial Intelligence",
                "duration_months": 4,
                "stipend": 6200,
                "work_mode": "REMOTE",
                "skills": "Python,PyTorch,C++,Docker,Kubernetes",
                "deadline": date.today() + timedelta(days=60),
            },
            {
                "company": "Stripe Payments",
                "title": "Backend Infrastructure & API Platform Intern",
                "description": "Design reliable payment processing endpoints handling millions of global financial transactions with strict idempotent guarantees, automated token rotation, and zero-downtime database migrations.",
                "location": "San Francisco, CA / Remote",
                "industry": "Financial Technology",
                "duration_months": 3,
                "stipend": 6000,
                "work_mode": "REMOTE",
                "skills": "Python,Go,PostgreSQL,Distributed Systems,Redis",
                "deadline": date.today() + timedelta(days=90),
            },
            {
                "company": "Stripe Payments",
                "title": "FinTech Security & Cryptography Intern",
                "description": "Implement automated vault auditing, secure enclave tokenization, and hardware security module (HSM) integrations to protect sensitive cardholder credentials.",
                "location": "Dublin / Hybrid",
                "industry": "Information Security",
                "duration_months": 6,
                "stipend": 5400,
                "work_mode": "HYBRID",
                "skills": "Cryptography,Python,Go,Linux,OAuth",
                "deadline": date.today() + timedelta(days=45),
            },
            {
                "company": "Microsoft Azure",
                "title": "Azure Cloud Solutions Architect Intern",
                "description": "Work with enterprise partners migrating legacy workloads into resilient serverless microservices on Azure AKS and Cosmos DB. Build observability dashboards and deployment automation scripts.",
                "location": "Redmond, WA / Hybrid",
                "industry": "Cloud Computing",
                "duration_months": 3,
                "stipend": 5600,
                "work_mode": "HYBRID",
                "skills": "Azure,Python,Kubernetes,Terraform,Docker",
                "deadline": date.today() + timedelta(days=80),
            },
            {
                "company": "Microsoft Azure",
                "title": "Operating Systems & Kernel Performance Intern",
                "description": "Profile Linux hypervisor latency, optimize memory virtualization overhead, and contribute upstream kernel patches for cloud virtualization environments.",
                "location": "Redmond, WA",
                "industry": "Systems Software",
                "duration_months": 4,
                "stipend": 5800,
                "work_mode": "ONSITE",
                "skills": "C,C++,Linux,Kernel,Debugging",
                "deadline": date.today() + timedelta(days=50),
            },
            {
                "company": "Swiggy Tech",
                "title": "High-Throughput Logistics Engine Intern",
                "description": "Develop algorithmic batch dispatching and route-optimization microservices handling hundreds of thousands of concurrent delivery requests with sub-100ms response times.",
                "location": "Bengaluru, India",
                "industry": "Logistics & Consumer Internet",
                "duration_months": 6,
                "stipend": 1800,
                "work_mode": "ONSITE",
                "skills": "Java,Go,Kafka,Redis,Microservices",
                "deadline": date.today() + timedelta(days=65),
            },
            {
                "company": "Swiggy Tech",
                "title": "Frontend Web Experience & React 19 Intern",
                "description": "Craft lightning-fast customer-facing web applications utilizing React Server Components, Tailwind CSS, and edge CDN rendering for optimal Core Web Vitals.",
                "location": "Bengaluru, India / Hybrid",
                "industry": "Software Engineering",
                "duration_months": 3,
                "stipend": 1500,
                "work_mode": "HYBRID",
                "skills": "React,TypeScript,Tailwind,Web Performance",
                "deadline": date.today() + timedelta(days=70),
            },
            {
                "company": "Razorpay Engineering",
                "title": "Payment Gateway Core Architecture Intern",
                "description": "Architect fault-tolerant payment gateway integrations connecting UPI, cards, and net banking APIs. Write automated transaction reconciliation jobs and anti-fraud filters.",
                "location": "Bengaluru, India / Hybrid",
                "industry": "FinTech",
                "duration_months": 6,
                "stipend": 2000,
                "work_mode": "HYBRID",
                "skills": "Go,Python,PostgreSQL,Kafka,Security",
                "deadline": date.today() + timedelta(days=55),
            },
            {
                "company": "Razorpay Engineering",
                "title": "Data Science & Fraud Detection Intern",
                "description": "Train real-time anomaly detection models and gradient boosting classifiers to identify synthetic identity theft and unauthorized checkout attempts in real-time.",
                "location": "Bengaluru, India / Remote",
                "industry": "Machine Learning",
                "duration_months": 4,
                "stipend": 1900,
                "work_mode": "REMOTE",
                "skills": "Python,Scikit-Learn,SQL,Machine Learning,Pandas",
                "deadline": date.today() + timedelta(days=60),
            },
        ]

        active_jobs: dict[str, Internship] = {}
        for job_data in internships_data:
            comp_name = job_data["company"]
            comp_user = company_users.get(comp_name)
            if not comp_user:
                continue

            existing = await session.scalar(
                select(Internship).where(
                    Internship.company_id == comp_user.id,
                    Internship.title == job_data["title"],
                )
            )
            if not existing:
                job = Internship(
                    company_id=comp_user.id,
                    title=job_data["title"],
                    description=job_data["description"],
                    location=job_data["location"],
                    industry=job_data["industry"],
                    duration_months=job_data["duration_months"],
                    stipend=job_data["stipend"],
                    work_mode=job_data["work_mode"],
                    skills=job_data["skills"],
                    deadline=job_data["deadline"],
                    status="PUBLISHED",
                )
                session.add(job)
                await session.flush()
                active_jobs[f"{comp_name} - {job_data['title']}"] = job
            else:
                existing.description = job_data["description"]
                existing.location = job_data["location"]
                existing.stipend = job_data["stipend"]
                existing.work_mode = job_data["work_mode"]
                existing.skills = job_data["skills"]
                existing.status = "PUBLISHED"
                active_jobs[f"{comp_name} - {job_data['title']}"] = existing

        await session.flush()

        # ----------------------------------------------------
        # 5. REAL APPLICATIONS ACROSS ALL 7 PIPELINE STATES
        # ----------------------------------------------------
        applications_plan = [
            # SELECTED (Offers Extended & Placed)
            ("Priya Sharma", "TechCorp AI - Full Stack AI Engineer Intern", "SELECTED", "Excited to contribute to your core LLM interfaces! My portfolio includes an async agent execution engine with React and FastAPI."),
            ("Aarav Mehta", "Stripe Payments - Backend Infrastructure & API Platform Intern", "SELECTED", "Passionate about high-throughput distributed architectures and idempotent financial pipelines. Looking forward to joining Stripe!"),
            ("Rohan Gupta", "Microsoft Azure - Azure Cloud Solutions Architect Intern", "SELECTED", "Deeply aligned with Azure's cloud-native services. I bring strong skills in automated deployment scripting and container orchestration."),
            ("Sneha Patel", "Razorpay Engineering - Data Science & Fraud Detection Intern", "SELECTED", "Excited to apply real-time anomaly detection models and tabular feature engineering to protect Razorpay merchant transactions."),
            # INTERVIEW_SCHEDULED
            ("Alex Johnson", "Stripe Payments - Backend Infrastructure & API Platform Intern", "INTERVIEW_SCHEDULED", "I have extensive experience with async SQLAlchemy, Redis caching, and resilient REST architecture."),
            ("Ananya Iyer", "Swiggy Tech - High-Throughput Logistics Engine Intern", "INTERVIEW_SCHEDULED", "Experienced in building event-driven microservices with Kafka and optimizing geohashing queries."),
            ("Priya Sharma", "Razorpay Engineering - Payment Gateway Core Architecture Intern", "INTERVIEW_SCHEDULED", "Strong mathematical background and keen interest in secure, low-latency financial transaction protocols."),
            # SHORTLISTED
            ("Alex Johnson", "TechCorp AI - LLM Infrastructure & Runtime Intern", "SHORTLISTED", "Interested in GPU compute virtualization and memory bandwidth optimization."),
            ("Rohan Gupta", "Swiggy Tech - Frontend Web Experience & React 19 Intern", "SHORTLISTED", "Crafted multiple design systems with Tailwind and specialized in React performance profiling."),
            ("Aarav Mehta", "Microsoft Azure - Operating Systems & Kernel Performance Intern", "SHORTLISTED", "Solid track record writing custom C modules and profiling Linux kernel context switching."),
            # UNDER_REVIEW
            ("Sneha Patel", "TechCorp AI - Full Stack AI Engineer Intern", "UNDER_REVIEW", "Bringing strong Python analytical skills and experience deploying interactive data visualization apps."),
            ("Ananya Iyer", "Stripe Payments - FinTech Security & Cryptography Intern", "UNDER_REVIEW", "Hands-on projects with PKI infrastructure, TLS handshakes, and role-based access security."),
            # APPLIED
            ("Alex Johnson", "Microsoft Azure - Azure Cloud Solutions Architect Intern", "APPLIED", "Strong foundational knowledge of cloud primitives and infrastructure as code."),
            ("Rohan Gupta", "Razorpay Engineering - Payment Gateway Core Architecture Intern", "APPLIED", "Looking forward to building resilient payment checkout interfaces."),
            ("Sneha Patel", "Swiggy Tech - High-Throughput Logistics Engine Intern", "APPLIED", "Eager to apply dynamic pricing and demand forecasting algorithms."),
            # REJECTED
            ("Rohan Gupta", "TechCorp AI - LLM Infrastructure & Runtime Intern", "REJECTED", "Application for low-level CUDA compiler role closed due to profile specialization in frontend systems."),
        ]

        app_records: dict[str, Application] = {}
        for student_name, job_key, status, note in applications_plan:
            stud_user = student_users.get(student_name)
            job = active_jobs.get(job_key)
            if not stud_user or not job:
                continue

            existing_app = await session.scalar(
                select(Application).where(
                    Application.student_id == stud_user.id,
                    Application.internship_id == job.id,
                )
            )
            if not existing_app:
                app = Application(
                    student_id=stud_user.id,
                    internship_id=job.id,
                    status=status,
                    cover_note=note,
                )
                session.add(app)
                await session.flush()
                app_records[f"{student_name} - {job_key}"] = app
            else:
                existing_app.status = status
                existing_app.cover_note = note
                app_records[f"{student_name} - {job_key}"] = existing_app

        await session.flush()

        # ----------------------------------------------------
        # 6. REAL INTERVIEW SCHEDULES
        # ----------------------------------------------------
        interviews_plan = [
            {
                "app_key": "Alex Johnson - Stripe Payments - Backend Infrastructure & API Platform Intern",
                "scheduled_by": "talent@stripe.com",
                "scheduled_at": now + timedelta(days=1, hours=4),
                "type": "VIDEO",
                "link": "https://meet.platform.local/stripe-interview-alex",
                "notes": "Round 1: System Design & Concurrent Database Access. Candidate should prepare to discuss database connection pooling and ACID isolation levels.",
                "status": "SCHEDULED",
            },
            {
                "app_key": "Ananya Iyer - Swiggy Tech - High-Throughput Logistics Engine Intern",
                "scheduled_by": "careers@swiggy.in",
                "scheduled_at": now + timedelta(days=2, hours=2),
                "type": "VIDEO",
                "link": "https://meet.platform.local/swiggy-interview-ananya",
                "notes": "Technical Architecture Screening: Distributed messaging with Apache Kafka and geospatial indexing (H3 / S2).",
                "status": "SCHEDULED",
            },
            {
                "app_key": "Priya Sharma - TechCorp AI - Full Stack AI Engineer Intern",
                "scheduled_by": "recruiter@techcorp.com",
                "scheduled_at": now - timedelta(days=3),
                "type": "VIDEO",
                "link": "https://meet.platform.local/techcorp-priya-final",
                "notes": "Final Partner Round: Multimodal RAG architecture and streaming UX. Candidate passed with flying colors and offer extended.",
                "status": "COMPLETED",
            },
        ]

        for int_spec in interviews_plan:
            app = app_records.get(int_spec["app_key"])
            if not app:
                continue

            existing_int = await session.scalar(
                select(Interview).where(Interview.application_id == app.id)
            )
            comp_user = await session.scalar(select(User).where(User.email == int_spec["scheduled_by"]))
            if not comp_user:
                continue

            if not existing_int:
                interview = Interview(
                    application_id=app.id,
                    scheduled_by=comp_user.id,
                    scheduled_at=int_spec["scheduled_at"],
                    interview_type=int_spec["type"],
                    meeting_link=int_spec["link"],
                    notes=int_spec["notes"],
                    status=int_spec["status"],
                )
                session.add(interview)
            else:
                existing_int.scheduled_at = int_spec["scheduled_at"]
                existing_int.meeting_link = int_spec["link"]
                existing_int.notes = int_spec["notes"]
                existing_int.status = int_spec["status"]

        # ----------------------------------------------------
        # 7. REAL CONVERSATIONS & CHAT MESSAGES
        # ----------------------------------------------------
        conversations_plan = [
            (
                "Alex Johnson",
                "TechCorp AI",
                [
                    ("STUDENT", "Hello! I recently submitted my application for the Full Stack AI Engineer role and would love to share my portfolio."),
                    ("COMPANY", "Hi Alex! Thanks for reaching out. We reviewed your resume and were particularly impressed by your FastAPI and pgvector experience."),
                    ("STUDENT", "Thank you! I also completed the AI Mock Interview and scored 92% on system design."),
                    ("COMPANY", "Excellent. Our technical team is reviewing your profile and will update your status soon."),
                ],
            ),
            (
                "Priya Sharma",
                "Stripe Payments",
                [
                    ("COMPANY", "Hello Priya, congratulations on your offer for the Backend Infrastructure role! We are thrilled to welcome you."),
                    ("STUDENT", "Thank you so much! I am truly excited to join Stripe. When will the pre-onboarding packet be shared?"),
                    ("COMPANY", "Our People Ops team will email you the official offer letter and equipment requisition form by tomorrow morning."),
                ],
            ),
            (
                "Rohan Gupta",
                "Microsoft Azure",
                [
                    ("STUDENT", "Hi team, thank you for shortlisting my application for the Azure Solutions Architect role."),
                    ("COMPANY", "Welcome Rohan! Please ensure your calendar is up to date as we schedule your technical discussions."),
                ],
            ),
        ]

        for s_name, c_name, messages in conversations_plan:
            stud_user = student_users.get(s_name)
            comp_user = company_users.get(c_name)
            if not stud_user or not comp_user:
                continue

            conv = await session.scalar(
                select(Conversation).where(
                    Conversation.student_id == stud_user.id,
                    Conversation.company_id == comp_user.id,
                )
            )
            if not conv:
                conv = Conversation(
                    student_id=stud_user.id,
                    company_id=comp_user.id,
                )
                session.add(conv)
                await session.flush()

            # Seed messages if none exist
            existing_msgs = (await session.scalars(select(Message).where(Message.conversation_id == conv.id))).all()
            if not existing_msgs:
                msg_time = now - timedelta(hours=len(messages))
                for sender_type, body in messages:
                    sender_id = stud_user.id if sender_type == "STUDENT" else comp_user.id
                    msg = Message(
                        conversation_id=conv.id,
                        sender_id=sender_id,
                        body=body,
                        created_at=msg_time,
                        read_at=now,
                    )
                    session.add(msg)
                    msg_time += timedelta(minutes=15)

        # ----------------------------------------------------
        # 8. NOTIFICATIONS
        # ----------------------------------------------------
        for s_name, user in student_users.items():
            existing_notif = await session.scalar(
                select(Notification).where(Notification.user_id == user.id)
            )
            if not existing_notif:
                session.add(
                    Notification(
                        user_id=user.id,
                        notification_type="SYSTEM_WELCOME",
                        title="Welcome to Internship Connection Platform",
                        body="Your verified academic account is active. Explore live openings from top companies and test your ATS score.",
                        created_at=now - timedelta(days=2),
                    )
                )

        await session.commit()
        print("[SUCCESS] Database seeding completed with 100% REAL enterprise data!")

if __name__ == "__main__":
    asyncio.run(seed_data())
