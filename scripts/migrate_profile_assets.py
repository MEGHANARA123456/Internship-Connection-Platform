"""Move existing profile assets to the configured backend in resumable batches."""

import argparse
import asyncio
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import async_session_factory
from app.models import CompanyDocument, CompanyProfile, Resume, StudentProfile
from app.services.asset_storage import (
    asset_key,
    get_asset_storage,
    legacy_avatar_key,
)


async def _move_rows(
    model,
    *,
    namespace: str,
    target_backend: str,
    batch_size: int,
    is_avatar: bool = False,
) -> int:
    target = get_asset_storage(target_backend)
    moved = 0
    last_id = 0

    while True:
        async with async_session_factory() as db:
            rows = list(
                await db.scalars(
                    select(model)
                    .where(model.id > last_id)
                    .order_by(model.id)
                    .limit(batch_size)
                )
            )
            if not rows:
                return moved

            for row in rows:
                last_id = row.id
                if is_avatar:
                    key = row.avatar_storage_key or legacy_avatar_key(row.avatar_url)
                    if not key:
                        continue
                    stored_name = key.rsplit("/", 1)[-1]
                else:
                    stored_name = row.stored_filename
                    key = row.storage_key or asset_key(namespace, stored_name)
                current_backend = (
                    (row.avatar_storage_backend or "local")
                    if is_avatar
                    else row.storage_backend
                )
                if current_backend == target_backend:
                    continue

                source = get_asset_storage(current_backend)
                content = await asyncio.to_thread(source.read_bytes, key)
                content_type = getattr(row, "content_type", None) or (
                    mimetypes.guess_type(stored_name)[0]
                    or "application/octet-stream"
                )
                if not await asyncio.to_thread(target.exists, key):
                    await asyncio.to_thread(
                        target.save, key, content, content_type
                    )
                elif await asyncio.to_thread(target.size, key) != len(content):
                    await asyncio.to_thread(
                        target.save, key, content, content_type
                    )

                if is_avatar:
                    row.avatar_storage_key = key
                    row.avatar_storage_backend = target_backend
                else:
                    row.storage_key = key
                    row.storage_backend = target_backend
                await db.commit()
                await asyncio.to_thread(source.delete, key)
                moved += 1
    return moved


async def migrate(target_backend: str, batch_size: int) -> dict[str, int]:
    result = {}
    assets = (
        ("resumes", Resume, "resumes", False),
        ("company_documents", CompanyDocument, "company_documents", False),
        ("student_avatars", StudentProfile, "avatars", True),
        ("company_avatars", CompanyProfile, "avatars", True),
    )
    for label, model, namespace, is_avatar in assets:
        result[label] = await _move_rows(
            model,
            namespace=namespace,
            target_backend=target_backend,
            batch_size=batch_size,
            is_avatar=is_avatar,
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Move profile assets to local or S3 storage and update DB rows."
    )
    parser.add_argument("--backend", choices=("local", "s3"))
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument(
        "--backup-confirmed",
        action="store_true",
        help="Confirm a database and local asset backup exists before migration.",
    )
    args = parser.parse_args()
    if not args.backup_confirmed:
        parser.error(
            "Create and verify a database backup and a copy of local asset folders, "
            "then pass --backup-confirmed."
        )
    if args.batch_size < 1:
        parser.error("--batch-size must be positive.")
    settings = get_settings()
    target_backend = args.backend or settings.asset_storage_backend
    if target_backend == "s3":
        get_asset_storage("s3", settings=settings)
    result = asyncio.run(migrate(target_backend, args.batch_size))
    for category, count in result.items():
        print(f"{category}: migrated {count} row(s)")


if __name__ == "__main__":
    main()
