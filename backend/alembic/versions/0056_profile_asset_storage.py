"""Add object-storage keys for resumes, company documents, and avatars."""

from urllib.parse import unquote, urlparse
import re

from alembic import op
import sqlalchemy as sa


revision = "0056_profile_asset_storage"
down_revision = "0055_interview_recording_storage"
branch_labels = None
depends_on = None
_LEGACY_AVATAR_NAME = re.compile(
    r"avatar_\d+_[a-f0-9]{8}(?:[a-f0-9]{24})?\.(?:jpg|jpeg|png|webp|svg|gif)"
)


def _avatar_key(value: str | None) -> str | None:
    if not value:
        return None
    path = unquote(urlparse(value).path)
    marker = "/api/v1/profiles/avatar/"
    if marker not in path:
        return None
    filename = path.rsplit(marker, 1)[-1]
    return f"avatars/{filename}" if _LEGACY_AVATAR_NAME.fullmatch(filename) else None


def upgrade() -> None:
    for table in ("resumes", "company_documents"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("storage_key", sa.String(length=500)))
            batch.add_column(
                sa.Column(
                    "storage_backend",
                    sa.String(length=20),
                    nullable=False,
                    server_default="local",
                )
            )

    for table in ("student_profiles", "company_profiles"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("avatar_storage_key", sa.String(length=500)))
            batch.add_column(sa.Column("avatar_storage_backend", sa.String(length=20)))

    connection = op.get_bind()
    for table in ("resumes", "company_documents"):
        rows = connection.execute(
            sa.text(f"SELECT id, stored_filename FROM {table}")
        )
        namespace = "resumes" if table == "resumes" else "company_documents"
        for row in rows:
            connection.execute(
                sa.text(
                    f"UPDATE {table} SET storage_key = :storage_key "
                    "WHERE id = :id"
                ),
                {
                    "id": row.id,
                    "storage_key": f"{namespace}/{row.stored_filename}",
                },
            )

    for table in ("student_profiles", "company_profiles"):
        rows = connection.execute(
            sa.text(f"SELECT id, avatar_url FROM {table} WHERE avatar_url IS NOT NULL")
        )
        for row in rows:
            key = _avatar_key(row.avatar_url)
            if key:
                connection.execute(
                    sa.text(
                        f"UPDATE {table} SET avatar_storage_key = :key, "
                        "avatar_storage_backend = 'local' WHERE id = :id"
                    ),
                    {"id": row.id, "key": key},
                )


def downgrade() -> None:
    for table in ("student_profiles", "company_profiles"):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("avatar_storage_backend")
            batch.drop_column("avatar_storage_key")

    for table in ("resumes", "company_documents"):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("storage_backend")
            batch.drop_column("storage_key")
