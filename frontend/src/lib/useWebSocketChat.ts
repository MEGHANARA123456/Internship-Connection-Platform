import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { isSensitiveNotification, maskCodes, sendSystemNotification } from './notifications'

interface WebSocketMessage {
  type: string
  [key: string]: any
}

export function useWebSocketChat(userId?: number) {
  const accessToken = useAuthStore((state) => state.session?.accessToken)
  const [isConnected, setIsConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<number[]>([])
  const [typingMap, setTypingMap] = useState<Record<number, boolean>>({})
  const socketRef = useRef<WebSocket | null>(null)
  const onNewMessageRef = useRef<((convId: number, msg: any) => void) | null>(null)
  const authRefreshAttemptedRef = useRef<{ userId?: number; attempted: boolean }>({ attempted: false })

  useEffect(() => {
    if (!userId || !accessToken) return
    if (authRefreshAttemptedRef.current.userId !== userId) {
      authRefreshAttemptedRef.current = { userId, attempted: false }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname || 'localhost'
    const wsUrl = `${protocol}//${host}:8010/api/v1/ws/chat/${userId}?token=${encodeURIComponent(accessToken)}`

    let socket: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0
    let isActive = true
    const maxReconnectAttempts = 8
    const refreshAccessToken = async () => {
      const session = useAuthStore.getState().session
      if (!session?.refreshToken) return
      try {
        const response = await api.post('/auth/refresh', { refresh_token: session.refreshToken })
        const tokens = response.data
        useAuthStore.getState().setSession({
          ...session,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          role: tokens.role,
          userId: tokens.user_id,
          accessTokenExpiresAt: tokens.access_token_expires_at ?? null,
          refreshTokenExpiresAt: tokens.refresh_token_expires_at ?? null,
          accessTokenExpiresIn: tokens.access_token_expires_in ?? null,
          refreshTokenExpiresIn: tokens.refresh_token_expires_in ?? null,
        })
      } catch {
        useAuthStore.getState().logout()
      }
    }

    const connect = () => {
      try {
        socket = new WebSocket(wsUrl)
        socketRef.current = socket

        socket.onopen = () => {
          reconnectAttempts = 0
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
            // Ignored
          }
        }

        socket.onclose = (event) => {
          const closeCode = event.code
          setIsConnected(false)
          if (closeCode === 4403) return
          if (closeCode === 4401) {
            if (!authRefreshAttemptedRef.current.attempted) {
              authRefreshAttemptedRef.current.attempted = true
              void refreshAccessToken()
            }
            return
          }
          if (!isActive || reconnectAttempts >= maxReconnectAttempts) return
          const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000)
          reconnectAttempts += 1
          reconnectTimeout = setTimeout(connect, delay)
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
      isActive = false
      if (reconnectTimeout !== null) clearTimeout(reconnectTimeout)
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close()
      } else if (socket?.readyState === WebSocket.CONNECTING) {
        const connectingSocket = socket
        connectingSocket.onopen = () => connectingSocket.close()
      }
    }
  }, [userId, accessToken])

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
