import { useEffect, useRef, useState, useCallback } from 'react'
import { getAccessTokenExpirationMs, getWebSocketBaseUrl, refreshSession } from '../api/client'
import { useAuthStore } from '../store/auth'
import { isSensitiveNotification, maskCodes, sendSystemNotification } from './notifications'

interface WebSocketMessage {
  type: string
  [key: string]: any
}

export function useWebSocketChat(userId?: number) {
  const isAuthenticated = useAuthStore((state) => Boolean(state.session))
  const [isConnected, setIsConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<number[]>([])
  const [typingMap, setTypingMap] = useState<Record<number, boolean>>({})
  const socketRef = useRef<WebSocket | null>(null)
  const onNewMessageRef = useRef<((convId: number, msg: any) => void) | null>(null)

  useEffect(() => {
    if (!userId || !isAuthenticated) return
    const webSocketBaseUrl = getWebSocketBaseUrl()

    let socket: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0
    let isActive = true
    let reconnectNoticeShown = false
    const maxReconnectAttempts = 8

    const scheduleReconnect = (refreshFirst = false) => {
      if (!isActive) return
      if (!reconnectNoticeShown) {
        reconnectNoticeShown = true
        window.dispatchEvent(new CustomEvent('app:toast', {
          detail: { kind: 'warning', message: 'Chat connection problem, retrying...' },
        }))
      }
      if (reconnectAttempts >= maxReconnectAttempts) {
        window.dispatchEvent(new CustomEvent('app:toast', {
          detail: {
            kind: 'error',
            message: 'Chat is temporarily unavailable. Your session is still active.',
          },
        }))
        return
      }
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000)
      reconnectAttempts += 1
      reconnectTimeout = setTimeout(async () => {
        const currentSession = useAuthStore.getState().session
        if (!isActive || !currentSession) return
        const expiresAt = getAccessTokenExpirationMs(currentSession)
        if (refreshFirst || (expiresAt !== null && expiresAt <= Date.now() + 30_000)) {
          try {
            await refreshSession()
          } catch {
            if (isActive && useAuthStore.getState().session) scheduleReconnect(true)
            return
          }
        }
        if (isActive) connect()
      }, delay)
    }

    const connect = () => {
      try {
        const currentSession = useAuthStore.getState().session
        if (!currentSession) return
        const expiresAt = getAccessTokenExpirationMs(currentSession)
        if (expiresAt !== null && expiresAt <= Date.now() + 30_000) {
          void refreshSession().then(connect).catch(() => scheduleReconnect(true))
          return
        }
        const wsUrl = `${webSocketBaseUrl}/ws/chat/${userId}`
        socket = new WebSocket(wsUrl)
        socketRef.current = socket

        socket.onopen = () => {
          const accessToken = useAuthStore.getState().session?.accessToken
          if (!accessToken) {
            socket?.close()
            return
          }
          socket?.send(JSON.stringify({ type: 'authenticate', token: accessToken }))
        }

        socket.onmessage = (event) => {
          try {
            const data: WebSocketMessage = JSON.parse(event.data)

            if (data.type === 'authenticated') {
              reconnectAttempts = 0
              reconnectNoticeShown = false
              setIsConnected(true)
            } else if (data.type === 'presence_update' && Array.isArray(data.online_users)) {
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
                body: maskCodes(data.message?.body || 'You have received a new message.'),
              })
            } else if (data.type === 'notification_created') {
              if (isSensitiveNotification(data.notification || {})) return
              window.dispatchEvent(new CustomEvent('app:notification', { detail: data.notification }))
              sendSystemNotification(maskCodes(data.notification?.title || 'New Notification'), {
                body: maskCodes(data.notification?.body || ''),
              })
            }
          } catch {
            // Ignore malformed socket messages without affecting auth state.
          }
        }

        socket.onclose = (event) => {
          const closeCode = event.code
          setIsConnected(false)
          if (closeCode === 4403) return
          scheduleReconnect(closeCode === 4401)
        }

        socket.onerror = () => {
          socket?.close()
        }
      } catch {
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      isActive = false
      if (reconnectTimeout !== null) clearTimeout(reconnectTimeout)
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close()
      } else if (socket?.readyState === WebSocket.CONNECTING) {
        const connectingSocket = socket
        connectingSocket.onopen = () => connectingSocket.close()
      }
    }
  }, [userId, isAuthenticated])

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
