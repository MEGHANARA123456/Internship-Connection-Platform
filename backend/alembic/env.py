# This file is the Alembic migration entry point.
# It tells Alembic how to connect to the database and which SQLAlchemy models to use.
from logging.config import fileConfig
import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.models.base import Base
import app.models.user
from app.core.config import get_settings

# Read the database URL from the app settings and set it for Alembic.
config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))

# Load the Alembic logging configuration if it exists.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# This is the metadata object used to compare database tables with the ORM models.
target_metadata = Base.metadata


# Offline migration mode: generate SQL without connecting to the live database.
def run_migrations_offline() -> None:
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


# Online migration mode: connect to the database and run migrations.
def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


# Create the async SQLAlchemy engine and run migrations through it.
async def run_async_migrations() -> None:
    connectable = async_engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


# Alembic executes this file when the app starts through the Docker command.
if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())