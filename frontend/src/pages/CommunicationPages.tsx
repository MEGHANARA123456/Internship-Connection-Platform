import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
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
  ChevronLeft,
  Mail,
  RefreshCw,
  Eye,
  Inbox,
  Lock,
  KeyRound,
  Copy,
  Check,
  Sparkles,
  CheckCircle2,
  FileText,
  Code,
  Award,
  Users,
  ArrowRight,
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
        `SUMMARY:${item.interview_type} Interview - InternSphere`,
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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Interviews & Meetings</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Review your upcoming candidate screenings, technical evaluations, and interview process milestones.
        </p>
      </div>

      {/* 4-Stage Interview Process Roadmap */}
      <div className="mb-8 p-5 bg-linear-to-r from-indigo-50/90 via-white to-purple-50/70 dark:from-slate-900/90 dark:via-slate-900 dark:to-indigo-950/40 rounded-2xl border border-indigo-100 dark:border-indigo-900/60 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-2xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">InternSphere Interview Process & Stages</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Standard structured evaluation roadmap from application review to formal offer</p>
            </div>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 w-fit">
            Official 4-Stage Roadmap
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Stage 1 */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 flex flex-col justify-between shadow-2xs">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  STAGE 1
                </span>
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-1">Resume Screening</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Recruiters review candidate background, education credentials, and ATS-optimized in-app resume.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Milestone:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Shortlisted</span>
            </div>
          </div>

          {/* Stage 2 */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 flex flex-col justify-between shadow-2xs">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  STAGE 2
                </span>
                <Code className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-1">Technical Assessment</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Skill verification via track quizzes (Python, React, SQL, Cloud) or take-home technical challenge.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Milestone:</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">Skill Certified</span>
            </div>
          </div>

          {/* Stage 3 */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-800/90 border-2 border-indigo-500 dark:border-indigo-500/80 flex flex-col justify-between shadow-xs">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300">
                  STAGE 3 (LIVE)
                </span>
                <Video className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-1">Live Video Interview</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                45-min live session via encrypted In-App WebRTC video room or Google Meet with .ics calendar sync.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Milestone:</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">Interview Scheduled</span>
            </div>
          </div>

          {/* Stage 4 */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 flex flex-col justify-between shadow-2xs">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  STAGE 4
                </span>
                <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-1">Offer & Onboarding</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Official internship offer generation, stipend and joining date finalization, and agreement signature.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Milestone:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Placed & Accepted</span>
            </div>
          </div>
        </div>

        {/* Preparation Guidelines */}
        <div className="mt-4 p-3 bg-white/80 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 text-[11px]">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            Interview Readiness Checklist:
          </span>
          <div className="flex items-center gap-4 text-[11px] text-slate-600 dark:text-slate-400 flex-wrap">
            <span>• Test Camera & Microphone in advance</span>
            <span>• Review job requirements & your project repos</span>
            <span>• Export & Sync meeting invite (.ics) to your calendar</span>
            <span>• Join 5 minutes early in a quiet setting</span>
          </div>
        </div>
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
          title="No scheduled interviews yet"
          description="Once your application is reviewed and shortlisted by a recruiter, interview sessions will appear here with in-app video links and calendar invitations."
        />
      ) : (
        <div className="space-y-4">
          {interviews.map((item) => {
            const dateObj = new Date(item.scheduled_at)
            const isCompany = session?.role === 'COMPANY'

            return (
              <Card key={item.id} className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        {item.interview_type} Interview
                      </h3>
                      <Badge status={item.status}>{item.status}</Badge>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 pt-1">
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
                      <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-md border border-slate-100 dark:border-slate-700/60 mt-2">
                        <strong className="text-slate-700 dark:text-slate-200">Instructions:</strong> {item.notes}
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

  const [activeTab, setActiveTab] = useState<'chats' | 'recruiters'>('chats')
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
  const [recommendedContacts, setRecommendedContacts] = useState<any[]>([])
  const [loadingRecommended, setLoadingRecommended] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [startingConvId, setStartingConvId] = useState<number | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestNotificationPermission().catch(() => {})
  }, [])

  // Fetch recommended hiring company contacts
  const fetchRecommendedContacts = async () => {
    setLoadingRecommended(true)
    try {
      const res = await api.get('/contacts/recommended')
      setRecommendedContacts(Array.isArray(res.data) ? res.data : [])
    } catch {
      setRecommendedContacts([])
    } finally {
      setLoadingRecommended(false)
    }
  }

  // Fetch all conversations
  const fetchConversations = async () => {
    try {
      const res = await api.get('/conversations')
      const convs = Array.isArray(res.data) ? res.data : []
      setConversations(convs)
      if (!selectedConv && convs.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768) {
        setSelectedConv(convs[0])
      }
    } catch {
      setConversations([])
    } finally {
      setLoadingConvs(false)
    }
  }

  const openNewConvModal = async () => {
    setNewConvModalOpen(true)
    setModalError(null)
    setLoadingContacts(true)
    fetchRecommendedContacts()
    try {
      const res = await api.get('/contacts')
      setContacts(Array.isArray(res.data) ? res.data : [])
    } catch {
      setContacts([])
    } finally {
      setLoadingContacts(false)
    }
  }

  useEffect(() => {
    fetchConversations()
    fetchRecommendedContacts()
    const interval = setInterval(fetchConversations, 10000)
    return () => clearInterval(interval)
  }, [])

  // Fetch messages for selected conversation
  const fetchMessages = async (convId: number) => {
    setLoadingMsgs(true)
    try {
      const res = await api.get(`/conversations/${convId}/messages`)
      setMessages(Array.isArray(res.data) ? res.data : [])
    } catch {
      setMessages([])
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
        .then((res) => setMessages(Array.isArray(res.data) ? res.data : []))
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
      fetchConversations()
    } catch {
      alert('Failed to send message.')
      setNewMessageText(textToSend)
    } finally {
      setSending(false)
    }
  }

  // Start new conversation or switch to existing
  const handleCreateConversation = async (explicitId?: number) => {
    setModalError(null)
    const targetId = explicitId ?? parseInt(recipientIdInput.trim())
    if (!targetId || isNaN(targetId)) {
      setModalError('Please select a contact or enter a valid User ID.')
      return
    }

    // Check if conversation already exists in our loaded list
    const existing = conversations.find(
      (c) => c.partner_id === targetId || c.student_id === targetId || c.company_id === targetId
    )
    if (existing) {
      setSelectedConv(existing)
      setNewConvModalOpen(false)
      setRecipientIdInput('')
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
      {/* Top Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Direct Messages & Chat</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Communicate directly with hiring recruiters, interview coordinators, and candidate teams.
            </p>
          </div>
          {isConnected && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Connected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/interviews">
            <Button size="sm" variant="outline" leftIcon={<Calendar className="w-3.5 h-3.5" />}>
              Interview Roadmap
            </Button>
          </Link>
          <Button
            size="sm"
            variant="primary"
            onClick={openNewConvModal}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            New Chat
          </Button>
        </div>
      </div>

      {/* Suggested Recruiters / Contacts Top Carousel */}
      {Array.isArray(recommendedContacts) && recommendedContacts.length > 0 && (
        <div className="mb-4 p-3.5 bg-linear-to-r from-indigo-50/90 via-white to-purple-50/70 dark:from-slate-900/90 dark:via-slate-900 dark:to-indigo-950/40 rounded-xl border border-indigo-100 dark:border-indigo-900/60 shadow-2xs shrink-0">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Suggested Recruiters & Hiring Companies to Chat
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                • Connect directly with recruiters for open roles, candidate screening, and interview scheduling
              </span>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300">
              {recommendedContacts.length} Available
            </span>
          </div>

          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            {recommendedContacts.map((c) => {
              const targetId = c.id || c.user_id || c.company_user_id || c.company_id
              const name = c.company_name || c.name || c.student_name || 'Recruiter'
              const roleBadge = c.relationship || c.status || (c.role === 'COMPANY' ? 'Hiring Now' : 'Candidate')
              const roleTitle = c.active_role || (c.recent_roles && c.recent_roles[0]) || c.applied_role || c.industry || 'Open Role'
              const stipendText = c.stipend ? `₹${Number(c.stipend).toLocaleString()}/mo` : null
              const workModeText = c.work_mode || null

              return (
                <div
                  key={targetId || name}
                  className="p-3 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs flex items-center gap-3 shrink-0 min-w-[260px] max-w-[300px] hover:border-indigo-300 dark:hover:border-indigo-600 transition-all"
                >
                  <div className="w-9 h-9 rounded-xl bg-linear-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                    {(name || 'C')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {name}
                      </span>
                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          roleBadge === 'Applied'
                            ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300'
                            : 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300'
                        }`}
                      >
                        {roleBadge}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {roleTitle}
                    </p>
                    {(stipendText || workModeText) && (
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
                        {[stipendText, workModeText].filter(Boolean).join(' • ')}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] px-2.5 py-1 h-7 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 shrink-0 cursor-pointer"
                    isLoading={startingConvId === targetId}
                    onClick={() => handleCreateConversation(targetId)}
                  >
                    Chat
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Split Pane Container */}
      <div className="flex-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden flex flex-col md:flex-row min-h-0">
        {/* Left Pane: Conversation List & Recruiter Switcher */}
        <div
          className={`w-full md:w-84 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 flex-col shrink-0 bg-slate-50/50 dark:bg-slate-900/50 ${
            selectedConv ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Sidebar Tab Header */}
          <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('chats')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'chats'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chats ({conversations.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('recruiters')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'recruiters'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Recruiters ({recommendedContacts.length})</span>
            </button>
          </div>

          {/* Tab 1: Active Conversations List */}
          {activeTab === 'chats' && (
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
              {loadingConvs ? (
                <div className="p-4 space-y-3">
                  <div className="h-10 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg" />
                  <div className="h-10 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
                  <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                  <p className="font-medium text-slate-700 dark:text-slate-300">No active conversations yet.</p>
                  <p className="text-[11px] text-slate-400">
                    Connect with hiring recruiters to discuss opportunities and interview stages.
                  </p>
                  <div className="pt-2 flex flex-col gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      className="w-full"
                      onClick={() => setActiveTab('recruiters')}
                    >
                      Browse Suggested Recruiters
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={openNewConvModal}
                    >
                      Start New Chat
                    </Button>
                  </div>
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
                            <span className="text-indigo-600 dark:text-indigo-400 font-medium italic animate-pulse">
                              Typing...
                            </span>
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
          )}

          {/* Tab 2: Suggested Recruiters List */}
          {activeTab === 'recruiters' && (
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
              {loadingRecommended ? (
                <div className="p-4 space-y-3">
                  <div className="h-10 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg" />
                  <div className="h-10 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg" />
                </div>
              ) : recommendedContacts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                  <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                  <p>No suggested recruiters found at this moment.</p>
                </div>
              ) : (
                recommendedContacts.map((c) => {
                  const targetId = c.id || c.user_id || c.company_user_id || c.company_id
                  const name = c.company_name || c.name || c.student_name || 'Recruiter'
                  const roleBadge = c.relationship || c.status || (c.role === 'COMPANY' ? 'Hiring Now' : 'Candidate')
                  const roleTitle = c.active_role || (c.recent_roles && c.recent_roles[0]) || c.applied_role || c.industry || 'Open Role'

                  return (
                    <div
                      key={targetId || name}
                      className="p-3 hover:bg-white dark:hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-linear-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                          {(name || 'C')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {name}
                            </span>
                            <span className="text-[9px] font-semibold px-1 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 shrink-0">
                              {roleBadge}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {roleTitle}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] px-2 py-1 h-7 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 shrink-0 cursor-pointer"
                        isLoading={startingConvId === targetId}
                        onClick={() => handleCreateConversation(targetId)}
                      >
                        Message
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Right Pane: Active Thread */}
        <div className={`flex-1 flex-col min-w-0 bg-white dark:bg-slate-900 ${selectedConv ? 'flex' : 'hidden md:flex'}`}>
          {selectedConv ? (
            <>
              {/* Thread Header */}
              <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedConv(null)}
                    className="md:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    aria-label="Back to conversations"
                    title="Back to conversations"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
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
                      <span
                        className={`text-[10px] font-normal ${
                          isUserOnline(selectedConv.partner_id)
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {isUserOnline(selectedConv.partner_id) ? 'Active now' : 'Offline'}
                      </span>
                    </h3>
                    <p className="text-[10px] text-slate-400 capitalize">
                      {selectedConv.partner_role || 'Connected Member'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Link to="/interviews">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7.5 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                      leftIcon={<Calendar className="w-3 h-3" />}
                    >
                      Interview Process
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Clear Interview Process Roadmap Banner inside Chat */}
              <div className="px-3.5 py-2 bg-indigo-50/70 dark:bg-indigo-950/40 border-b border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="text-[11px] text-slate-700 dark:text-slate-300 truncate">
                    <strong>Interview Process:</strong> 1. Screening → 2. Skill Assessment → 3. Live Video Round → 4. Offer
                  </span>
                </div>
                <Link
                  to="/interviews"
                  className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1 shrink-0 ml-2"
                >
                  Schedule / View <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30 dark:bg-slate-950/30">
                {loadingMsgs ? (
                  <div className="flex justify-center p-6 text-xs text-slate-400">Loading messages...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12 text-xs text-slate-400 space-y-2">
                    <p>No messages yet. Send a greeting to start chatting!</p>
                    <p className="text-[11px] text-slate-400">
                      Discuss roles, ask recruiter questions, and coordinate your interview stages.
                    </p>
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
                    <span className="text-[11px] ml-1 font-medium">
                      {selectedConv.partner_name || 'User'} is typing...
                    </span>
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
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 text-xs space-y-3">
              <MessageSquare className="w-10 h-10 text-slate-300 dark:text-slate-700" />
              <p className="font-medium text-slate-600 dark:text-slate-300">
                Select a conversation or pick a suggested recruiter from the list.
              </p>
              <p className="text-[11px] text-slate-400 max-w-sm">
                Communicate directly with hiring managers, track evaluation stages, and prepare for live interviews.
              </p>
              {recommendedContacts.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveTab('recruiters')}
                  leftIcon={<Users className="w-3.5 h-3.5" />}
                >
                  View {recommendedContacts.length} Suggested Recruiters
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Start New Conversation Modal */}
      <Modal
        isOpen={newConvModalOpen}
        onClose={() => setNewConvModalOpen(false)}
        title="Start Conversation"
        description="Choose a suggested recruiter or enter a User ID to start chatting."
        maxWidth="md"
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-lg text-xs text-rose-700 dark:text-rose-300 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{modalError}</span>
            </div>
          )}

          {/* Recommended Internship Contacts in Modal */}
          {Array.isArray(recommendedContacts) && recommendedContacts.length > 0 && (
            <div>
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                Suggested Recruiters & Companies
              </span>
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-indigo-100 dark:border-indigo-900/60 rounded-lg bg-indigo-50/20 dark:bg-indigo-950/20 mb-3">
                {recommendedContacts.map((c) => {
                  const targetId = c.id || c.user_id || c.company_user_id || c.company_id
                  const name = c.company_name || c.name || c.student_name || 'Recruiter'
                  const roleBadge = c.relationship || c.status || (c.role === 'COMPANY' ? 'Hiring Now' : 'Candidate')
                  const roleTitle = c.active_role || (c.recent_roles && c.recent_roles[0]) || c.applied_role || c.industry || 'Open Role'

                  return (
                    <div
                      key={targetId || name}
                      className="p-2.5 flex items-center justify-between hover:bg-indigo-50/50 dark:hover:bg-indigo-950/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                          {(name || 'C')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-slate-900 dark:text-white block truncate">
                            {name}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block">
                            {roleBadge} • {roleTitle}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        className="text-xs py-1 px-2.5 h-7 shrink-0 cursor-pointer"
                        isLoading={startingConvId === targetId}
                        onClick={() => handleCreateConversation(targetId)}
                      >
                        Chat
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Suggested Contacts */}
          <div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">Available Members</span>
            {loadingContacts ? (
              <div className="text-xs text-slate-400 py-3 text-center">Finding active members...</div>
            ) : contacts.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">No other contacts found. Enter User ID below.</div>
            ) : (
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                {contacts.map((c) => (
                  <div key={c.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold text-xs shrink-0">
                        {(c.name || 'U')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-900 dark:text-white block truncate">{c.name}</span>
                        <span className="text-[10px] text-slate-400 truncate block">{c.role} • {c.email}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      className="text-xs py-1 px-2.5 h-7 shrink-0 cursor-pointer"
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
            <div className="flex-grow border-t border-slate-200 dark:border-slate-700" />
            <span className="shrink-0 mx-2 text-[10px] text-slate-400 uppercase font-semibold">Or manual User ID</span>
            <div className="flex-grow border-t border-slate-200 dark:border-slate-700" />
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Enter User ID (e.g. 22)"
              value={recipientIdInput}
              onChange={(e) => setRecipientIdInput(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
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

// --- 3. Notifications Page with Personal Mailbox ---

export function NotificationsPage() {
  const { session } = useAuthStore()
  const userEmail = session?.email || ''

  const [activeTab, setActiveTab] = useState<'notifications' | 'emails'>('notifications')
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Direct Mailbox State (User-only emails)
  const [emails, setEmails] = useState<any[]>([])
  const [loadingEmails, setLoadingEmails] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null)
  const [copiedOtp, setCopiedOtp] = useState<string | null>(null)

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

  const fetchUserEmails = async () => {
    setLoadingEmails(true)
    setEmailError(null)
    try {
      const res = await api.get('/mailbox/my')
      setEmails(res.data || [])
      if (res.data && res.data.length > 0 && !expandedEmailId) {
        setExpandedEmailId(res.data[0].id)
      }
    } catch {
      setEmailError('Failed to retrieve user emails from mailbox service.')
    } finally {
      setLoadingEmails(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
    fetchUserEmails()
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

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedOtp(code)
    setTimeout(() => setCopiedOtp(null), 2500)
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Notifications & Mailbox
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Stay updated on application decisions, interview invitations, and direct email messages.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'notifications' && unreadCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleMarkAllRead}
              leftIcon={<CheckCheck className="w-3.5 h-3.5 text-indigo-600" />}
            >
              Mark all read
            </Button>
          )}

          {activeTab === 'emails' && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={fetchUserEmails}
                isLoading={loadingEmails}
                leftIcon={<RefreshCw className="w-3.5 h-3.5 text-slate-500" />}
              >
                Refresh
              </Button>
              <a
                href={userEmail ? `http://localhost:8025?search=${encodeURIComponent(userEmail)}` : 'http://localhost:8025'}
                target="_blank"
                rel="noreferrer"
              >
                <Button
                  size="sm"
                  variant="primary"
                  leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  Mailpit Webmail (8025)
                </Button>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 mb-6">
        <button
          type="button"
          onClick={() => setActiveTab('notifications')}
          className={`pb-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'notifications'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Platform Alerts</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold">
              {unreadCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('emails')
            fetchUserEmails()
          }}
          className={`pb-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'emails'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Mail className="w-4 h-4" />
          <span>My Direct Emails</span>
          {emails.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 font-bold">
              {emails.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === 'notifications' ? (
        loading ? (
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
                    ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-80'
                    : 'bg-indigo-50/40 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 hover:border-indigo-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">{item.title}</h4>
                      {!item.read_at && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600 inline-block" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{item.message}</p>
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        /* My Direct Emails View */
        <div className="space-y-4">
          {/* Privacy & Scoping Notice */}
          <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 rounded-xl flex items-center justify-between gap-3 text-xs text-indigo-900 dark:text-indigo-200">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>
                <strong>User-Only View:</strong> Displaying only emails addressed to{' '}
                <span className="font-mono font-bold underline">{userEmail || 'your email'}</span>.
              </span>
            </div>
            <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold shrink-0 hidden sm:inline">
              Mailpit Port 8025 Active
            </span>
          </div>

          {loadingEmails ? (
            <div className="space-y-3">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : emailError ? (
            <ErrorState message={emailError} onRetry={fetchUserEmails} />
          ) : emails.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No direct emails found"
              description={`We haven't recorded any emails addressed to ${userEmail || 'your address'} yet. Verification codes and application confirmations will display here.`}
            />
          ) : (
            <div className="space-y-3">
              {emails.map((mail) => {
                const isExpanded = expandedEmailId === mail.id
                const otpMatch = (mail.subject + ' ' + (mail.body || '')).match(/\b\d{6}\b/)
                const detectedOtp = otpMatch ? otpMatch[0] : null

                return (
                  <Card
                    key={mail.id}
                    className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            {mail.subject}
                          </h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            To: {mail.to}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          From: <span className="font-medium text-slate-700 dark:text-slate-300">{mail.from}</span>
                          {' • '}
                          {new Date(mail.created_at).toLocaleString()}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {detectedOtp && (
                          <button
                            type="button"
                            onClick={() => handleCopyCode(detectedOtp)}
                            className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 hover:bg-emerald-100 transition-colors cursor-pointer"
                            title="Copy OTP to clipboard"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{detectedOtp}</span>
                            {copiedOtp === detectedOtp ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </button>
                        )}

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setExpandedEmailId(isExpanded ? null : mail.id)}
                          leftIcon={<Eye className="w-3.5 h-3.5 text-slate-500" />}
                        >
                          {isExpanded ? 'Hide Content' : 'View Email'}
                        </Button>
                      </div>
                    </div>

                    {/* Expandable Preview */}
                    {isExpanded && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                        {mail.html ? (
                          <div
                            className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 max-h-96 overflow-y-auto"
                            dangerouslySetInnerHTML={{ __html: mail.html }}
                          />
                        ) : (
                          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">
                            {mail.body}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}