"""Clear the temporary Google sign-up university value from student profiles."""

import argparse
import asyncio

from sqlalchemy import func, select, update

from app.core.database import async_session_factory
from app.models import StudentProfile


async def clear_university_campus(apply: bool) -> int:
    async with async_session_factory() as db:
        count = await db.scalar(
            select(func.count())
            .select_from(StudentProfile)
            .where(StudentProfile.university == "University Campus")
        )
        rows_to_change = int(count or 0)
        print(f"Rows matching university='University Campus': {rows_to_change}")

        if apply:
            result = await db.execute(
                update(StudentProfile)
                .where(StudentProfile.university == "University Campus")
                .values(university="")
            )
            await db.commit()
            print(f"Rows changed: {result.rowcount or 0}")
        else:
            await db.rollback()
            print("Dry run only; pass --apply to update these rows.")
        return rows_to_change


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Clear the temporary Google sign-up university value."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the update; without this flag, only report the number of matching rows.",
    )
    args = parser.parse_args()
    asyncio.run(clear_university_campus(args.apply))


if __name__ == "__main__":
    main()
