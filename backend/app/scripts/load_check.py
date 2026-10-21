"""Run a local 25-user login/browse/apply/notification load check."""

import asyncio
import argparse
import math
import os
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

from httpx import ASGITransport, AsyncClient, HTTPError, Response
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.dependencies import get_db
from app.core.security import hash_password
from app.main import app
from app.models import CompanyProfile, Internship, StudentProfile, User, UserRole
from app.models.base import Base

USER_COUNT = 25
PASSWORD = "Load-check-Password-1!"


async def run_load_check(*, baseline_sync_hash: bool = False) -> tuple[int, int, float, float]:
    with tempfile.TemporaryDirectory(prefix="internship-load-check-") as temporary_directory:
        database_url = os.getenv("LOAD_CHECK_DATABASE_URL")
        schema_name = f"load_check_{uuid4().hex}"
        admin_engine = None
        if database_url:
            parsed_url = make_url(database_url)
            if parsed_url.drivername != "postgresql+asyncpg":
                raise ValueError("LOAD_CHECK_DATABASE_URL must use postgresql+asyncpg.")
            admin_engine = create_async_engine(database_url)
            async with admin_engine.begin() as connection:
                await connection.exec_driver_sql(f'CREATE SCHEMA "{schema_name}"')
            engine = create_async_engine(
                database_url,
                connect_args={"server_settings": {"search_path": schema_name}},
            )
        else:
            database_path = Path(temporary_directory) / "load-check.sqlite"
            engine = create_async_engine(
                URL.create("sqlite+aiosqlite", database=str(database_path)),
                connect_args={"timeout": 30},
            )
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as connection:
                if engine.dialect.name == "sqlite":
                    await connection.exec_driver_sql("PRAGMA journal_mode=WAL")
                await connection.run_sync(Base.metadata.create_all)

        async def override_db():
            async with sessions() as session:
                yield session

        original_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[get_db] = override_db
        original_verify = None
        if baseline_sync_hash:
            import app.api.v1.auth as auth_api
            from app.core.security import verify_password

            original_verify = auth_api.verify_password_async

            async def verify_password_on_event_loop(password: str, password_hash: str) -> bool:
                return verify_password(password, password_hash)

            auth_api.verify_password_async = verify_password_on_event_loop
        password_hash = hash_password(PASSWORD)
        async with sessions() as session:
            company = User(
                email="load-check-company@example.com",
                password_hash=password_hash,
                role=UserRole.COMPANY,
                is_verified=True,
            )
            session.add(company)
            await session.flush()
            session.add(
                CompanyProfile(
                    user_id=company.id,
                    company_name="Load Check Company",
                    industry="Technology",
                    verification_status="VERIFIED",
                )
            )

            users: list[tuple[str, int]] = []
            internships: list[int] = []
            for index in range(USER_COUNT):
                email = f"load-check-student-{index}@example.com"
                student = User(
                    email=email,
                    password_hash=password_hash,
                    role=UserRole.STUDENT,
                    is_verified=True,
                )
                session.add(student)
                await session.flush()
                session.add(
                    StudentProfile(
                        user_id=student.id,
                        full_name=f"Load Check Student {index}",
                        university="Example University",
                        major="Computer Science",
                        graduation_year=2027,
                    )
                )
                internship = Internship(
                    company_id=company.id,
                    title=f"Load Check Internship {index}",
                    description="Internship for concurrency load validation.",
                    location="Remote",
                    industry="Technology",
                    duration_months=3,
                    stipend=1000,
                    work_mode="REMOTE",
                    skills="Python",
                    deadline=date.today() + timedelta(days=30),
                    status="PUBLISHED",
                )
                session.add(internship)
                await session.flush()
                users.append((email, student.id))
                internships.append(internship.id)
            await session.commit()

        latencies_ms: list[float] = []
        failures = 0
        request_count = 0

        async def measured_request(
            client: AsyncClient,
            method: str,
            path: str,
            expected_status: int,
            **kwargs,
        ) -> Response | None:
            nonlocal failures, request_count
            started_at = time.perf_counter()
            try:
                response = await client.request(method, path, **kwargs)
            except HTTPError:
                failures += 1
                request_count += 1
                latencies_ms.append((time.perf_counter() - started_at) * 1000)
                return None
            request_count += 1
            latencies_ms.append((time.perf_counter() - started_at) * 1000)
            if response.status_code != expected_status:
                failures += 1
            return response

        async def user_flow(index: int, email: str, internship_id: int) -> None:
            nonlocal failures
            async with AsyncClient(
                transport=ASGITransport(
                    app=app,
                    client=(f"198.51.100.{index + 1}", 5000 + index),
                ),
                base_url="http://load-check",
            ) as client:
                login = await measured_request(
                    client,
                    "POST",
                    "/api/v1/auth/login",
                    200,
                    json={"email": email, "password": PASSWORD},
                )
                if login is None or login.status_code != 200:
                    return

                headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
                browse = await measured_request(
                    client,
                    "GET",
                    "/api/v1/internships",
                    200,
                    headers=headers,
                )
                application = await measured_request(
                    client,
                    "POST",
                    f"/api/v1/applications/internships/{internship_id}",
                    201,
                    headers=headers,
                    json={"cover_note": "Submitting during the concurrent load check."},
                )
                await measured_request(
                    client,
                    "GET",
                    "/api/v1/notifications",
                    200,
                    headers=headers,
                )
                if browse is None or application is None:
                    return

        try:
            await asyncio.gather(*[
                user_flow(index, user[0], internships[index])
                for index, user in enumerate(users)
            ])
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)
            if original_verify is not None:
                import app.api.v1.auth as auth_api

                auth_api.verify_password_async = original_verify
            await engine.dispose()
            if admin_engine is not None:
                async with admin_engine.begin() as connection:
                    await connection.exec_driver_sql(f'DROP SCHEMA "{schema_name}" CASCADE')
                await admin_engine.dispose()

        if latencies_ms:
            ordered_latencies = sorted(latencies_ms)
            p50_index = max(0, math.ceil(0.50 * len(ordered_latencies)) - 1)
            p95_index = max(0, math.ceil(0.95 * len(ordered_latencies)) - 1)
            p50_latency_ms = ordered_latencies[p50_index]
            p95_latency_ms = ordered_latencies[p95_index]
        else:
            p50_latency_ms = 0.0
            p95_latency_ms = 0.0
        return request_count, failures, p50_latency_ms, p95_latency_ms


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-sync-hash", action="store_true")
    args = parser.parse_args()
    total, errors, p50_ms, p95_ms = asyncio.run(
        run_load_check(baseline_sync_hash=args.baseline_sync_hash)
    )
    error_rate = errors / total if total else 0.0
    print(
        f"users={USER_COUNT} requests={total} errors={errors} "
        f"error_rate={error_rate:.2%} p50_latency_ms={p50_ms:.2f} "
        f"p95_latency_ms={p95_ms:.2f}"
    )
