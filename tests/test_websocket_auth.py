from datetime import timedelta

import pytest
from starlette.datastructures import QueryParams
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import ws
from app.core.security import create_token
from app.models import User, UserRole
from app.models.base import Base


class FakeWebSocket:
    def __init__(self, token: str | None = None):
        self.query_params = QueryParams({"token": token} if token else {})
        self.accepted = False
        self.close_code: int | None = None
        self.sent: list[dict] = []

    async def accept(self):
        self.accepted = True

    async def close(self, code: int):
        self.close_code = code

    async def send_json(self, data: dict):
        self.sent.append(data)

    async def receive_text(self):
        raise WebSocketDisconnect(code=1000)


@pytest.mark.anyio
async def async_user_sessions(monkeypatch: pytest.MonkeyPatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    monkeypatch.setattr(ws, "async_session_factory", sessions)
    async with sessions() as db:
        user_a = User(email="socket-a@example.com", password_hash="fake", role=UserRole.STUDENT, is_active=True)
        user_b = User(email="socket-b@example.com", password_hash="fake", role=UserRole.STUDENT, is_active=True)
        db.add_all([user_a, user_b])
        await db.commit()
        await db.refresh(user_a)
        await db.refresh(user_b)
    return engine, user_a, user_b


@pytest.mark.anyio
async def test_chat_websocket_without_token_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, user_a, _ = await async_user_sessions(monkeypatch)
    socket = FakeWebSocket()
    try:
        await ws.websocket_chat_endpoint(socket, user_a.id)
        assert socket.close_code == 4401
        assert not socket.accepted
    finally:
        await engine.dispose()


@pytest.mark.anyio
async def test_chat_websocket_rejects_token_for_different_user(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, user_a, user_b = await async_user_sessions(monkeypatch)
    token = create_token(str(user_a.id), user_a.role.value, "access", timedelta(minutes=30))
    socket = FakeWebSocket(token)
    try:
        await ws.websocket_chat_endpoint(socket, user_b.id)
        assert socket.close_code == 4403
        assert not socket.accepted
    finally:
        await engine.dispose()


@pytest.mark.anyio
async def test_chat_websocket_accepts_valid_user_token(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, user_a, _ = await async_user_sessions(monkeypatch)
    token = create_token(str(user_a.id), user_a.role.value, "access", timedelta(minutes=30))
    socket = FakeWebSocket(token)
    try:
        await ws.websocket_chat_endpoint(socket, user_a.id)
        assert socket.accepted
        assert socket.close_code is None
    finally:
        if socket in ws.manager.active_user_connections.get(user_a.id, set()):
            ws.manager.disconnect_user(user_a.id, socket)
        await engine.dispose()
