"""Private Google Drive storage for completed interview recordings."""

import base64
import io
import json
import logging
import random
import time
from pathlib import Path
from typing import Iterator
from urllib.parse import quote

from app.services.interview_video_storage import LocalPrivateInterviewVideoStorage

logger = logging.getLogger(__name__)

DRIVE_API = "https://www.googleapis.com/drive/v3"
DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
DRIVE_CHUNK_BYTES = 8 * 1024 * 1024
MAX_DRIVE_ATTEMPTS = 5


class InterviewStorageError(RuntimeError):
    def __init__(self, code: str, status_code: int | None = None):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def _status_code(error: Exception) -> int | None:
    response = getattr(error, "resp", None)
    if response is not None:
        return getattr(response, "status", None)
    response = getattr(error, "response", None)
    return getattr(response, "status_code", None)


def _retry_delay(error: Exception, attempt: int) -> float:
    response = getattr(error, "resp", None) or getattr(error, "response", None)
    headers = getattr(response, "headers", {}) or {}
    retry_after = headers.get("Retry-After")
    try:
        hinted = float(retry_after)
    except (TypeError, ValueError):
        hinted = 0.0
    return min(20.0, max(hinted, 2**attempt) + random.uniform(0.1, 0.8))


def _is_retryable(error: Exception) -> bool:
    status = _status_code(error)
    return status == 429 or (status is not None and 500 <= status <= 599)


class GoogleDriveInterviewStorage(LocalPrivateInterviewVideoStorage):
    """Uses local staging for chunks and streams completed files privately from Drive."""

    def __init__(
        self,
        root: str | Path,
        credentials_spec: str,
        root_folder_id: str,
        *,
        service=None,
        authorized_session=None,
    ):
        super().__init__(root)
        self._credentials_spec = credentials_spec.strip()
        self._root_folder_id = root_folder_id.strip()
        self._service = service
        self._authorized_session = authorized_session
        self._folder_cache: dict[tuple[str, ...], str] = {}

    def _credentials(self):
        if not self._credentials_spec:
            raise InterviewStorageError("storage_not_configured")
        try:
            credential_path = Path(self._credentials_spec)
            if credential_path.is_file():
                info = json.loads(credential_path.read_text(encoding="utf-8"))
            else:
                decoded = base64.b64decode(self._credentials_spec, validate=True)
                info = json.loads(decoded.decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
            raise InterviewStorageError("storage_not_configured") from None
        if not isinstance(info, dict):
            raise InterviewStorageError("storage_not_configured")
        try:
            from google.oauth2.service_account import Credentials

            return Credentials.from_service_account_info(
                info,
                scopes=["https://www.googleapis.com/auth/drive"],
            )
        except (ImportError, ValueError, KeyError, TypeError):
            raise InterviewStorageError("storage_not_configured") from None

    def _drive_service(self):
        if self._service is None:
            try:
                from googleapiclient.discovery import build

                self._service = build(
                    "drive",
                    "v3",
                    credentials=self._credentials(),
                    cache_discovery=False,
                )
            except ImportError:
                raise InterviewStorageError("storage_not_configured") from None
        return self._service

    def _session(self):
        if self._authorized_session is None:
            try:
                from google.auth.transport.requests import AuthorizedSession
            except ImportError:
                raise InterviewStorageError("storage_not_configured") from None
            self._authorized_session = AuthorizedSession(self._credentials())
        return self._authorized_session

    def _execute(self, request):
        for attempt in range(MAX_DRIVE_ATTEMPTS):
            try:
                return request.execute(num_retries=0)
            except Exception as error:
                status = _status_code(error)
                if status in {401, 403}:
                    raise InterviewStorageError("storage_not_configured", status) from None
                if not _is_retryable(error) or attempt == MAX_DRIVE_ATTEMPTS - 1:
                    raise InterviewStorageError(
                        "storage_provider_error",
                        status,
                    ) from None
                time.sleep(_retry_delay(error, attempt))
        raise InterviewStorageError("storage_provider_error")

    def _folder(self, name: str, parent_id: str, cache_key: tuple[str, ...]) -> str:
        cached = self._folder_cache.get(cache_key)
        if cached:
            return cached
        service = self._drive_service()
        escaped_name = name.replace("\\", "\\\\").replace("'", "\\'")
        query = (
            f"name = '{escaped_name}' and mimeType = '{FOLDER_MIME_TYPE}' "
            f"and '{parent_id}' in parents and trashed = false"
        )
        response = self._execute(
            service.files().list(
                q=query,
                pageSize=2,
                fields="files(id,name)",
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
            )
        )
        folders = response.get("files", [])
        if folders:
            folder_id = folders[0]["id"]
        else:
            created = self._execute(
                service.files().create(
                    body={
                        "name": name,
                        "mimeType": FOLDER_MIME_TYPE,
                        "parents": [parent_id],
                    },
                    fields="id",
                    supportsAllDrives=True,
                )
            )
            folder_id = created["id"]
        self._folder_cache[cache_key] = folder_id
        return folder_id

    def _recording_folder(
        self,
        source_type: str,
        user_id: int,
        session_id: int,
    ) -> str:
        if not self._root_folder_id or source_type not in {"mock", "real"}:
            raise InterviewStorageError("storage_not_configured")
        user_key = (source_type, str(user_id))
        session_key = (*user_key, str(session_id))
        source_folder = self._folder(
            source_type,
            self._root_folder_id,
            (source_type,),
        )
        user_folder = self._folder(
            str(user_id),
            source_folder,
            user_key,
        )
        return self._folder(
            str(session_id),
            user_folder,
            session_key,
        )

    def _find_recording(self, storage_key: str, folder_id: str) -> dict | None:
        escaped_key = storage_key.replace("\\", "\\\\").replace("'", "\\'")
        query = (
            f"appProperties has {{ key='internsphere_recording_key' "
            f"and value='{escaped_key}' }} and '{folder_id}' in parents "
            "and trashed = false"
        )
        response = self._execute(
            self._drive_service().files().list(
                q=query,
                pageSize=2,
                fields="files(id,size)",
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
            )
        )
        files = response.get("files", [])
        return files[0] if files else None

    def save_from_path(
        self,
        path: Path,
        *,
        source_type: str,
        user_id: int,
        session_id: int,
        storage_key: str,
        mime_type: str,
    ) -> str:
        if not path.is_file():
            raise InterviewStorageError("recording_staging_file_missing")
        folder_id = self._recording_folder(source_type, user_id, session_id)
        existing = self._find_recording(storage_key, folder_id)
        if existing:
            return str(existing["id"])
        try:
            from googleapiclient.http import MediaFileUpload
        except ImportError:
            raise InterviewStorageError("storage_not_configured") from None

        media = MediaFileUpload(
            str(path),
            mimetype=mime_type,
            chunksize=DRIVE_CHUNK_BYTES,
            resumable=True,
        )
        request = self._drive_service().files().create(
            body={
                "name": f"recording-{storage_key}",
                "mimeType": mime_type,
                "parents": [folder_id],
                "appProperties": {"internsphere_recording_key": storage_key},
            },
            media_body=media,
            fields="id,size",
            supportsAllDrives=True,
        )
        for attempt in range(MAX_DRIVE_ATTEMPTS):
            try:
                while True:
                    _progress, response = request.next_chunk(num_retries=0)
                    if response is not None:
                        return str(response["id"])
            except Exception as error:
                status = _status_code(error)
                if status in {401, 403}:
                    raise InterviewStorageError("storage_not_configured", status) from None
                if not _is_retryable(error) or attempt == MAX_DRIVE_ATTEMPTS - 1:
                    raise InterviewStorageError(
                        "storage_provider_error",
                        status,
                    ) from None
                time.sleep(_retry_delay(error, attempt))
        raise InterviewStorageError("storage_provider_error")

    def size(self, storage_key: str, *, file_id: str | None = None) -> int:
        if not file_id:
            return super().size(storage_key)
        response = self._execute(
            self._drive_service().files().get(
                fileId=file_id,
                fields="id,size",
                supportsAllDrives=True,
            )
        )
        return int(response["size"])

    def find_file_id(
        self,
        *,
        source_type: str,
        user_id: int,
        session_id: int,
        storage_key: str,
    ) -> str | None:
        folder_id = self._recording_folder(source_type, user_id, session_id)
        recording = self._find_recording(storage_key, folder_id)
        return str(recording["id"]) if recording else None

    def exists(self, storage_key: str, *, file_id: str | None = None) -> bool:
        if not file_id:
            return super().exists(storage_key)
        try:
            self.size(storage_key, file_id=file_id)
        except InterviewStorageError as error:
            if error.status_code == 404:
                return False
            raise
        return True

    def open_stream(
        self,
        storage_key: str,
        *,
        file_id: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]:
        if not file_id:
            yield from super().open_stream(
                storage_key,
                start=start,
                end=end,
            )
            return
        headers = {}
        if start is not None or end is not None:
            headers["Range"] = f"bytes={start or 0}-{'' if end is None else end}"
        url = f"{DRIVE_API}/files/{quote(file_id, safe='')}"
        for attempt in range(MAX_DRIVE_ATTEMPTS):
            response = self._session().get(
                url,
                params={"alt": "media", "supportsAllDrives": "true"},
                headers=headers,
                stream=True,
                timeout=(10, 60),
            )
            status = response.status_code
            if status in {401, 403}:
                response.close()
                raise InterviewStorageError("storage_not_configured", status)
            if status == 429 or 500 <= status <= 599:
                response.close()
                if attempt == MAX_DRIVE_ATTEMPTS - 1:
                    raise InterviewStorageError("storage_provider_error", status)
                time.sleep(_retry_delay(response, attempt))
                continue
            if status not in {200, 206}:
                response.close()
                raise InterviewStorageError("storage_provider_error", status)
            if headers and status != 206:
                response.close()
                raise InterviewStorageError("range_not_supported", status)
            try:
                for content in response.iter_content(chunk_size=64 * 1024):
                    if content:
                        yield content
            finally:
                response.close()
            return

    def delete(self, storage_key: str, *, file_id: str | None = None) -> None:
        if file_id:
            try:
                self._execute(
                    self._drive_service().files().delete(
                        fileId=file_id,
                        supportsAllDrives=True,
                    )
                )
            except InterviewStorageError as error:
                if error.status_code != 404:
                    raise
        super().remove_staging(storage_key)

    def health_check(self) -> None:
        if not self._root_folder_id:
            raise InterviewStorageError("storage_not_configured")
        service = self._drive_service()
        root = self._execute(
            service.files().get(
                fileId=self._root_folder_id,
                fields="id,mimeType",
                supportsAllDrives=True,
            )
        )
        if root.get("mimeType") != FOLDER_MIME_TYPE:
            raise InterviewStorageError("gdrive_root_not_folder")
        payload = b"InternSphere Drive storage health check"
        try:
            from googleapiclient.http import MediaIoBaseUpload
        except ImportError:
            raise InterviewStorageError("storage_not_configured") from None
        created = self._execute(
            service.files().create(
                body={
                    "name": "internsphere-storage-health-check.txt",
                    "mimeType": "text/plain",
                    "parents": [self._root_folder_id],
                },
                media_body=MediaIoBaseUpload(
                    io.BytesIO(payload),
                    mimetype="text/plain",
                    resumable=True,
                    chunksize=256 * 1024,
                ),
                fields="id",
                supportsAllDrives=True,
            )
        )
        self._execute(
            service.files().delete(
                fileId=created["id"],
                supportsAllDrives=True,
            )
        )
