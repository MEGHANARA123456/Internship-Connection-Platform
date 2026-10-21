import threading

import pytest

from app.core import security


@pytest.mark.anyio
async def test_password_hashing_and_verification_run_in_worker_threads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_loop_thread = threading.get_ident()
    observed_threads: list[int] = []

    def hash_password(password: str) -> str:
        observed_threads.append(threading.get_ident())
        return f"hashed:{password}"

    def verify_password(password: str, password_hash: str) -> bool:
        observed_threads.append(threading.get_ident())
        return password_hash == f"hashed:{password}"

    monkeypatch.setattr(security, "hash_password", hash_password)
    monkeypatch.setattr(security, "verify_password", verify_password)

    password_hash = await security.hash_password_async("long password")
    is_valid = await security.verify_password_async("long password", password_hash)

    assert is_valid
    assert len(observed_threads) == 2
    assert all(thread_id != event_loop_thread for thread_id in observed_threads)
