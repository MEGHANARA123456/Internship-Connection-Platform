import asyncio
import sys
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select
from app.core.database import async_session_factory
from app.core.security import hash_password
from app.models import User, UserRole

async def seed_data():
    async with async_session_factory() as session:
        print("[+] Initializing verified production administrative accounts...")

        admin_specs = [
            ("kamatammeghana.143@gmail.com", "MeghaN@123"),
            ("meghanakamatam.143@gmail.com", "MeghaN@123"),
            ("meghanakamatam25@gmail.com", "MeghaN@123"),
        ]

        for email, pwd in admin_specs:
            clean_email = email.strip().lower()
            existing = await session.scalar(select(User).where(User.email == clean_email))
            if not existing:
                session.add(
                    User(
                        email=clean_email,
                        password_hash=hash_password(pwd),
                        role=UserRole.ADMIN,
                        is_verified=True,
                        is_active=True,
                    )
                )
                print(f"  [+] Created admin account: {clean_email}")
            else:
                existing.password_hash = hash_password(pwd)
                existing.role = UserRole.ADMIN
                existing.is_verified = True
                existing.is_active = True
                print(f"  [*] Updated admin account: {clean_email}")

        await session.commit()
        print("[SUCCESS] Production database initialized with zero mock data.")

if __name__ == "__main__":
    asyncio.run(seed_data())
