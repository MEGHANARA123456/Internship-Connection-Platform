"""Chunk Markdown knowledge and idempotently index it in PostgreSQL."""

import asyncio
from hashlib import sha256
import json
import logging
from pathlib import Path
import re
import time

from sqlalchemy import text

from app.chatbot.chatbot_config import ChatbotConfig, load_config
from app.chatbot.retriever import _front_matter_values, _metadata_list
from app.chatbot.rag.embeddings import embed_texts
from app.core.database import async_session_factory

logger = logging.getLogger("internsphere.chatbot.rag")
WORD_PATTERN = re.compile(r"\S+")
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)
BATCH_SIZE = 32
CHUNK_WORDS = 400
CHUNK_OVERLAP = 50


def _front_matter(raw: str) -> tuple[dict[str, str], tuple[str, ...], tuple[tuple[str, str], ...], str]:
    """Parse required role audiences and labeled routes from Markdown front matter."""
    if not raw.startswith("---\n"):
        raise ValueError("Knowledge file must start with YAML front matter.")
    _, header, body = raw.split("---", 2)
    values, links = _front_matter_values(header)
    audiences = _metadata_list(values.get("audience"))
    allowed_audiences = {"guest", "student", "company", "admin"}
    if not values.get("title") or not links or not audiences:
        raise ValueError("Knowledge front matter requires title, audience, and labeled links.")
    if set(audiences) - allowed_audiences:
        raise ValueError("Knowledge front matter contains an unsupported audience.")
    return values, audiences, links, body.strip()


def _route_is_allowed(route: str, audience: str) -> bool:
    """Keep vector-indexed links within the same role boundaries as BM25 results."""
    common = {
        "/", "/opportunities", "/login", "/register-student", "/register-company",
        "/forgot-password", "/reset-password", "/verify", "/privacy", "/privacy-center",
        "/privacy-security",
    }
    role_routes = {
        "guest": common,
        "student": common | {
            "/applications", "/profile/student", "/interviews", "/messages",
            "/notifications", "/saved", "/student/analytics", "/skills/history",
        },
        "company": common | {
            "/company", "/company/jobs", "/company/interviews", "/company/internships/new", "/company/applicants",
            "/company/pipeline", "/company/shortlisted", "/company/analytics",
            "/company/settings", "/profile/company", "/interviews", "/messages", "/notifications",
        },
        "admin": common | {
            "/admin", "/admin/moderation", "/admin/companies", "/admin/users",
            "/admin/verifications", "/admin/reports", "/admin/audit-logs",
            "/admin/skill-assessments", "/admin/students", "/notifications",
        },
    }
    if audience != "guest" and route in {
        "/login", "/register-student", "/register-company",
        "/forgot-password", "/reset-password", "/verify",
    }:
        return False
    if route in role_routes[audience]:
        return True
    if audience == "student":
        return bool(re.fullmatch(r"/(?:opportunities|applications)/[1-9]\d*", route))
    if audience == "company":
        return bool(re.fullmatch(
            r"/company/(?:jobs|companies)/[1-9]\d+(?:/applicants)?|/company/internships/[1-9]\d+/(?:edit|applicants)",
            route,
        ))
    if audience == "admin":
        return bool(re.fullmatch(r"/admin/(?:companies|students)/[1-9]\d+(?:/postings)?", route))
    return False


def _heading_sections(body: str) -> list[tuple[str, str]]:
    """Split Markdown into non-empty heading sections, using Overview when no heading exists."""
    matches = list(HEADING_PATTERN.finditer(body))
    if not matches:
        return [("Overview", body)]
    sections: list[tuple[str, str]] = []
    if body[:matches[0].start()].strip():
        sections.append(("Overview", body[:matches[0].start()].strip()))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        section_text = body[match.end():end].strip()
        if section_text:
            sections.append((match.group(2).strip(), section_text))
    return sections


def _chunks_for_file(path: Path, root: Path) -> list[dict[str, str | int]]:
    """Create overlapping word-bounded chunks with source metadata, hashes, and token counts."""
    values, audiences, links, body = _front_matter(path.read_text(encoding="utf-8"))
    chunks: list[dict[str, str | int]] = []
    source_path = path.relative_to(root).as_posix()
    for section, section_text in _heading_sections(body):
        words = WORD_PATTERN.findall(section_text)
        start = 0
        while start < len(words):
            end = min(start + CHUNK_WORDS, len(words))
            content = f"## {section}\n" + " ".join(words[start:end])
            for audience in audiences:
                audience_links = tuple(
                    (label, route)
                    for label, route in links
                    if _route_is_allowed(route, audience)
                )
                if not audience_links:
                    raise ValueError(f"No role-authorized links for {path.name} ({audience}).")
                route_metadata = json.dumps(audience_links, ensure_ascii=False, separators=(",", ":"))
                normalized = "\n".join((
                    values["title"],
                    section,
                    audience,
                    route_metadata,
                    content,
                ))
                chunks.append({
                    "doc_id": path.stem,
                    "source_path": source_path,
                    "title": values["title"],
                    "section": section,
                    "content": content,
                    "audience": audience,
                    "route_hint": route_metadata,
                    "content_hash": sha256(normalized.encode("utf-8")).hexdigest(),
                    "token_count": len(WORD_PATTERN.findall(content)),
                })
            if end == len(words):
                break
            start = end - CHUNK_OVERLAP
    return chunks


def _embed_with_retries(texts: list[str], model_name: str) -> list[list[float]]:
    """Embed a batch with up to three attempts, logging failures and increasing sleep delays."""
    for attempt in range(1, 4):
        try:
            return embed_texts(texts, model_name)
        except Exception:
            logger.exception("Knowledge embedding batch failed (attempt %s/3)", attempt)
            if attempt == 3:
                raise
            time.sleep(attempt)
    raise RuntimeError("Embedding retry loop exited unexpectedly.")


async def ingest_knowledge(config: ChatbotConfig | None = None) -> dict[str, int]:
    """Index changed knowledge chunks, delete stale rows, and commit all corpus updates atomically."""
    settings = config or load_config()
    root = settings.kb_path.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Knowledge directory does not exist: {root}")
    files = sorted(root.glob("*.md"))
    file_chunks = [(path, _chunks_for_file(path, root)) for path in files]
    all_paths = {path.relative_to(root).as_posix() for path in files}
    inserted_or_updated = 0
    unchanged = 0

    async with async_session_factory() as db:
        known_paths = set((await db.execute(
            text("SELECT DISTINCT source_path FROM kb_chunks")
        )).scalars())
        for path, chunks in file_chunks:
            source_path = path.relative_to(root).as_posix()
            existing_hashes = set((await db.execute(
                text("SELECT content_hash FROM kb_chunks WHERE source_path = :path"),
                {"path": source_path},
            )).scalars())
            changed_chunks = [
                chunk for chunk in chunks
                if str(chunk["content_hash"]) not in existing_hashes
            ]
            unchanged += len(chunks) - len(changed_chunks)
            for offset in range(0, len(changed_chunks), BATCH_SIZE):
                batch = changed_chunks[offset:offset + BATCH_SIZE]
                embeddings = await asyncio.to_thread(
                    _embed_with_retries,
                    [str(chunk["content"]) for chunk in batch],
                    settings.embedding_model,
                )
                if any(len(vector) != settings.embedding_dim for vector in embeddings):
                    raise ValueError(
                        f"Embedding model returned a vector with a dimension other than {settings.embedding_dim}."
                    )
                for chunk, vector in zip(batch, embeddings, strict=True):
                    await db.execute(
                        text(
                            """
                            INSERT INTO kb_chunks (
                                doc_id, source_path, title, section, content, audience,
                                route_hint, content_hash, embedding, token_count
                            ) VALUES (
                                :doc_id, :source_path, :title, :section, :content, :audience,
                                :route_hint, :content_hash, CAST(:embedding AS vector), :token_count
                            )
                            ON CONFLICT (source_path, content_hash) DO UPDATE SET
                                doc_id = EXCLUDED.doc_id,
                                title = EXCLUDED.title,
                                section = EXCLUDED.section,
                                content = EXCLUDED.content,
                                audience = EXCLUDED.audience,
                                route_hint = EXCLUDED.route_hint,
                                embedding = EXCLUDED.embedding,
                                token_count = EXCLUDED.token_count,
                                updated_at = now()
                            """
                        ),
                        {**chunk, "embedding": "[" + ",".join(map(str, vector)) + "]"},
                    )
                    inserted_or_updated += 1
            desired_hashes = [str(chunk["content_hash"]) for chunk in chunks]
            if desired_hashes:
                await db.execute(
                    text(
                        "DELETE FROM kb_chunks WHERE source_path = :path "
                        "AND content_hash != ALL(:hashes)"
                    ),
                    {"path": source_path, "hashes": desired_hashes},
                )
            else:
                await db.execute(
                    text("DELETE FROM kb_chunks WHERE source_path = :path"),
                    {"path": source_path},
                )

        for removed_path in known_paths - all_paths:
            await db.execute(
                text("DELETE FROM kb_chunks WHERE source_path = :path"),
                {"path": removed_path},
            )
        await db.commit()
    return {"indexed": inserted_or_updated, "unchanged": unchanged, "files": len(files)}


async def _main() -> None:
    """Skip ingestion when RAG is disabled; otherwise index configured knowledge and print counts."""
    config = load_config()
    if not config.rag_enabled:
        logger.info("RAG is disabled; knowledge ingestion skipped.")
        return
    result = await ingest_knowledge(config)
    print(
        "Indexed {indexed} changed chunks; {unchanged} unchanged chunks; "
        "{files} knowledge files.".format(**result)
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_main())
