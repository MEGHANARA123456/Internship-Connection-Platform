import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { CheckCircle2, Award, Sparkles, AlertCircle } from 'lucide-react'

interface Question {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

interface SkillTopic {
  id: string
  name: string
  icon: string
  badgeTitle: string
  questions: Question[]
}

const TOPICS: SkillTopic[] = [
  {
    id: 'python',
    name: 'Python & Backend Architecture',
    icon: '🐍',
    badgeTitle: 'Verified Python Specialist',
    questions: [
      {
        question: 'What is the primary benefit of Python asyncio event loops in backend APIs?',
        options: [
          'It runs code faster by using multiple CPU cores directly',
          'It allows concurrent I/O operations without multi-threading overhead',
          'It compiles Python to machine code ahead of time',
          'It replaces the need for database indexing',
        ],
        correctIndex: 1,
        explanation: 'Asyncio enables non-blocking asynchronous I/O concurrency on a single thread.',
      },
      {
        question: 'In FastAPI, what does Depends() provide?',
        options: [
          'Automated database migrations',
          'A declarative dependency injection system for request handlers',
          'CSS style preprocessing',
          'WebSocket keepalive heartbeats',
        ],
        correctIndex: 1,
        explanation: 'Depends() allows clean dependency injection of database sessions, auth, and services.',
      },
      {
        question: 'Which HTTP status code signifies that a resource was successfully created?',
        options: ['200 OK', '201 Created', '204 No Content', '301 Moved'],
        correctIndex: 1,
        explanation: 'HTTP 201 Created is the standard response code for successful POST creation.',
      },
      {
        question: 'What is the purpose of Pydantic models in modern Python APIs?',
        options: [
          'Render HTML templates to the browser',
          'Type validation, serialization, and schema definition',
          'Compress binary PDF files',
          'Execute raw SQL migrations',
        ],
        correctIndex: 1,
        explanation: 'Pydantic handles runtime data validation, parsing, and serialization.',
      },
      {
        question: 'How does connection pooling improve database performance?',
        options: [
          'It caches all table rows into system RAM permanently',
          'It reuses existing open database connections instead of reopening TCP handshakes',
          'It removes the need for primary keys',
          'It bypasses SQL query planning',
        ],
        correctIndex: 1,
        explanation: 'Connection pooling reuses established connections, eliminating expensive handshake overhead.',
      },
    ],
  },
  {
    id: 'react',
    name: 'React & Modern Frontend',
    icon: '⚛️',
    badgeTitle: 'Verified React Pro',
    questions: [
      {
        question: 'What is the primary rule when using React Hooks like useState and useEffect?',
        options: [
          'They must be called inside loops or conditional if statements',
          'They must only be called at the top level of function components',
          'They can only be used in class components',
          'They must return a Promise',
        ],
        correctIndex: 1,
        explanation: 'Hooks must always be called at the top level to ensure deterministic call ordering across renders.',
      },
      {
        question: 'Why is the "key" prop critical when rendering dynamic lists in React?',
        options: [
          'It provides CSS classes to each item',
          'It allows React virtual DOM diffing to identify which items have changed, moved, or deleted',
          'It automatically encrypts the rendered data',
          'It triggers garbage collection on unmounted nodes',
        ],
        correctIndex: 1,
        explanation: 'Keys give elements a stable identity for React reconciliation.',
      },
      {
        question: 'What does the useCallback hook return?',
        options: [
          'A memoized callback function instance that only updates when dependencies change',
          'The resolved result value of an async network call',
          'A ref to an underlying DOM node',
          'A dispatch action for Redux store',
        ],
        correctIndex: 0,
        explanation: 'useCallback memoizes function definitions between re-renders.',
      },
      {
        question: 'What is the purpose of React Error Boundaries?',
        options: [
          'Catch syntax errors during Vite compilation',
          'Catch JavaScript runtime errors anywhere in the child component tree and display a fallback UI',
          'Prevent users from submitting invalid forms',
          'Encrypt local storage keys',
        ],
        correctIndex: 1,
        explanation: 'Error Boundaries gracefully catch errors in the render tree without crashing the entire app.',
      },
      {
        question: 'In Tailwind CSS, how is dark mode typically activated?',
        options: [
          'By creating separate .dark.css stylesheet files',
          'By using the "dark:" variant applied when a parent or root element has the "dark" class',
          'By changing the browser OS locale',
          'By using inline CSS !important flags',
        ],
        correctIndex: 1,
        explanation: 'Tailwind dark variant activates styles when the .dark class is on the html/root element.',
      },
    ],
  },
  {
    id: 'sql',
    name: 'SQL & Database Design',
    icon: '🗄️',
    badgeTitle: 'Verified SQL Specialist',
    questions: [
      {
        question: 'What does an ACID-compliant database guarantee?',
        options: [
          'Atomicity, Consistency, Isolation, and Durability of transactions',
          'Automatic Cloud Index Distribution',
          'Async Connection Interface Delivery',
          'All Queries In Data',
        ],
        correctIndex: 0,
        explanation: 'ACID guarantees reliable processing of database transactions.',
      },
      {
        question: 'What is the main benefit of a B-Tree index on a foreign key column?',
        options: [
          'Decreases storage space required on disk',
          'Accelerates JOIN queries and equality searches from O(N) full table scans to O(log N)',
          'Automatically deletes orphaned child rows',
          'Encrypts column values at rest',
        ],
        correctIndex: 1,
        explanation: 'Indexes speed up lookups and joins from full sequential scans to logarithmic tree searches.',
      },
      {
        question: 'What is the difference between WHERE and HAVING in SQL?',
        options: [
          'WHERE filters rows before aggregation; HAVING filters aggregate groups after GROUP BY',
          'HAVING is only used in SQLite; WHERE is used in PostgreSQL',
          'WHERE is for strings; HAVING is for numeric values',
          'There is no difference between them',
        ],
        correctIndex: 0,
        explanation: 'WHERE filters individual records; HAVING filters aggregated groups.',
      },
      {
        question: 'In PostgreSQL, what is the best datatype to store unique UUIDs or timestamps with timezone?',
        options: [
          'VARCHAR(255) and INT',
          'UUID and TIMESTAMPTZ',
          'BLOB and TEXT',
          'CHAR(10) and DATE',
        ],
        correctIndex: 1,
        explanation: 'UUID and TIMESTAMPTZ provide native binary efficiency and timezone correctness.',
      },
      {
        question: 'What does a database migration tool (like Alembic) do?',
        options: [
          'Moves files from frontend to backend',
          'Tracks, applies, and rolls back versioned incremental schema changes reliably',
          'Converts SQL tables into MongoDB documents automatically',
          'Compresses images before storing in S3',
        ],
        correctIndex: 1,
        explanation: 'Migration frameworks track and version database schema evolutions over time.',
      },
    ],
  },
]

interface SkillQuizModalProps {
  isOpen: boolean
  onClose: () => void
  onBadgeAwarded: (badge: { topicId: string; title: string; score: number; date: string }) => void
}

export function SkillQuizModal({ isOpen, onClose, onBadgeAwarded }: SkillQuizModalProps) {
  const [selectedTopic, setSelectedTopic] = useState<SkillTopic | null>(null)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([])
  const [isFinished, setIsFinished] = useState(false)
  const [score, setScore] = useState(0)

  const handleStartTopic = (topic: SkillTopic) => {
    setSelectedTopic(topic)
    setCurrentQuestionIndex(0)
    setSelectedAnswers([])
    setIsFinished(false)
    setScore(0)
  }

  const handleSelectAnswer = (index: number) => {
    const updated = [...selectedAnswers]
    updated[currentQuestionIndex] = index
    setSelectedAnswers(updated)
  }

  const handleNextQuestion = () => {
    if (!selectedTopic) return
    if (currentQuestionIndex < selectedTopic.questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1)
    } else {
      // Calculate score
      let correct = 0
      selectedTopic.questions.forEach((q, idx) => {
        if (selectedAnswers[idx] === q.correctIndex) {
          correct += 1
        }
      })
      const finalScore = Math.round((correct / selectedTopic.questions.length) * 100)
      setScore(finalScore)
      setIsFinished(true)

      if (finalScore >= 80) {
        onBadgeAwarded({
          topicId: selectedTopic.id,
          title: selectedTopic.badgeTitle,
          score: finalScore,
          date: new Date().toLocaleDateString(),
        })
      }
    }
  }

  const handleReset = () => {
    setSelectedTopic(null)
    setCurrentQuestionIndex(0)
    setSelectedAnswers([])
    setIsFinished(false)
    setScore(0)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Verified Skill Assessment"
      description="Score 80% or higher to earn an official verified badge visible to recruiters."
      maxWidth="lg"
    >
      {!selectedTopic ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Choose a domain below to take a timed 5-question knowledge quiz. Verified badges are displayed on your profile and increase application visibility.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TOPICS.map((topic) => (
              <button
                key={topic.id}
                onClick={() => handleStartTopic(topic)}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 bg-slate-50/50 dark:bg-slate-800/50 text-left transition-all hover:shadow-md cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <span className="text-2xl mb-2 block">{topic.icon}</span>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">{topic.name}</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">5 Questions • Pass 80%</p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">Start Quiz →</span>
                  <Award className="w-3.5 h-3.5 text-indigo-500" />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : !isFinished ? (
        <div className="space-y-4">
          {/* Quiz Header */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <span>{selectedTopic.icon}</span>
              {selectedTopic.name}
            </span>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Question {currentQuestionIndex + 1} of {selectedTopic.questions.length}
            </span>
          </div>

          {/* Question Text */}
          <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/60">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              {selectedTopic.questions[currentQuestionIndex].question}
            </p>
          </div>

          {/* Options */}
          <div className="space-y-2">
            {selectedTopic.questions[currentQuestionIndex].options.map((opt, idx) => {
              const isSelected = selectedAnswers[currentQuestionIndex] === idx
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectAnswer(idx)}
                  className={`w-full p-3 text-left text-xs rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-medium'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span>{opt}</span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0 ml-2" />}
                </button>
              )
            })}
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button size="sm" variant="ghost" onClick={handleReset}>
              Quit
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={selectedAnswers[currentQuestionIndex] === undefined}
              onClick={handleNextQuestion}
            >
              {currentQuestionIndex < selectedTopic.questions.length - 1 ? 'Next Question →' : 'Finish & Submit'}
            </Button>
          </div>
        </div>
      ) : (
        /* Results View */
        <div className="text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400">
            {score >= 80 ? <Award className="w-8 h-8" /> : <AlertCircle className="w-8 h-8" />}
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {score >= 80 ? 'Congratulations! Quiz Passed' : 'Assessment Completed'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              You scored <strong className="text-slate-900 dark:text-white">{score}%</strong> on {selectedTopic.name}.
            </p>
          </div>

          {score >= 80 ? (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl max-w-sm mx-auto space-y-1">
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                Badge Earned: {selectedTopic.badgeTitle}
              </span>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                This verified credential is now permanently featured on your candidate profile.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              A passing score of 80% is required to earn the verified badge. You can review the concepts and retake the assessment anytime.
            </p>
          )}

          <div className="pt-2 flex justify-center gap-2">
            <Button size="sm" variant="outline" onClick={handleReset}>
              Take Another Quiz
            </Button>
            <Button size="sm" variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
