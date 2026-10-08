import asyncio
from sqlalchemy import text
from app.core.database import engine

async def main():
    async with engine.begin() as c:
        await c.execute(text(
            "UPDATE student_profiles SET full_name = :n, university = :u, skills = :s "
            "WHERE user_id = 26"),
            {"n": "REAL NAME HERE", "u": "REAL UNIVERSITY HERE", "s": "REAL, SKILLS, HERE"})
asyncio.run(main())
