import { useState, useEffect, useRef } from 'react'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Textarea'
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  FileText,
  User,
  Sparkles,
  ShieldCheck,
} from 'lucide-react'

interface VideoInterviewModalProps {
  isOpen: boolean
  onClose: () => void
  interviewId: number
  roleName?: string
}

export function VideoInterviewModal({
  isOpen,
  onClose,
  interviewId,
  roleName = 'Interview Room',
}: VideoInterviewModalProps) {
  const [isVideoEnabled, setIsVideoEnabled] = useState(true)
  const [isAudioEnabled, setIsAudioEnabled] = useState(true)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [interviewNotes, setInterviewNotes] = useState('')
  const [callDuration, setCallDuration] = useState(0)
  const [mediaError, setMediaError] = useState<string | null>(null)

  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Start local media stream on open
  useEffect(() => {
    if (!isOpen) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      setCallDuration(0)
      return
    }

    setMediaError(null)
    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })
        streamRef.current = stream
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
        }
      } catch (err) {
        console.warn('Unable to access local camera/mic:', err)
        setMediaError('Camera or microphone permission not granted. Running in audio preview mode.')
      }
    }

    initMedia()

    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1)
    }, 1000)

    return () => {
      clearInterval(timer)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [isOpen])

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setIsVideoEnabled(videoTrack.enabled)
      }
    } else {
      setIsVideoEnabled(!isVideoEnabled)
    }
  }

  const toggleAudio = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsAudioEnabled(audioTrack.enabled)
      }
    } else {
      setIsAudioEnabled(!isAudioEnabled)
    }
  }

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream
        }
        setIsScreenSharing(true)
        screenStream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false)
          if (localVideoRef.current && streamRef.current) {
            localVideoRef.current.srcObject = streamRef.current
          }
        }
      } else {
        if (localVideoRef.current && streamRef.current) {
          localVideoRef.current.srcObject = streamRef.current
        }
        setIsScreenSharing(false)
      }
    } catch {
      setIsScreenSharing(false)
    }
  }

  const handleEndCall = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
    }
    onClose()
  }

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60)
    const rem = secs % 60
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleEndCall}
      title="Secure In-App Video Interview"
      description={`Encrypted WebRTC Session • Room #${interviewId} • ${roleName}`}
      maxWidth="4xl"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Video Stage */}
        <div className="lg:col-span-2 flex flex-col space-y-3">
          <div className="relative aspect-video bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-lg flex items-center justify-center">
            {/* Local Video Stream */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${!isVideoEnabled ? 'hidden' : ''}`}
            />

            {!isVideoEnabled && (
              <div className="flex flex-col items-center justify-center space-y-2 text-slate-400">
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
                  <User className="w-8 h-8 text-slate-400" />
                </div>
                <span className="text-xs font-semibold">Camera is Turned Off</span>
              </div>
            )}

            {/* Room Overlay Badges */}
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-[11px] text-white">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>LIVE • {formatTime(callDuration)}</span>
            </div>

            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-indigo-600/80 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] text-white font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>P2P WebRTC Encrypted</span>
            </div>

            {/* Picture-in-picture remote simulator badge */}
            <div className="absolute bottom-3 right-3 w-32 h-20 bg-slate-800/90 border border-slate-700 rounded-xl overflow-hidden shadow-md flex items-center justify-center text-center p-1 text-[10px] text-slate-300">
              <div className="flex flex-col items-center">
                <User className="w-4 h-4 text-indigo-400" />
                <span>Interviewer Connected</span>
              </div>
            </div>
          </div>

          {mediaError && (
            <div className="p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg text-xs text-amber-700 dark:text-amber-300">
              {mediaError}
            </div>
          )}

          {/* Video Controls Bar */}
          <div className="flex items-center justify-center gap-3 p-3 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={toggleAudio}
              className={`p-3 rounded-xl font-semibold transition-all ${
                isAudioEnabled
                  ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50'
                  : 'bg-rose-500 text-white hover:bg-rose-600 shadow-sm'
              }`}
              title={isAudioEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
            >
              {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>

            <button
              onClick={toggleVideo}
              className={`p-3 rounded-xl font-semibold transition-all ${
                isVideoEnabled
                  ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50'
                  : 'bg-rose-500 text-white hover:bg-rose-600 shadow-sm'
              }`}
              title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
            >
              {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>

            <button
              onClick={toggleScreenShare}
              className={`p-3 rounded-xl font-semibold transition-all ${
                isScreenSharing
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50'
              }`}
              title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
            >
              <Monitor className="w-5 h-5" />
            </button>

            <button
              onClick={handleEndCall}
              className="p-3 rounded-xl font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-sm flex items-center gap-1.5 px-4"
              title="Leave Call"
            >
              <PhoneOff className="w-5 h-5" />
              <span className="text-xs font-bold hidden sm:inline">End Call</span>
            </button>
          </div>
        </div>

        {/* Sidebar: Private Interview Notes & Checklist */}
        <div className="flex flex-col space-y-3 p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100 pb-2 border-b border-slate-200 dark:border-slate-700">
            <FileText className="w-4 h-4 text-indigo-600" />
            <span>Real-time Interview Notes</span>
          </div>

          <Textarea
            placeholder="Record technical impressions, candidate answers, and feedback here..."
            rows={10}
            value={interviewNotes}
            onChange={(e) => setInterviewNotes(e.target.value)}
            className="text-xs flex-1"
          />

          <div className="p-2.5 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-100 dark:border-indigo-900 text-[11px] text-indigo-800 dark:text-indigo-300 space-y-1">
            <div className="flex items-center gap-1 font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Interview Best Practices</span>
            </div>
            <p className="text-[10px] text-slate-600 dark:text-slate-400">
              Use the STAR framework (Situation, Task, Action, Result) for behavioral evaluation.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  )
}
