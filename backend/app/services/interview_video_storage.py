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

    def iter_recording(self, storage_key: str) -> Iterator[bytes]: ...

    def delete(self, storage_key: str) -> None: ...


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

    def iter_recording(self, storage_key: str) -> Iterator[bytes]:
        path = self.recording_path(storage_key)
        with path.open("rb") as file:
            while content := file.read(64 * 1024):
                yield content

    def delete(self, storage_key: str) -> None:
        shutil.rmtree(self._directory(storage_key), ignore_errors=True)

    def _directory(self, storage_key: str) -> Path:
        try:
            parsed = uuid.UUID(storage_key)
        except (ValueError, AttributeError) as error:
            raise ValueError("Invalid interview recording key") from error
        if str(parsed) != storage_key:
            raise ValueError("Invalid interview recording key")
        return self.root / storage_key
