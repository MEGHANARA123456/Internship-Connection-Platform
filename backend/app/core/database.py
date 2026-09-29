# This file creates and manages the database connection used by FastAPI endpoints.
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

# Create an async PostgreSQL engine using the app database URL.
engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)

# Session factory used by API routes to open database transactions.
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


# Dependency for FastAPI: yields a database session for each request.
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session