import { api } from '../api/client'
import type {
  InterviewAnswerResult,
  InterviewAnswerRecord,
  InterviewEvaluationRetryResult,
  InterviewAudioTranscript,
  InterviewNextQuestion,
  InterviewReport,
  InterviewProctoringEventInput,
  InterviewProctoringEventResult,
  InterviewSession,
  InterviewSessionCreate,
  InterviewSessionDetail,
  InterviewVideoRecording,
  InterviewVideoRecordingState,
  InterviewVideoPolicy,
  MockTest,
  MockTestDetail,
  MockTestAttempt,
  MockTestComparison,
  MockTestFormat,
  MockTestRecommendation,
} from '../types/interview'

const sessionsPath = '/interviews/sessions'

export interface InterviewProviderAvailability {
  available: boolean
  retry_after_seconds: number | null
}

export async function getInterviewProviderAvailability(): Promise<InterviewProviderAvailability> {
  const { data } = await api.get<InterviewProviderAvailability>('/interviews/provider-status')
  return data
}

export async function createInterviewSession(input: InterviewSessionCreate): Promise<InterviewSession> {
  const { data } = await api.post<InterviewSession>(sessionsPath, input)
  return data
}

export async function listInterviewSessions(): Promise<InterviewSession[]> {
  const { data } = await api.get<InterviewSession[]>(sessionsPath)
  return data
}

export async function getInterviewSession(sessionId: number): Promise<InterviewSessionDetail> {
  const { data } = await api.get<InterviewSessionDetail>(`${sessionsPath}/${sessionId}`)
  return data
}

export async function getInterviewAnswers(sessionId: number): Promise<InterviewAnswerRecord[]> {
  const { data } = await api.get<InterviewAnswerRecord[]>(`${sessionsPath}/${sessionId}/answers`)
  return data
}

export async function acknowledgeInterviewProctoringConsent(sessionId: number): Promise<void> {
  await api.post(`${sessionsPath}/${sessionId}/proctoring-consent`)
}

export async function recordInterviewProctoringEvent(
  sessionId: number,
  event: InterviewProctoringEventInput,
): Promise<InterviewProctoringEventResult> {
  const { data } = await api.post<InterviewProctoringEventResult>(
    `${sessionsPath}/${sessionId}/proctoring-events`,
    event,
  )
  return data
}

export async function startInterviewSession(sessionId: number): Promise<InterviewSession> {
  const { data } = await api.post<InterviewSession>(`${sessionsPath}/${sessionId}/start`)
  return data
}

export async function getNextInterviewQuestion(sessionId: number): Promise<InterviewNextQuestion> {
  const { data } = await api.post<InterviewNextQuestion>(`${sessionsPath}/${sessionId}/next-question`)
  return data
}

export async function submitInterviewAnswer(
  sessionId: number,
  questionId: number,
  answerText: string,
  audioDurationToken?: string | null,
): Promise<InterviewAnswerResult> {
  const { data } = await api.post<InterviewAnswerResult>(`${sessionsPath}/${sessionId}/answers`, {
    question_id: questionId,
    answer_text: answerText,
    ...(audioDurationToken ? { audio_duration_token: audioDurationToken } : {}),
  })
  return data
}

export async function transcribeInterviewAudio(
  sessionId: number,
  questionId: number,
  audio: Blob,
): Promise<InterviewAudioTranscript> {
  const formData = new FormData()
  formData.append('question_id', String(questionId))
  formData.append('audio', audio, `interview-answer.${audio.type.split('/')[1]?.split(';')[0] || 'webm'}`)
  const { data } = await api.post<InterviewAudioTranscript>(
    `${sessionsPath}/${sessionId}/audio`,
    formData,
  )
  return data
}

export async function getInterviewVideoRecordingState(
  sessionId: number,
): Promise<InterviewVideoRecordingState> {
  const { data } = await api.get<InterviewVideoRecordingState>(
    `${sessionsPath}/${sessionId}/recordings`,
  )
  return data
}

export async function getInterviewVideoRecordingPolicy(): Promise<InterviewVideoPolicy> {
  const { data } = await api.get<InterviewVideoPolicy>('/interviews/video-recording-policy')
  return data
}

export async function acknowledgeInterviewVideoRecordingConsent(
  sessionId: number,
  consentVersion: string,
): Promise<void> {
  await api.post(`${sessionsPath}/${sessionId}/recordings/consent`, {
    acknowledged: true,
    consent_version: consentVersion,
  })
}

export async function setInterviewVideoStorageConsent(
  sessionId: number,
  acknowledged: boolean,
): Promise<void> {
  await api.put(`${sessionsPath}/${sessionId}/recordings/storage-consent`, {
    acknowledged,
  })
}

export async function createInterviewVideoRecording(
  sessionId: number,
): Promise<InterviewVideoRecording> {
  const { data } = await api.post<InterviewVideoRecording>(
    `${sessionsPath}/${sessionId}/recordings`,
  )
  return data
}

export async function uploadInterviewVideoChunk(
  sessionId: number,
  recordingId: number,
  chunkIndex: number,
  chunk: Blob,
): Promise<{ recording_id: number; next_chunk_index: number }> {
  const formData = new FormData()
  formData.append('chunk_index', String(chunkIndex))
  formData.append('chunk', chunk, `interview-video-chunk.${chunk.type.split('/')[1]?.split(';')[0] || 'webm'}`)
  const { data } = await api.post(
    `${sessionsPath}/${sessionId}/recordings/${recordingId}/chunks`,
    formData,
  )
  return data
}

export async function finalizeInterviewVideoRecording(
  sessionId: number,
  recordingId: number,
): Promise<InterviewVideoRecording> {
  const { data } = await api.post<InterviewVideoRecording>(
    `${sessionsPath}/${sessionId}/recordings/${recordingId}/finalize`,
  )
  return data
}

export async function getInterviewVideoRecording(
  sessionId: number,
  recordingId: number,
): Promise<Blob> {
  const { data } = await api.get<Blob>(
    `${sessionsPath}/${sessionId}/recordings/${recordingId}/content`,
    { responseType: 'blob' },
  )
  return data
}

export async function deleteInterviewVideoRecording(
  sessionId: number,
  recordingId: number,
): Promise<void> {
  await api.delete(`${sessionsPath}/${sessionId}/recordings/${recordingId}`)
}

export async function retryInterviewVideoRecording(
  sessionId: number,
  recordingId: number,
): Promise<InterviewVideoRecording> {
  const { data } = await api.post<InterviewVideoRecording>(
    `${sessionsPath}/${sessionId}/recordings/${recordingId}/retry`,
  )
  return data
}

export async function completeInterviewSession(sessionId: number): Promise<InterviewReport> {
  const { data } = await api.post<InterviewReport>(`${sessionsPath}/${sessionId}/complete`)
  return data
}

export async function getInterviewReport(sessionId: number): Promise<InterviewReport> {
  const { data } = await api.get<InterviewReport>(`${sessionsPath}/${sessionId}/report`)
  return data
}

export async function retryInterviewEvaluation(
  sessionId: number,
): Promise<InterviewEvaluationRetryResult> {
  const { data } = await api.post<InterviewEvaluationRetryResult>(
    `${sessionsPath}/${sessionId}/evaluation/retry`,
  )
  return data
}

export async function deleteInterviewSession(sessionId: number): Promise<void> {
  await api.delete(`${sessionsPath}/${sessionId}`)
}

export async function listMockTests(filters: {
  category?: string
  format?: MockTestFormat
} = {}): Promise<MockTest[]> {
  const { data } = await api.get<MockTest[]>('/interviews/mock-tests', { params: filters })
  return data
}

export async function getMockTest(testId: number): Promise<MockTestDetail> {
  const { data } = await api.get<MockTestDetail>(`/interviews/mock-tests/${testId}`)
  return data
}

export async function createMockTestAttempt(
  testId: number,
  input: {
    session_type: 'PRACTICE' | 'ASSESSMENT'
    interview_mode: 'TEXT' | 'VOICE' | 'VIDEO'
    consent_acknowledged: true
    video_storage_consent?: boolean
    retake_of_session_id?: number
  },
): Promise<InterviewSession> {
  const { data } = await api.post<InterviewSession>(
    `/interviews/mock-tests/${testId}/attempts`,
    input,
  )
  return data
}

export async function listMockTestAttempts(testId: number): Promise<MockTestAttempt[]> {
  const { data } = await api.get<MockTestAttempt[]>(
    `/interviews/mock-tests/${testId}/attempts`,
  )
  return data
}

export async function compareMockTestAttempts(
  testId: number,
  attemptIds: number[],
): Promise<MockTestComparison> {
  const { data } = await api.post<MockTestComparison>(
    `/interviews/mock-tests/${testId}/compare`,
    { attempt_ids: attemptIds },
  )
  return data
}

export async function getMockTestRecommendation(): Promise<MockTestRecommendation> {
  const { data } = await api.get<MockTestRecommendation>(
    '/interviews/mock-tests/recommendation',
  )
  return data
}
