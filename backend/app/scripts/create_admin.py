"""Create the first InternSphere administrator from a terminal."""

import argparse
import asyncio
from getpass import getpass
import sys

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.core.security import hash_password
from app.models import User, UserRole
from app.schemas.admin import AdminCreate
from app.services.audit import write_audit
from app.services.email_validation import validate_email_format


async def create_admin_user(db: AsyncSession, email: str, password: str) -> User:
    data = AdminCreate(email=email, password=password)
    clean_email = validate_email_format(data.email)
    if await db.scalar(select(User.id).where(User.email == clean_email)):
        raise ValueError(f"An account with {clean_email} already exists.")

    user = User(
        email=clean_email,
        password_hash=hash_password(data.password),
        role=UserRole.ADMIN,
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    await write_audit(
        db,
        actor=None,
        action="admin_created",
        target_type="user",
        target_id=user.id,
        metadata={"email": clean_email},
    )
    await db.commit()
    await db.refresh(user)
    return user


async def _create_admin(email: str, password: str) -> User:
    async with async_session_factory() as db:
        return await create_admin_user(db, email, password)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first InternSphere administrator.")
    parser.add_argument("email", help="Email address for the new administrator")
    args = parser.parse_args()

    password = getpass("New administrator password: ")
    confirmation = getpass("Confirm password: ")
    if password != confirmation:
        parser.error("Passwords do not match.")

    try:
        user = asyncio.run(_create_admin(args.email, password))
    except (ValidationError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
    print(f"Created administrator {user.email} (id {user.id}).")


if __name__ == "__main__":
    main()
