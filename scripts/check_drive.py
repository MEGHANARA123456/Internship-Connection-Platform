"""Verify private Google Drive upload, ranged streaming, and deletion."""

import asyncio
import hashlib
import sys
import tempfile
import uuid
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import get_settings
from app.services.interview_video_gdrive import (
    GoogleDriveInterviewStorage,
    InterviewStorageError,
)


TEST_SIZE = 1024 * 1024
RANGE_START = 4096
RANGE_END = 8191


async def main() -> int:
    settings = get_settings()
    if settings.storage_backend != "gdrive":
        print("FAIL: configure STORAGE_BACKEND=gdrive in the environment.")
        return 1

    storage = GoogleDriveInterviewStorage(
        settings.interview_video_storage_path,
        settings.google_service_account_json,
        settings.gdrive_folder_id,
    )
    storage_key = f"drive-check-{uuid.uuid4()}"
    file_id: str | None = None

    try:
        await asyncio.to_thread(storage.health_check)
        with tempfile.TemporaryDirectory(prefix="internsphere-drive-check-") as temp_dir:
            path = Path(temp_dir) / "drive-check.bin"
            payload = bytes(range(256)) * (TEST_SIZE // 256)
            path.write_bytes(payload)

            file_id = await asyncio.to_thread(
                storage.save_from_path,
                path,
                source_type="mock",
                user_id="test",
                session_id="test",
                storage_key=storage_key,
                mime_type="application/octet-stream",
            )
            remote_size = await asyncio.to_thread(
                storage.size,
                storage_key,
                file_id=file_id,
            )
            ranged_bytes = await asyncio.to_thread(
                lambda: b"".join(
                    storage.open_stream(
                        storage_key,
                        file_id=file_id,
                        start=RANGE_START,
                        end=RANGE_END,
                    )
                )
            )
            if remote_size != TEST_SIZE:
                raise RuntimeError("uploaded_size_mismatch")
            if ranged_bytes != payload[RANGE_START : RANGE_END + 1]:
                raise RuntimeError("range_content_mismatch")

            print(
                "Upload and Range stream: PASS "
                f"({remote_size} bytes; range {RANGE_START}-{RANGE_END}; "
                f"sha256={hashlib.sha256(ranged_bytes).hexdigest()})"
            )

        uploaded_file_id = file_id
        await asyncio.to_thread(
            storage.delete,
            storage_key,
            file_id=uploaded_file_id,
        )
        file_id = None
        if await asyncio.to_thread(
            storage.exists,
            storage_key,
            file_id=uploaded_file_id,
        ):
            raise RuntimeError("drive_file_remains")
        print("Drive deletion: PASS")
        return 0
    except InterviewStorageError as error:
        print(
            "Drive check: FAIL "
            f"(code={error.code}, http_status={error.status_code})"
        )
        return 1
    except Exception as error:
        print(f"Drive check: FAIL (error_type={type(error).__name__})")
        return 1
    finally:
        if file_id is not None:
            try:
                await asyncio.to_thread(storage.delete, storage_key, file_id=file_id)
            except Exception:
                print("Cleanup warning: test file deletion needs manual verification.")


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
