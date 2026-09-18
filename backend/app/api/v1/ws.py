import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websockets"])


class ConnectionManager:
    def __init__(self):
        # Map user_id -> set of active WebSockets
        self.active_user_connections: dict[int, set[WebSocket]] = defaultdict(set)
        # Map interview_id -> set of active WebSockets for WebRTC signaling
        self.video_rooms: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect_user(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active_user_connections[user_id].add(websocket)
        logger.info("User %s connected to chat WebSocket. Total connections: %s", user_id, len(self.active_user_connections[user_id]))
        # Broadcast presence
        await self.broadcast_presence()

    def disconnect_user(self, user_id: int, websocket: WebSocket):
        if websocket in self.active_user_connections[user_id]:
            self.active_user_connections[user_id].remove(websocket)
            if not self.active_user_connections[user_id]:
                del self.active_user_connections[user_id]
        logger.info("User %s disconnected from chat WebSocket.", user_id)

    def is_online(self, user_id: int) -> bool:
        return user_id in self.active_user_connections and len(self.active_user_connections[user_id]) > 0

    def get_online_user_ids(self) -> list[int]:
        return list(self.active_user_connections.keys())

    async def send_personal_message(self, user_id: int, data: dict[str, Any]):
        sockets = self.active_user_connections.get(user_id, set()).copy()
        for socket in sockets:
            try:
                await socket.send_json(data)
            except Exception as exc:
                logger.warning("Error sending message to user %s: %s", user_id, exc)
                self.disconnect_user(user_id, socket)

    async def broadcast_presence(self):
        online_users = self.get_online_user_ids()
        msg = {"type": "presence_update", "online_users": online_users}
        for uid in list(self.active_user_connections.keys()):
            await self.send_personal_message(uid, msg)

    async def connect_video(self, interview_id: int, websocket: WebSocket):
        await websocket.accept()
        self.video_rooms[interview_id].add(websocket)
        # Notify room peers
        for peer in self.video_rooms[interview_id]:
            if peer != websocket:
                await peer.send_json({"type": "peer_joined"})

    def disconnect_video(self, interview_id: int, websocket: WebSocket):
        if websocket in self.video_rooms[interview_id]:
            self.video_rooms[interview_id].remove(websocket)
            if not self.video_rooms[interview_id]:
                del self.video_rooms[interview_id]


manager = ConnectionManager()


async def notify_user(user_id: int, notification_data: dict[str, Any]) -> None:
    """Helper to dispatch real-time notifications to a connected user WebSocket."""
    try:
        await manager.send_personal_message(
            user_id,
            {
                "type": "notification_created",
                "notification": notification_data,
            },
        )
    except Exception as exc:
        logger.warning("Failed to broadcast real-time notification to user %s: %s", user_id, exc)



@router.websocket("/chat/{user_id}")
async def websocket_chat_endpoint(websocket: WebSocket, user_id: int):
    await manager.connect_user(user_id, websocket)
    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data = json.loads(raw_text)
                msg_type = data.get("type")

                # Handle typing indicator
                if msg_type == "typing":
                    recipient_id = data.get("recipient_id")
                    if recipient_id:
                        await manager.send_personal_message(
                            recipient_id,
                            {
                                "type": "typing",
                                "sender_id": user_id,
                                "conversation_id": data.get("conversation_id"),
                                "is_typing": data.get("is_typing", False),
                            },
                        )

                # Handle new message notification relay
                elif msg_type == "chat_message":
                    recipient_id = data.get("recipient_id")
                    if recipient_id:
                        await manager.send_personal_message(
                            recipient_id,
                            {
                                "type": "new_message",
                                "conversation_id": data.get("conversation_id"),
                                "message": data.get("message"),
                            },
                        )

                # Echo back status or ping/pong
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})

            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect_user(user_id, websocket)
        await manager.broadcast_presence()
    except Exception as exc:
        logger.warning("WebSocket error for user %s: %s", user_id, exc)
        manager.disconnect_user(user_id, websocket)


@router.websocket("/video-signal/{interview_id}")
async def websocket_video_signal_endpoint(websocket: WebSocket, interview_id: int):
    await manager.connect_video(interview_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            # Broadcast signaling messages (offer, answer, candidate) to other peers in room
            for peer in manager.video_rooms.get(interview_id, set()).copy():
                if peer != websocket:
                    try:
                        await peer.send_json(data)
                    except Exception:
                        pass
    except WebSocketDisconnect:
        manager.disconnect_video(interview_id, websocket)
        for peer in manager.video_rooms.get(interview_id, set()).copy():
            try:
                await peer.send_json({"type": "peer_left"})
            except Exception:
                pass
