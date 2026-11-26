export type InterviewCategory = 'HR' | 'TECHNICAL'
export type InterviewDifficulty = 'INTERMEDIATE'
export type InterviewSessionType = 'PRACTICE' | 'ASSESSMENT'
export type InterviewMode = 'TEXT' | 'VOICE' | 'VIDEO'
export type InterviewSessionStatus =
  | 'CREATED'
  | 'IN_PROGRESS'
  | 'EVALUATION_PENDING'
  | 'EVALUATION_FAILED'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'TERMINATED'
export type InterviewEvaluationStatus = 'PENDING' | 'EVALUATING' | 'COMPLETED' | 'FAILED'

export interface InterviewSession {
  id: number
  mock_test_id?: number | null
  mock_test_version?: number | null
  session_type: InterviewSessionType
  interview_mode: InterviewMode
  category: InterviewCategory
  difficulty: InterviewDifficulty
  question_count: number
  time_limit_seconds: number
  status: InterviewSessionStatus
  consent_acknowledged: boolean
  video_storage_consent: boolean
  proctoring_consent_acknowledged: boolean
  proctoring_max_violations: number
  retake_of_session_id: number | null
  created_at: string
  started_at: string | null
  expires_at: string | null
  completed_at: string | null
}

export interface InterviewQuestion {
  id: number
  position: number
  prompt: string
  hint: string | null
  is_follow_up: boolean
  answer_submitted: boolean
}

export interface InterviewSessionDetail {
  session: InterviewSession
  answered_question_count: number
}

export interface InterviewNextQuestion {
  session_status: InterviewSessionStatus
  question: InterviewQuestion | null
  question_limit_reached: boolean
}

export interface InterviewSessionCreate {
  session_type: InterviewSessionType
  category: InterviewCategory
  difficulty?: InterviewDifficulty
  question_count: 5 | 10
  interview_mode: InterviewMode
  consent_acknowledged: true
  video_storage_consent?: boolean
  retake_of_session_id?: number
}

export interface InterviewEvaluation {
  relevance: number | null
  technical_correctness: number | null
  completeness: number | null
  communication: number | null
  structure: number | null
  feedback: string
  strengths: string[]
  improvements: string[]
  score?: number | null
  suggested_answer?: string | null
}

export interface InterviewAnswerResult {
  answer_id: number
  evaluation_status: InterviewEvaluationStatus
  failure_code: string | null
  retry_after_seconds?: number | null
  evaluation: InterviewEvaluation | null
}

export interface InterviewAnswerRecord {
  answer_id: number
  question_id: number
  position: number
  answer_text: string
  submitted_at: string
  evaluation_status: InterviewEvaluationStatus
  failure_code: string | null
  evaluation: InterviewEvaluation | null
}

export interface InterviewEvaluationRetryResult {
  queued: number
  evaluated: number
  failed: number
}

export type InterviewProctoringEventType =
  | 'TAB_HIDDEN'
  | 'WINDOW_BLUR'
  | 'FULLSCREEN_EXIT'
  | 'COPY_ATTEMPT'
  | 'CUT_ATTEMPT'
  | 'PASTE_ATTEMPT'
  | 'CONTEXT_MENU'
  | 'DRAG_ATTEMPT'
  | 'DROP_ATTEMPT'
  | 'SHORTCUT_ATTEMPT'
  | 'FOCUS_RETURN'

export interface InterviewProctoringEventInput {
  event_type: InterviewProctoringEventType
  occurred_at: string
  question_index: number | null
  duration_away_ms: number | null
}

export interface InterviewProctoringEventResult {
  violation_count: number
  max_violations: number
  terminated: boolean
}

export interface InterviewProctoringSummary {
  violation_count: number
  types: Record<string, number>
  total_time_away_ms: number
}

export interface InterviewAnswerReview {
  question_id: number
  position: number
  prompt: string
  answer_text: string
  skill_tags?: string[]
  evaluation_status: InterviewEvaluationStatus
  failure_code: string | null
  evaluation: InterviewEvaluation | null
  duration_seconds: number | null
  word_count: number | null
  speaking_pace_wpm: number | null
  filler_word_count: number | null
}

export interface InterviewVoiceMetrics {
  total_duration_seconds: number
  total_word_count: number
  average_speaking_pace_wpm: number | null
  total_filler_word_count: number
}

export interface InterviewVideoMetrics {
  session_duration_seconds: number
}

export interface InterviewVideoConsent {
  acknowledged: boolean
  consent_version: string
  acknowledged_at: string | null
}

export interface InterviewVideoRecording {
  id: number
  status:
    | 'UPLOADING'
    | 'PENDING_UPLOAD'
    | 'AVAILABLE'
    | 'PENDING_DELETE'
    | 'DELETED'
    | 'EXPIRED'
    | 'FAILED'
  finalized: boolean
  source_type: 'mock' | 'real'
  retryable: boolean
  mime_type: string
  chunk_count: number
  next_chunk_index: number
  total_bytes: number
  duration_seconds: number | null
  retention_expires_at: string
  created_at: string
  error_code: string | null
}

export interface InterviewVideoRecordingState {
  required_consent_version: string
  video_storage_consent: boolean
  retention_days: number
  storage_backend: 'local' | 'gdrive'
  consent: InterviewVideoConsent | null
  recording: InterviewVideoRecording | null
  recordings: InterviewVideoRecording[]
}

export interface InterviewVideoPolicy {
  retention_days: number
  storage_backend: 'local' | 'gdrive'
}

export interface InterviewAudioTranscript {
  transcript: string
  duration_seconds: number
  duration_token: string
}

export interface InterviewReport {
  session_id: number
  status: InterviewEvaluationStatus
  overall_score: number | null
  rubric_scores: Record<string, number> | null
  answer_count: number
  summary: string | null
  top_strengths?: string[]
  top_improvements?: string[]
  next_steps?: string[]
  failure_code: string | null
  retry_after_seconds?: number | null
  evaluations: InterviewAnswerReview[]
  skill_breakdown?: Record<string, number> | null
  voice_metrics: InterviewVoiceMetrics | null
  video_metrics?: InterviewVideoMetrics | null
  proctoring_summary: InterviewProctoringSummary
}

export type MockTestFormat = 'QUICK_PRACTICE' | 'STANDARD' | 'FULL' | 'TOPIC_WISE'

export interface MockTestAttempt {
  session_id: number
  test_version: number
  session_type: InterviewSessionType
  interview_mode: InterviewMode
  status: InterviewSessionStatus
  created_at: string
  completed_at: string | null
  overall_score: number | null
  skill_breakdown: Record<string, number> | null
}

export interface MockTest {
  id: number
  slug: string
  title: string
  description: string
  category: string
  difficulty: InterviewDifficulty
  format: MockTestFormat
  default_mode: InterviewSessionType
  question_count: number
  time_limit_seconds: number
  estimated_duration_minutes: number
  skill_tags: string[]
  company_style: boolean
  version: number
  attempt_count: number
  completed_attempt_count: number
  latest_score: number | null
  latest_status: InterviewSessionStatus | null
  attempts: MockTestAttempt[]
}

export interface MockTestDetail {
  id: number
  title: string
  description: string
  category: string
  difficulty: InterviewDifficulty
  default_mode: InterviewSessionType
  question_count: number
  time_limit_seconds: number
  estimated_duration_minutes: number
  version: number
}

export interface MockTestComparison {
  mock_test_id: number
  test_version: number
  attempts: MockTestAttempt[]
}

export interface MockTestRecommendation {
  weakest_skill: string | null
  recommended_test: MockTestDetail | null
}
