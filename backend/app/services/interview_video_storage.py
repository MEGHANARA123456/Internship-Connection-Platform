"""Private storage adapter for chunked interview recordings."""

import os
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Protocol


class InterviewVideoStorage(Protocol):
    def write_chunk(self, storage_key: str, index: int, content: bytes) -> None: ...

    def assemble(self, storage_key: str, chunk_count: int) -> Path: ...

    def remove_chunks(self, storage_key: str, chunk_count: int) -> None: ...

    def recording_path(self, storage_key: str) -> Path: ...

    def save_from_path(
        self,
        path: Path,
        *,
        source_type: str,
        user_id: int,
        session_id: int,
        storage_key: str,
        mime_type: str,
    ) -> str | None: ...

    def open_stream(
        self,
        storage_key: str,
        *,
        file_id: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]: ...

    def delete(self, storage_key: str, *, file_id: str | None = None) -> None: ...

    def remove_staging(self, storage_key: str) -> None: ...

    def exists(self, storage_key: str, *, file_id: str | None = None) -> bool: ...

    def size(self, storage_key: str, *, file_id: str | None = None) -> int: ...

    def find_file_id(
        self,
        *,
        source_type: str,
        user_id: int,
        session_id: int,
        storage_key: str,
    ) -> str | None: ...


class LocalPrivateInterviewVideoStorage:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)

    def write_chunk(self, storage_key: str, index: int, content: bytes) -> None:
        directory = self._directory(storage_key)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory, 0o700)
        destination = directory / f"chunk-{index:06d}.part"
        temporary = directory / f".{uuid.uuid4().hex}.tmp"
        try:
            with temporary.open("xb") as file:
                os.chmod(temporary, 0o600)
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def assemble(self, storage_key: str, chunk_count: int) -> Path:
        directory = self._directory(storage_key)
        temporary = directory / f".{uuid.uuid4().hex}.tmp"
        destination = directory / "recording"
        try:
            with temporary.open("xb") as output:
                os.chmod(temporary, 0o600)
                for index in range(chunk_count):
                    source = directory / f"chunk-{index:06d}.part"
                    with source.open("rb") as part:
                        shutil.copyfileobj(part, output, length=64 * 1024)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return destination

    def remove_chunks(self, storage_key: str, chunk_count: int) -> None:
        directory = self._directory(storage_key)
        for index in range(chunk_count):
            (directory / f"chunk-{index:06d}.part").unlink(missing_ok=True)

    def recording_path(self, storage_key: str) -> Path:
        return self._directory(storage_key) / "recording"

    def save_from_path(
        self,
        path: Path,
        *,
        source_type: str,
        user_id: int,
        session_id: int,
        storage_key: str,
        mime_type: str,
    ) -> None:
        return None

    def open_stream(
        self,
        storage_key: str,
        *,
        file_id: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]:
        path = self.recording_path(storage_key)
        with path.open("rb") as file:
            if start is not None:
                file.seek(start)
            remaining = None if end is None else end - (start or 0) + 1
            while content := file.read(64 * 1024):
                if remaining is not None:
                    content = content[:remaining]
                    remaining -= len(content)
                if content:
                    yield content
                if remaining == 0:
                    break

    def iter_recording(self, storage_key: str) -> Iterator[bytes]:
        yield from self.open_stream(storage_key)

    def delete(self, storage_key: str, *, file_id: str | None = None) -> None:
        self.remove_staging(storage_key)

    def remove_staging(self, storage_key: str) -> None:
        shutil.rmtree(self._directory(storage_key), ignore_errors=True)

    def exists(self, storage_key: str, *, file_id: str | None = None) -> bool:
        return self.recording_path(storage_key).is_file()

    def size(self, storage_key: str, *, file_id: str | None = None) -> int:
        return self.recording_path(storage_key).stat().st_size

    def find_file_id(
        self,
        *,
        source_type: str,
        user_id: int,
        session_id: int,
        storage_key: str,
    ) -> None:
        return None

    def _directory(self, storage_key: str) -> Path:
        try:
            parsed = uuid.UUID(storage_key)
        except (ValueError, AttributeError) as error:
            raise ValueError("Invalid interview recording key") from error
        if str(parsed) != storage_key:
            raise ValueError("Invalid interview recording key")
        return self.root / storage_key
