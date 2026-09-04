import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { EmptyState } from '../components/ui/EmptyState'
import { CardSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorState } from '../components/ui/ErrorState'
import { VideoInterviewModal } from '../components/modals/VideoInterviewModal'
import { useWebSocketChat } from '../lib/useWebSocketChat'
import { requestNotificationPermission } from '../lib/notifications'
import {
  Calendar,
  Clock,
  Video,
  ExternalLink,
  MessageSquare,
  Send,
  Bell,
  CheckCheck,
  Plus,
  AlertCircle,
  Download,
} from 'lucide-react'

// --- 1. Scheduled Interviews Page ---

export function InterviewsPage() {
  const { session } = useAuthStore()
  const [interviews, setInterviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [videoModalInterview, setVideoModalInterview] = useState<any | null>(null)

  const downloadIcs = (item: any) => {
    try {
      const start = new Date(item.scheduled_at).toISOString().replace(/-|:|\.\d\d\d/g, "")
      const end = new Date(new Date(item.scheduled_at).getTime() + 45*60000).toISOString().replace(/-|:|\.\d\d\d/g, "")
      const icsData = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        `SUMMARY:${item.interview_type} Interview - InternshipHub`,
        `DESCRIPTION:${item.notes || 'Scheduled Interview Session'}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\n")
      const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' })
      const link = document.createElement('a')
      link.href = window.URL.createObjectURL(blob)
      link.setAttribute('download', `interview-${item.id}.ics`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      alert('Unable to export calendar invite.')
    }
  }

  const fetchInterviews = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/interviews/my')
      setInterviews(res.data || [])
    } catch {
      setError('Failed to fetch your scheduled interviews.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInterviews()
  }, [])

  const handleUpdateStatus = async (interviewId: number, newStatus: string) => {
    setUpdatingId(interviewId)
    try {
      await api.patch(`/interviews/${interviewId}`, { status: newStatus })
      fetchInterviews()
    } catch {
      alert('Failed to update interview status.')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Interviews & Meetings</h1>
        <p className="text-xs text-slate-500 mt-1">
          Review upcoming candidate screenings and technical discussions.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchInterviews} />
      ) : interviews.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No interviews scheduled yet"
          description="Scheduled interviews will appear here once candidates are shortlisted and session details are confirmed."
        />
      ) : (
        <div className="space-y-4">
          {interviews.map((item) => {
            const dateObj = new Date(item.scheduled_at)
            const isCompany = session?.role === 'COMPANY'

            return (
              <Card key={item.id} className="p-5 bg-white space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900">
                        {item.interview_type} Interview
                      </h3>
                      <Badge status={item.status}>{item.status}</Badge>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500 pt-1">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {dateObj.toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {item.notes && (
                      <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100 mt-2">
                        <strong className="text-slate-700">Instructions:</strong> {item.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setVideoModalInterview(item)}
                      leftIcon={<Video className="w-3.5 h-3.5" />}
                      className="bg-indigo-600 hover:bg-indigo-700"
                    >
                      Launch In-App Video
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadIcs(item)}
                      leftIcon={<Download className="w-3.5 h-3.5 text-slate-500" />}
                      title="Export .ics calendar invitation"
                    >
                      Sync .ics
                    </Button>

                    {item.meeting_link && (
                      <a
                        href={item.meeting_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block"
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          rightIcon={<ExternalLink className="w-3.5 h-3.5 ml-1" />}
                        >
                          External Link
                        </Button>
                      </a>
                    )}

                    {isCompany && item.status === 'SCHEDULED' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={updatingId === item.id}
                          onClick={() => handleUpdateStatus(item.id, 'COMPLETED')}
                        >
                          Mark Done
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600"
                          isLoading={updatingId === item.id}
                          onClick={() => handleUpdateStatus(item.id, 'CANCELLED')}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Embedded WebRTC In-App Video Room Modal */}
      {videoModalInterview && (
        <VideoInterviewModal
          isOpen={!!videoModalInterview}
          onClose={() => setVideoModalInterview(null)}
          interviewId={videoModalInterview.id}
          roleName={`${videoModalInterview.interview_type} Interview`}
        />
      )}
    </div>
  )
}

// --- 2. Split-Pane Chat & Messaging Page ---

export function MessagesPage() {
  const { session } = useAuthStore()
  const currentUserId = session?.userId

  const { isConnected, isUserOnline, typingMap, sendTyping, setOnNewMessageCallback } = useWebSocketChat(currentUserId)
  const typingTimeoutRef = useRef<any>(null)

  const [conversations, setConversations] = useState<any[]>([])
  const [selectedConv, setSelectedConv] = useState<any | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [newMessageText, setNewMessageText] = useState('')
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [sending, setSending] = useState(false)
  const [newConvModalOpen, setNewConvModalOpen] = useState(false)
  const [recipientIdInput, setRecipientIdInput] = useState('')
  const [contacts, setContacts] = useState<any[]>([])
  const [loadingContacts, setLoadingContacts] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [startingConvId, setStartingConvId] = useState<number | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestNotificationPermission()
  }, [])

  // Fetch all conversations
  const fetchConversations = async () => {
    try {
      const res = await api.get('/conversations')
      setConversations(res.data || [])
      if (!selectedConv && res.data && res.data.length > 0) {
        setSelectedConv(res.data[0])
      }
    } catch {
      // conversation fetch error handled
    } finally {
      setLoadingConvs(false)
    }
  }

  const openNewConvModal = async () => {
    setNewConvModalOpen(true)
    setModalError(null)
    setLoadingContacts(true)
    try {
      const res = await api.get('/contacts')
      setContacts(res.data || [])
    } catch {
      setContacts([])
    } finally {
      setLoadingContacts(false)
    }
  }

  useEffect(() => {
    fetchConversations()
    const interval = setInterval(fetchConversations, 10000)
    return () => clearInterval(interval)
  }, [])

  // Fetch messages for selected conversation
  const fetchMessages = async (convId: number) => {
    setLoadingMsgs(true)
    try {
      const res = await api.get(`/conversations/${convId}/messages`)
      setMessages(res.data || [])
    } catch {
      // message fetch error
    } finally {
      setLoadingMsgs(false)
    }
  }

  useEffect(() => {
    if (!selectedConv) return
    fetchMessages(selectedConv.id)
    const interval = setInterval(() => {
      api
        .get(`/conversations/${selectedConv.id}/messages`)
        .then((res) => setMessages(res.data || []))
        .catch(() => {})
    }, 4000)
    return () => clearInterval(interval)
  }, [selectedConv?.id])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Real-time message auto-append & typing broadcaster
  useEffect(() => {
    setOnNewMessageCallback((convId, msg) => {
      if (selectedConv?.id === convId) {
        setMessages((prev) => [...prev, msg])
      }
      fetchConversations()
    })
  }, [selectedConv?.id, setOnNewMessageCallback])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessageText(e.target.value)
    if (selectedConv) {
      sendTyping(selectedConv.id, selectedConv.partner_id, true)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = setTimeout(() => {
        sendTyping(selectedConv.id, selectedConv.partner_id, false)
      }, 2000)
    }
  }

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedConv || !newMessageText.trim() || sending) return

    setSending(true)
    const textToSend = newMessageText.trim()
    setNewMessageText('')
    if (selectedConv) {
      sendTyping(selectedConv.id, selectedConv.partner_id, false)
    }

    try {
      const res = await api.post(`/conversations/${selectedConv.id}/messages`, {
        body: textToSend,
      })
      setMessages((prev) => [...prev, res.data])
    } catch {
      alert('Failed to send message.')
      setNewMessageText(textToSend)
    } finally {
      setSending(false)
    }
  }

  // Start new conversation
  const handleCreateConversation = async (explicitId?: number) => {
    setModalError(null)
    const targetId = explicitId ?? parseInt(recipientIdInput.trim())
    if (isNaN(targetId)) {
      setModalError('Please select a contact or enter a valid User ID.')
      return
    }
    setStartingConvId(targetId)
    try {
      const res = await api.post('/conversations', { participant_id: targetId })
      setNewConvModalOpen(false)
      setRecipientIdInput('')
      await fetchConversations()
      setSelectedConv(res.data)
    } catch (err: any) {
      if (err.response?.status === 404) {
        setModalError('Target user does not exist on the platform.')
      } else if (err.response?.status === 400) {
        setModalError('You cannot start a conversation with yourself.')
      } else {
        setModalError('Could not start conversation. Please try again.')
      }
    } finally {
      setStartingConvId(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full h-[calc(100vh-6rem)] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Direct Messages</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Connect with recruiters, candidates, and team members in real-time.</p>
          </div>
          {isConnected && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={openNewConvModal}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
        >
          New Chat
        </Button>
      </div>

      {/* Split Pane Container */}
      <div className="flex-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden flex flex-col md:flex-row min-h-0">
        {/* Left Pane: Conversation List */}
        <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Conversations ({conversations.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
            {loadingConvs ? (
              <div className="p-4 space-y-3">
                <div className="h-10 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg" />
                <div className="h-10 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                <p>No active conversations yet.</p>
                <Button size="sm" variant="outline" onClick={openNewConvModal}>
                  Start a conversation
                </Button>
              </div>
            ) : (
              conversations.map((conv) => {
                const isSelected = selectedConv?.id === conv.id
                const isOnline = isUserOnline(conv.partner_id)
                const isTyping = typingMap[conv.id]
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConv(conv)}
                    className={`w-full p-3.5 text-left transition-colors flex items-center gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-l-4 border-indigo-600 dark:border-indigo-500'
                        : 'hover:bg-white dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center font-bold text-xs text-indigo-700 dark:text-indigo-300">
                        {(conv.partner_name || 'U')[0].toUpperCase()}
                      </div>
                      <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                          isOnline ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                        title={isOnline ? 'Online' : 'Offline'}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {conv.partner_name || `Conversation #${conv.id}`}
                        </span>
                        {conv.partner_role && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold shrink-0">
                            {conv.partner_role}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {isTyping ? (
                          <span className="text-indigo-600 dark:text-indigo-400 font-medium italic animate-pulse">Typing...</span>
                        ) : (
                          conv.last_message || 'Click to view messages'
                        )}
                      </p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right Pane: Active Thread */}
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-900">
          {selectedConv ? (
            <>
              {/* Thread Header */}
              <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold text-xs">
                      {(selectedConv.partner_name || 'U')[0].toUpperCase()}
                    </div>
                    <span
                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                        isUserOnline(selectedConv.partner_id) ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      {selectedConv.partner_name || `Conversation #${selectedConv.id}`}
                      <span className={`text-[10px] font-normal ${isUserOnline(selectedConv.partner_id) ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                        {isUserOnline(selectedConv.partner_id) ? 'Active now' : 'Offline'}
                      </span>
                    </h3>
                    <p className="text-[10px] text-slate-400 capitalize">
                      {selectedConv.partner_role || 'Connected Member'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30 dark:bg-slate-950/30">
                {loadingMsgs ? (
                  <div className="flex justify-center p-6 text-xs text-slate-400">Loading messages...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12 text-xs text-slate-400">
                    No messages yet. Send a greeting to start chatting!
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.sender_id === currentUserId
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-xs ${
                            isMine
                              ? 'bg-indigo-600 text-white rounded-br-xs'
                              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-xs shadow-2xs'
                          }`}
                        >
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                        </div>
                        <span className="text-[10px] text-slate-400 mt-1 px-1">
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    )
                  })
                )}

                {/* Animated Typing Indicator Bubble */}
                {typingMap[selectedConv.id] && (
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-200/70 dark:bg-slate-800 rounded-2xl w-fit text-xs text-slate-600 dark:text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:0.4s]" />
                    <span className="text-[11px] ml-1 font-medium">{selectedConv.partner_name || 'User'} is typing...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Form */}
              <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={newMessageText}
                  onChange={handleInputChange}
                  className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  isLoading={sending}
                  disabled={!newMessageText.trim()}
                  rightIcon={<Send className="w-3.5 h-3.5" />}
                >
                  Send
                </Button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-slate-400 text-xs">
              Select a conversation from the left to start chatting.
            </div>
          )}
        </div>
      </div>

      {/* Start New Conversation Modal */}
      <Modal
        isOpen={newConvModalOpen}
        onClose={() => setNewConvModalOpen(false)}
        title="Start Conversation"
        description="Choose an active connection or enter a User ID to start chatting."
        maxWidth="md"
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{modalError}</span>
            </div>
          )}

          {/* Suggested Contacts */}
          <div>
            <span className="text-xs font-semibold text-slate-700 block mb-2">Available Contacts</span>
            {loadingContacts ? (
              <div className="text-xs text-slate-400 py-3 text-center">Finding active members...</div>
            ) : contacts.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">No suggested contacts found. Enter User ID below.</div>
            ) : (
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {contacts.map((c) => (
                  <div key={c.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                        {(c.name || 'U')[0].toUpperCase()}
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">{c.name}</span>
                        <span className="text-[10px] text-slate-400">{c.role} • {c.email}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      isLoading={startingConvId === c.id}
                      onClick={() => handleCreateConversation(c.id)}
                    >
                      Chat
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink-0 mx-2 text-[10px] text-slate-400 uppercase font-semibold">Or manual User ID</span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Enter User ID (e.g. 45)"
              value={recipientIdInput}
              onChange={(e) => setRecipientIdInput(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
            <Button
              variant="primary"
              size="sm"
              isLoading={startingConvId === parseInt(recipientIdInput)}
              onClick={() => handleCreateConversation()}
            >
              Open Chat
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// --- 3. Notifications Page ---

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNotifications = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/notifications')
      setNotifications(res.data || [])
    } catch {
      setError('Failed to fetch notifications.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
  }, [])

  const handleMarkAllRead = async () => {
    try {
      await api.post('/notifications/read-all')
      fetchNotifications()
    } catch {
      alert('Failed to mark notifications as read.')
    }
  }

  const handleMarkRead = async (id: number) => {
    try {
      await api.patch(`/notifications/${id}/read`)
      fetchNotifications()
    } catch {
      // ignore
    }
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Notifications</h1>
          <p className="text-xs text-slate-500 mt-1">
            Stay updated on application decisions, interview invitations, and status changes.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleMarkAllRead}
            leftIcon={<CheckCheck className="w-3.5 h-3.5 text-indigo-600" />}
          >
            Mark all read
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchNotifications} />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description="You're all caught up! Updates regarding applications and interviews will appear here."
        />
      ) : (
        <div className="space-y-2.5">
          {notifications.map((item) => (
            <Card
              key={item.id}
              onClick={() => !item.read_at && handleMarkRead(item.id)}
              className={`p-4 transition-all cursor-pointer ${
                item.read_at
                  ? 'bg-white border-slate-200 opacity-80'
                  : 'bg-indigo-50/40 border-indigo-200 hover:border-indigo-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-900">{item.title}</h4>
                    {!item.read_at && (
                      <span className="w-2 h-2 rounded-full bg-indigo-600 inline-block" />
                    )}
                  </div>
                  <p className="text-xs text-slate-600">{item.message}</p>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}