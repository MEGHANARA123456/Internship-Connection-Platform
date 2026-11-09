"""Export a read-only audit of all persisted skill-question answer keys."""

import argparse
import asyncio
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.core.database import async_session_factory, engine
from app.models import SkillQuestion
from app.services.question_key_audit import question_key_audit_csv


async def _run(output: Path | None) -> None:
    async with async_session_factory() as session:
        questions = list(await session.scalars(select(SkillQuestion).order_by(SkillQuestion.id)))
        content = question_key_audit_csv(questions)
    if output:
        output.write_bytes(content)
    else:
        sys.stdout.buffer.write(content)
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="CSV output path; defaults to stdout")
    args = parser.parse_args()
    asyncio.run(_run(args.output))


if __name__ == "__main__":
    main()
