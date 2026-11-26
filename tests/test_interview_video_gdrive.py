from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.interview_video_gdrive import (
    GoogleDriveInterviewStorage,
    InterviewStorageError,
)

RECORDING_KEY = "550e8400-e29b-41d4-a716-446655440000"


class FakeRequest:
    def __init__(self, value=None, error=None):
        self.value = value or {}
        self.error = error

    def execute(self, num_retries=0):
        if self.error is not None:
            raise self.error
        return self.value


class FakeHttpError(Exception):
    def __init__(self, status):
        super().__init__(str(status))
        self.resp = SimpleNamespace(
            status=status,
            headers={"Retry-After": "0"},
        )


class FakeUploadRequest:
    def __init__(self, fail_once=None):
        self.fail_once = fail_once
        self.calls = 0

    def next_chunk(self, num_retries=0):
        self.calls += 1
        if self.fail_once is not None and self.calls == 1:
            raise self.fail_once
        return None, {"id": "drive-file", "size": "19"}


class FakeFiles:
    def __init__(self, upload=None):
        self.upload = upload or FakeUploadRequest()
        self.calls = []
        self.folder_count = 0

    def list(self, **kwargs):
        self.calls.append(("list", kwargs))
        return FakeRequest({"files": []})

    def create(self, **kwargs):
        self.calls.append(("create", kwargs))
        if kwargs.get("media_body") is not None:
            return self.upload
        self.folder_count += 1
        return FakeRequest({"id": f"folder-{self.folder_count}"})

    def get(self, **kwargs):
        self.calls.append(("get", kwargs))
        return FakeRequest({"id": kwargs["fileId"], "size": "19"})

    def delete(self, **kwargs):
        self.calls.append(("delete", kwargs))
        return FakeRequest({})


class FakeDriveService:
    def __init__(self, files):
        self._files = files

    def files(self):
        return self._files


class FakeResponse:
    status_code = 206

    def iter_content(self, chunk_size):
        yield b"va"
        yield b"te"

    def close(self):
        return None


class FakeAuthorizedSession:
    def __init__(self):
        self.request = None

    def get(self, url, **kwargs):
        self.request = (url, kwargs)
        return FakeResponse()


def _http_error(status: int):
    return FakeHttpError(status)


def _storage(tmp_path: Path, files: FakeFiles, authorized_session=None):
    return GoogleDriveInterviewStorage(
        tmp_path / "staging",
        "fake-service-account",
        "root-folder",
        service=FakeDriveService(files),
        authorized_session=authorized_session,
    )


def test_drive_upload_uses_private_resumable_file_and_shared_drive_flags(tmp_path):
    source = tmp_path / "recording.webm"
    source.write_bytes(b"private-video-bytes")
    files = FakeFiles()
    storage = _storage(tmp_path, files)

    file_id = storage.save_from_path(
        source,
        source_type="mock",
        user_id=12,
        session_id=34,
        storage_key=RECORDING_KEY,
        mime_type="video/webm",
    )

    assert file_id == "drive-file"
    upload_call = next(kwargs for operation, kwargs in files.calls if operation == "create" and kwargs.get("media_body"))
    assert upload_call["supportsAllDrives"] is True
    assert upload_call["media_body"].resumable() is True
    assert upload_call["body"]["parents"] == ["folder-3"]
    assert "permissions" not in upload_call["body"]


def test_drive_upload_retries_rate_limit(tmp_path, monkeypatch):
    source = tmp_path / "recording.webm"
    source.write_bytes(b"private-video-bytes")
    upload = FakeUploadRequest(fail_once=_http_error(429))
    storage = _storage(tmp_path, FakeFiles(upload))
    monkeypatch.setattr("app.services.interview_video_gdrive.time.sleep", lambda _delay: None)

    file_id = storage.save_from_path(
        source,
        source_type="real",
        user_id=12,
        session_id=34,
        storage_key=RECORDING_KEY,
        mime_type="video/webm",
    )

    assert file_id == "drive-file"
    assert upload.calls == 2


def test_drive_upload_does_not_retry_forbidden_response(tmp_path, monkeypatch):
    source = tmp_path / "recording.webm"
    source.write_bytes(b"private-video-bytes")
    upload = FakeUploadRequest(fail_once=_http_error(403))
    storage = _storage(tmp_path, FakeFiles(upload))
    monkeypatch.setattr("app.services.interview_video_gdrive.time.sleep", lambda _delay: None)

    with pytest.raises(InterviewStorageError) as error:
        storage.save_from_path(
            source,
            source_type="real",
            user_id=12,
            session_id=34,
            storage_key=RECORDING_KEY,
            mime_type="video/webm",
        )

    assert error.value.code == "storage_not_configured"
    assert error.value.status_code == 403
    assert upload.calls == 1


def test_drive_range_stream_and_delete_are_authenticated_and_drive_aware(tmp_path):
    files = FakeFiles()
    authorized_session = FakeAuthorizedSession()
    storage = _storage(tmp_path, files, authorized_session)

    assert b"".join(storage.open_stream(
        RECORDING_KEY,
        file_id="drive-file",
        start=3,
        end=6,
    )) == b"vate"
    storage.delete(RECORDING_KEY, file_id="drive-file")

    _url, request = authorized_session.request
    assert request["headers"]["Range"] == "bytes=3-6"
    assert request["params"]["supportsAllDrives"] == "true"
    assert any(
        operation == "delete" and kwargs["supportsAllDrives"] is True
        for operation, kwargs in files.calls
    )
