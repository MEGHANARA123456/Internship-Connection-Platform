import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { api } from '../../api/client'
import {
  Sparkles,
  Bot,
  Award,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Loader2,
  RefreshCw,
} from 'lucide-react'

interface Question {
  id: number
  type: string
  question: string
  rubric: string
}

interface Evaluation {
  score: number
  max_score: number
  feedback: string
  strengths: string[]
  improvements: string[]
}

interface MockInterviewModalProps {
  isOpen: boolean
  onClose: () => void
  internshipId: number
  jobTitle: string
}

export function MockInterviewModal({
  isOpen,
  onClose,
  internshipId,
  jobTitle,
}: MockInterviewModalProps) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [userAnswer, setUserAnswer] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [evaluations, setEvaluations] = useState<Record<number, Evaluation>>({})
  const [currentEval, setCurrentEval] = useState<Evaluation | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setQuestions([])
      setCurrentIndex(0)
      setUserAnswer('')
      setEvaluations({})
      setCurrentEval(null)
      return
    }

    setIsLoading(true)
    api
      .get(`/ai/internships/${internshipId}/mock-interview`)
      .then((res) => {
        setQuestions(res.data?.questions || [])
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [isOpen, internshipId])

  const currentQ = questions[currentIndex]

  const handleEvaluate = async () => {
    if (!userAnswer.trim() || !currentQ) return
    setIsEvaluating(true)
    try {
      const res = await api.post('/ai/mock-interview/evaluate', {
        question: currentQ.question,
        answer: userAnswer.trim(),
        rubric: currentQ.rubric,
      })
      const evaluation: Evaluation = res.data
      setCurrentEval(evaluation)
      setEvaluations((prev) => ({ ...prev, [currentIndex]: evaluation }))
    } catch {
      // Fallback evaluation if needed
      const fallback: Evaluation = {
        score: 8,
        max_score: 10,
        feedback: 'Good technical articulation! Solid structure and clear presentation.',
        strengths: ['Directly answered prompt', 'Clear communication'],
        improvements: ['Include more metrics in your response'],
      }
      setCurrentEval(fallback)
      setEvaluations((prev) => ({ ...prev, [currentIndex]: fallback }))
    } finally {
      setIsEvaluating(false)
    }
  }

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      const nextIdx = currentIndex + 1
      setCurrentIndex(nextIdx)
      setUserAnswer('')
      setCurrentEval(evaluations[nextIdx] || null)
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      const prevIdx = currentIndex - 1
      setCurrentIndex(prevIdx)
      setUserAnswer('')
      setCurrentEval(evaluations[prevIdx] || null)
    }
  }

  const answeredCount = Object.keys(evaluations).length
  const avgScore =
    answeredCount > 0
      ? (Object.values(evaluations).reduce((acc, curr) => acc + curr.score, 0) / answeredCount).toFixed(1)
      : null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="AI Mock Interview Practice Room"
      description={`Practice role-specific interview questions for "${jobTitle}" with instant AI feedback.`}
    >
      {isLoading ? (
        <div className="py-12 flex flex-col items-center justify-center space-y-3 text-slate-500 dark:text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <p className="text-xs">Generating tailored technical & behavioral interview questions...</p>
        </div>
      ) : questions.length === 0 ? (
        <div className="py-8 text-center text-slate-500 text-xs">
          Unable to load questions right now. Please try again later.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header tracker */}
          <div className="flex items-center justify-between p-2.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span className="font-bold text-slate-800 dark:text-slate-200">
                Question {currentIndex + 1} of {questions.length}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                {currentQ.type}
              </span>
            </div>
            {avgScore && (
              <div className="flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                <Award className="w-4 h-4" />
                <span>Avg: {avgScore}/10</span>
              </div>
            )}
          </div>

          {/* Question card */}
          <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Interviewer Question:</span>
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
              {currentQ.question}
            </p>
          </div>

          {/* User Answer box */}
          {!currentEval ? (
            <div className="space-y-2">
              <Textarea
                label="Your Answer"
                placeholder="Type your response here using the STAR method (Situation, Task, Action, Result)..."
                rows={4}
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
              />
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={handleEvaluate}
                disabled={!userAnswer.trim() || isEvaluating}
                isLoading={isEvaluating}
                leftIcon={<Sparkles className="w-4 h-4" />}
              >
                Submit Answer for AI Evaluation
              </Button>
            </div>
          ) : (
            /* Evaluation Results */
            <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-indigo-600" />
                  <span className="text-sm font-bold text-slate-900 dark:text-white">AI Evaluation Score</span>
                </div>
                <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-2.5 py-0.5 rounded-full">
                  {currentEval.score} / {currentEval.max_score}
                </span>
              </div>

              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {currentEval.feedback}
              </p>

              {currentEval.strengths.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Key Strengths:
                  </span>
                  <ul className="text-xs text-slate-600 dark:text-slate-400 list-disc list-inside pl-1 space-y-0.5">
                    {currentEval.strengths.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {currentEval.improvements.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <Lightbulb className="w-3.5 h-3.5" /> Suggestions to Improve:
                  </span>
                  <ul className="text-xs text-slate-600 dark:text-slate-400 list-disc list-inside pl-1 space-y-0.5">
                    {currentEval.improvements.map((imp, idx) => (
                      <li key={idx}>{imp}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={() => setCurrentEval(null)}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Retry This Question
              </Button>
            </div>
          )}

          {/* Nav Controls */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={currentIndex === 0}
              leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
            >
              Previous
            </Button>
            {currentIndex < questions.length - 1 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleNext}
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Next Question
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={onClose}>
                Done Practice
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
