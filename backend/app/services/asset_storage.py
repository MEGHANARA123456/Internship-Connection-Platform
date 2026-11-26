"""Private object storage for resumes, company documents, and avatars."""

import logging
import os
import re
import tempfile
from contextlib import contextmanager
import uuid
from collections.abc import Iterator
from pathlib import Path, PurePosixPath
from typing import Protocol
from urllib.parse import unquote, urlparse

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)
CHUNK_SIZE = 64 * 1024
_SAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._ -]+")
_LEGACY_AVATAR_NAME = re.compile(
    r"avatar_\d+_[a-f0-9]{8}(?:[a-f0-9]{24})?\.(?:jpg|jpeg|png|webp|svg|gif)"
)


class AssetStorage(Protocol):
    def save(self, key: str, content: bytes, content_type: str) -> None: ...

    def open_stream(self, key: str) -> Iterator[bytes]: ...

    def read_bytes(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...

    def size(self, key: str) -> int: ...

    def delete(self, key: str) -> None: ...


def _validate_key(key: str) -> PurePosixPath:
    path = PurePosixPath(key)
    if (
        not key
        or "\\" in key
        or path.is_absolute()
        or str(path) != key
        or len(path.parts) != 2
        or any(part in {"", ".", ".."} for part in path.parts)
        or path.parts[0] not in {"resumes", "company_documents", "avatars"}
    ):
        raise ValueError("Invalid asset storage key")
    return path


class LocalAssetStorage:
    def __init__(
        self,
        resume_root: str | Path,
        company_document_root: str | Path,
        avatar_root: str | Path,
    ):
        self.roots = {
            "resumes": Path(resume_root).resolve(),
            "company_documents": Path(company_document_root).resolve(),
            "avatars": Path(avatar_root).resolve(),
        }

    def _path(self, key: str) -> Path:
        relative = _validate_key(key)
        root = self.roots[relative.parts[0]]
        path = (root / Path(*relative.parts[1:])).resolve()
        if path == root or root not in path.parents:
            raise ValueError("Invalid asset storage key")
        return path

    def save(self, key: str, content: bytes, content_type: str) -> None:
        del content_type
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(destination.parent, 0o700)
        temporary = destination.with_name(f".{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as file:
                os.chmod(temporary, 0o600)
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def open_stream(self, key: str) -> Iterator[bytes]:
        with self._path(key).open("rb") as file:
            while content := file.read(CHUNK_SIZE):
                yield content

    def read_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def size(self, key: str) -> int:
        return self._path(key).stat().st_size

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class S3AssetStorage:
    """S3-compatible private bucket storage, including Cloudflare R2 endpoints."""

    def __init__(
        self,
        *,
        endpoint_url: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        region: str,
        client=None,
    ):
        if not all((bucket, access_key_id, secret_access_key, region)):
            raise RuntimeError(
                "S3 asset storage requires S3_BUCKET, S3_ACCESS_KEY_ID, "
                "S3_SECRET_ACCESS_KEY, and S3_REGION."
            )
        self.bucket = bucket
        if client is None:
            try:
                import boto3
                from botocore.config import Config
            except ImportError as error:
                raise RuntimeError("Install boto3 to use S3 asset storage.") from error
            client = boto3.client(
                "s3",
                endpoint_url=endpoint_url or None,
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
                region_name=region,
                config=Config(s3={"addressing_style": "path"}),
            )
        self.client = client

    def save(self, key: str, content: bytes, content_type: str) -> None:
        _validate_key(key)
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
        )

    def open_stream(self, key: str) -> Iterator[bytes]:
        _validate_key(key)
        body = self.client.get_object(Bucket=self.bucket, Key=key)["Body"]
        try:
            for content in body.iter_chunks(chunk_size=CHUNK_SIZE):
                if content:
                    yield content
        finally:
            body.close()

    def read_bytes(self, key: str) -> bytes:
        return b"".join(self.open_stream(key))

    def exists(self, key: str) -> bool:
        _validate_key(key)
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except Exception as error:
            response = getattr(error, "response", {})
            code = str(response.get("Error", {}).get("Code", ""))
            status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
                return False
            raise
        return True

    def size(self, key: str) -> int:
        _validate_key(key)
        result = self.client.head_object(Bucket=self.bucket, Key=key)
        return int(result["ContentLength"])

    def delete(self, key: str) -> None:
        _validate_key(key)
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def signed_url(self, key: str, expires_seconds: int = 300) -> str:
        _validate_key(key)
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_seconds,
        )


def get_asset_storage(
    backend: str | None = None,
    *,
    settings: Settings | None = None,
) -> AssetStorage:
    configured = settings or get_settings()
    selected = backend or configured.asset_storage_backend
    if selected == "local":
        return LocalAssetStorage(
            configured.resume_storage_path,
            configured.company_document_storage_path,
            Path(configured.resume_storage_path).parent / "avatars",
        )
    if selected == "s3":
        return S3AssetStorage(
            endpoint_url=configured.s3_endpoint_url,
            bucket=configured.s3_bucket,
            access_key_id=configured.s3_access_key_id,
            secret_access_key=configured.s3_secret_access_key,
            region=configured.s3_region,
        )
    raise ValueError(f"Unsupported asset storage backend: {selected}")


def asset_key(namespace: str, filename: str) -> str:
    key = f"{namespace}/{filename}"
    _validate_key(key)
    return key


def legacy_avatar_key(avatar_url: str | None) -> str | None:
    if not avatar_url:
        return None
    path = unquote(urlparse(avatar_url).path)
    marker = "/api/v1/profiles/avatar/"
    if marker not in path:
        return None
    filename = path.rsplit(marker, 1)[-1]
    if not _LEGACY_AVATAR_NAME.fullmatch(filename):
        return None
    return asset_key("avatars", filename)


def sanitize_filename(filename: str | None, *, fallback: str) -> str:
    basename = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    sanitized = _SAFE_FILENAME_CHARS.sub("_", basename).strip(" .")
    return sanitized[:255] or fallback


def delete_asset_after_commit(storage: AssetStorage, key: str | None) -> None:
    if not key:
        return
    try:
        storage.delete(key)
    except Exception:
        logger.exception("Could not delete stored asset", extra={"storage_key": key})


@contextmanager
def materialize_asset(
    storage: AssetStorage, key: str, suffix: str
) -> Iterator[Path]:
    with tempfile.TemporaryDirectory(prefix="internsphere-asset-") as directory:
        path = Path(directory) / f"asset{suffix}"
        path.write_bytes(storage.read_bytes(key))
        yield path
