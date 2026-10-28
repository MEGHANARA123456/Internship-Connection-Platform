import os

import pytest


MINIMUM_TEST_COUNT = int(os.environ.get("MIN_TEST_COUNT", "100"))

os.environ.setdefault("RATE_LIMIT_REQUESTS", "100000")
os.environ.setdefault("AUTH_RATE_LIMIT_REQUESTS", "100000")


def pytest_collection_finish(session: pytest.Session) -> None:
    collected_count = len(session.items)
    if collected_count < MINIMUM_TEST_COUNT:
        pytest.exit(
            f"Expected at least {MINIMUM_TEST_COUNT} tests to be collected, "
            f"but collected {collected_count}.",
            returncode=1,
        )


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
