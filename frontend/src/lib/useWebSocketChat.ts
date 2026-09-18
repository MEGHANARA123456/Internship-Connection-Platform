import { useEffect, useRef, useState, useCallback } from 'react'
import { sendSystemNotification } from './notifications'

interface WebSocketMessage {
  type: string
  [key: string]: any
}

export function useWebSocketChat(userId?: number) {
  const [isConnected, setIsConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<number[]>([])
  const [typingMap, setTypingMap] = useState<Record<number, boolean>>({})
  const socketRef = useRef<WebSocket | null>(null)
  const onNewMessageRef = useRef<((convId: number, msg: any) => void) | null>(null)

  useEffect(() => {
    if (!userId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname || 'localhost'
    const wsUrl = `${protocol}//${host}:8010/api/v1/ws/chat/${userId}`

    let socket: WebSocket | null = null
    let reconnectTimeout: any = null

    const connect = () => {
      try {
        socket = new WebSocket(wsUrl)
        socketRef.current = socket

        socket.onopen = () => {
          setIsConnected(true)
        }

        socket.onmessage = (event) => {
          try {
            const data: WebSocketMessage = JSON.parse(event.data)

            if (data.type === 'presence_update' && Array.isArray(data.online_users)) {
              setOnlineUsers(data.online_users)
            } else if (data.type === 'typing') {
              const convId = data.conversation_id
              if (convId) {
                setTypingMap((prev) => ({ ...prev, [convId]: Boolean(data.is_typing) }))
              }
            } else if (data.type === 'new_message') {
              const convId = data.conversation_id
              if (convId && onNewMessageRef.current) {
                onNewMessageRef.current(convId, data.message)
              }
              sendSystemNotification('New Message received', {
                body: data.message?.body || 'You have received a new message.',
              })
            } else if (data.type === 'notification_created') {
              window.dispatchEvent(new CustomEvent('app:notification', { detail: data.notification }))
              sendSystemNotification(data.notification?.title || 'New Notification', {
                body: data.notification?.body || '',
              })
            }
          } catch {
            // Ignored
          }
        }

        socket.onclose = () => {
          setIsConnected(false)
          reconnectTimeout = setTimeout(connect, 3000)
        }

        socket.onerror = () => {
          socket?.close()
        }
      } catch {
        // Ignored
      }
    }

    connect()

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (socket) socket.close()
    }
  }, [userId])

  const sendTyping = useCallback(
    (conversationId: number, recipientId: number, isTyping: boolean) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'typing',
            conversation_id: conversationId,
            recipient_id: recipientId,
            is_typing: isTyping,
          })
        )
      }
    },
    []
  )

  const isUserOnline = useCallback(
    (partnerId: number) => {
      return onlineUsers.includes(partnerId)
    },
    [onlineUsers]
  )

  const setOnNewMessageCallback = useCallback((cb: (convId: number, msg: any) => void) => {
    onNewMessageRef.current = cb
  }, [])

  return {
    isConnected,
    onlineUsers,
    typingMap,
    sendTyping,
    isUserOnline,
    setOnNewMessageCallback,
  }
}
