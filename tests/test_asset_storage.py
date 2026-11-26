from __future__ import annotations

from io import BytesIO

import pytest

from app.services.asset_storage import (
    LocalAssetStorage,
    S3AssetStorage,
    asset_key,
    legacy_avatar_key,
)


class FakeBody:
    def __init__(self, content: bytes):
        self.content = BytesIO(content)
        self.closed = False

    def iter_chunks(self, chunk_size: int):
        while chunk := self.content.read(min(chunk_size, 3)):
            yield chunk

    def close(self):
        self.closed = True


class FakeS3Client:
    def __init__(self):
        self.objects: dict[tuple[str, str], tuple[bytes, str]] = {}
        self.put_calls = []

    def put_object(self, **kwargs):
        self.put_calls.append(kwargs)
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = (
            kwargs["Body"],
            kwargs["ContentType"],
        )

    def get_object(self, *, Bucket, Key):
        return {"Body": FakeBody(self.objects[(Bucket, Key)][0])}

    def head_object(self, *, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            error = RuntimeError("not found")
            error.response = {
                "Error": {"Code": "404"},
                "ResponseMetadata": {"HTTPStatusCode": 404},
            }
            raise error
        content, _ = self.objects[(Bucket, Key)]
        return {"ContentLength": len(content)}

    def delete_object(self, *, Bucket, Key):
        self.objects.pop((Bucket, Key), None)

    def generate_presigned_url(self, operation, *, Params, ExpiresIn):
        return f"https://private.example/{Params['Key']}?expires={ExpiresIn}"


def test_s3_storage_keeps_objects_private_and_streams_them():
    client = FakeS3Client()
    storage = S3AssetStorage(
        endpoint_url="https://objects.example",
        bucket="internsphere-private",
        access_key_id="access",
        secret_access_key="secret",
        region="auto",
        client=client,
    )
    key = asset_key("resumes", "a1.pdf")

    storage.save(key, b"private resume content", "application/pdf")

    assert storage.exists(key)
    assert storage.size(key) == len(b"private resume content")
    assert b"".join(storage.open_stream(key)) == b"private resume content"
    assert client.put_calls[0]["ContentType"] == "application/pdf"
    assert "ACL" not in client.put_calls[0]
    assert storage.signed_url(key).endswith("expires=300")

    storage.delete(key)
    assert not storage.exists(key)


def test_local_asset_storage_uses_existing_category_folders_and_rejects_traversal(
    tmp_path,
):
    storage = LocalAssetStorage(
        tmp_path / "resumes",
        tmp_path / "company-documents",
        tmp_path / "avatars",
    )
    key = asset_key("company_documents", "b2.pdf")

    storage.save(key, b"%PDF-1.7", "application/pdf")

    assert storage.read_bytes(key) == b"%PDF-1.7"
    assert (tmp_path / "company-documents" / "b2.pdf").is_file()
    with pytest.raises(ValueError):
        storage.save("resumes/../private.pdf", b"no", "application/pdf")


def test_legacy_avatar_migration_only_recognizes_internal_avatar_routes():
    assert legacy_avatar_key(
        "/api/v1/profiles/avatar/avatar_42_12345678.png"
    ) == "avatars/avatar_42_12345678.png"
    assert legacy_avatar_key("https://cdn.example/avatar.png") is None

