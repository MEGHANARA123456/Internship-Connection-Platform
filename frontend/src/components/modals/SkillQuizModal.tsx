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
  {
    id: 'dsa',
    name: 'Data Structures & Algorithms',
    icon: '⚡',
    badgeTitle: 'Verified DSA Problem Solver',
    questions: [
      {
        question: 'What is the average time complexity of searching in a balanced Binary Search Tree (AVL or Red-Black)?',
        options: ['O(1)', 'O(log N)', 'O(N)', 'O(N log N)'],
        correctIndex: 1,
        explanation: 'Balanced BSTs maintain logarithmic height, guaranteeing O(log N) search, insertion, and deletion.',
      },
      {
        question: 'Which data structure operates on a Last-In, First-Out (LIFO) order and powers function recursion calls?',
        options: ['Queue', 'Stack', 'Linked List', 'Max-Heap'],
        correctIndex: 1,
        explanation: 'A Stack enforces LIFO ordering and manages execution frames during function calls.',
      },
      {
        question: 'What is the primary characteristic of Dijkstra’s graph algorithm?',
        options: [
          'Finds minimum spanning trees for disconnected graphs',
          'Finds shortest paths from a single source node to all other nodes in a non-negative weighted graph',
          'Detects cycles in directed bipartite graphs',
          'Sorts nodes topologically in O(1) time',
        ],
        correctIndex: 1,
        explanation: 'Dijkstra computes single-source shortest path paths using a priority queue greedy strategy.',
      },
      {
        question: 'What is linear probing in hash tables?',
        options: [
          'A sorting technique for hash values',
          'An open-addressing collision resolution method that checks consecutive adjacent slots sequentially',
          'A cryptographic hash digest verification',
          'A garbage collection sweep',
        ],
        correctIndex: 1,
        explanation: 'Linear probing resolves bucket hash collisions by stepping linearly through succeeding array slots.',
      },
      {
        question: 'When finding the median of a continuous stream of numbers, which structure combination is optimal?',
        options: [
          'Two balanced binary search trees',
          'A Max-Heap for the smaller half and a Min-Heap for the larger half',
          'A circular doubly-linked list',
          'A single static array with quicksort on every insert',
        ],
        correctIndex: 1,
        explanation: 'Dual heaps (Max-Heap + Min-Heap) provide O(1) median retrieval and O(log N) insertion.',
      },
    ],
  },
  {
    id: 'ai',
    name: 'Machine Learning & AI Engineering',
    icon: '🤖',
    badgeTitle: 'Verified AI/ML Engineer',
    questions: [
      {
        question: 'What is the primary role of a loss function during neural network training?',
        options: [
          'Compressing weights for mobile deployment',
          'Quantifying the difference between predictions and actual targets to guide gradient backpropagation',
          'Formatting CSV datasets into image tensors',
          'Preventing GPU memory exhaustion',
        ],
        correctIndex: 1,
        explanation: 'The loss function computes error penalty, allowing optimizers to compute gradients via backprop.',
      },
      {
        question: 'What core mechanism enables Transformer architectures to model long-range token relationships without recurrence?',
        options: [
          'Convolutional pooling layers',
          'Multi-Head Self-Attention mechanisms',
          'Dropout regularization',
          'Batch normalization layers',
        ],
        correctIndex: 1,
        explanation: 'Self-attention calculates pairwise affinity scores between all tokens regardless of sequence distance.',
      },
      {
        question: 'What does "overfitting" mean in machine learning?',
        options: [
          'The model trains too slowly due to low learning rates',
          'The model memorizes training noise and fails to generalize effectively to unseen test data',
          'The model lacks sufficient parameters to capture patterns',
          'The dataset contains too few features',
        ],
        correctIndex: 1,
        explanation: 'Overfitting occurs when high-capacity models fit training quirks rather than true underlying distributions.',
      },
      {
        question: 'In Retrieval-Augmented Generation (RAG), why are vector embeddings used?',
        options: [
          'To convert text documents into dense numerical vectors for semantic similarity searches',
          'To replace SQL databases entirely',
          'To encrypt user prompts on the frontend',
          'To spell-check user questions',
        ],
        correctIndex: 0,
        explanation: 'Embeddings map textual context into vector space, enabling cosine similarity retrieval.',
      },
      {
        question: 'Which popular deep learning optimizer combines momentum with adaptive per-parameter learning rates?',
        options: ['SGD without momentum', 'Adam (Adaptive Moment Estimation)', 'K-Means', 'Adagrad Fixed'],
        correctIndex: 1,
        explanation: 'Adam combines first and second moment moving averages for robust optimization.',
      },
    ],
  },
  {
    id: 'devops',
    name: 'Cloud, Docker & DevOps',
    icon: '☁️',
    badgeTitle: 'Verified Cloud & DevOps Specialist',
    questions: [
      {
        question: 'What is the key benefit of multi-stage Docker builds?',
        options: [
          'Allows running multiple operating systems simultaneously',
          'Minimizes final production image size by discarding build tools, compilers, and intermediate layers',
          'Replaces Kubernetes orchestration entirely',
          'Encrypts container root filesystems',
        ],
        correctIndex: 1,
        explanation: 'Multi-stage builds leave compilation SDKs and temporary dependencies behind, producing lean production images.',
      },
      {
        question: 'In Kubernetes, what is the smallest deployable unit of execution?',
        options: ['Node', 'Pod', 'Cluster', 'Namespace'],
        correctIndex: 1,
        explanation: 'A Pod represents a single instance of a running process in a Kubernetes cluster.',
      },
      {
        question: 'What is the primary benefit of Infrastructure as Code (IaC) tools like Terraform?',
        options: [
          'Writing frontend React components in YAML',
          'Declarative, automated, version-controlled provisioning of repeatable cloud infrastructure',
          'Direct live hot-reloading of Python code',
          'Replacing relational database tables',
        ],
        correctIndex: 1,
        explanation: 'IaC allows infrastructure to be codified, reviewed, tested, and reproducibly created across environments.',
      },
      {
        question: 'What is the role of an edge reverse proxy (such as NGINX or Envoy)?',
        options: [
          'Compiling TypeScript code to WebAssembly',
          'Handling SSL/TLS termination, request routing, rate limiting, and load balancing',
          'Serving as the primary relational database',
          'Executing cron jobs inside containers',
        ],
        correctIndex: 1,
        explanation: 'Reverse proxies act as intermediaries providing TLS offloading, security filtering, and load distribution.',
      },
      {
        question: 'In CI/CD, what distinguishes Continuous Deployment from Continuous Delivery?',
        options: [
          'Continuous Deployment automatically deploys validated changes straight to production without manual gate approval',
          'Continuous Delivery is only used for mobile apps',
          'Continuous Deployment does not run automated tests',
          'There is no functional distinction',
        ],
        correctIndex: 0,
        explanation: 'Continuous Deployment automates the entire pipeline through production release without human gates.',
      },
    ],
  },
  {
    id: 'security',
    name: 'Web Security & System Design',
    icon: '🛡️',
    badgeTitle: 'Verified Security & Systems Pro',
    questions: [
      {
        question: 'How do Cross-Site Scripting (XSS) attacks compromise web clients?',
        options: [
          'By overwhelming network bandwidth with DDoS packets',
          'By executing attacker-injected malicious JavaScript scripts inside the browser context of unsuspecting users',
          'By brute-forcing SSH keys on the server',
          'By intercepting wireless radio frequencies',
        ],
        correctIndex: 1,
        explanation: 'XSS exploits unescaped or unvalidated user input to execute scripts in the victim browser.',
      },
      {
        question: 'Why must user passwords always be hashed with a unique salt using bcrypt, Argon2, or PBKDF2?',
        options: [
          'To make passwords shorter for database indexing',
          'To defeat rainbow table lookups and dramatically slow down offline brute-force hardware cracking',
          'To allow symmetric two-way password decryption by admins',
          'To satisfy HTML form constraints',
        ],
        correctIndex: 1,
        explanation: 'Salting prevents identical hash values for common passwords; slow key-derivation protects against GPU attacks.',
      },
      {
        question: 'What does the CAP Theorem state for distributed database systems?',
        options: [
          'Systems can provide Consistency, Availability, and Partition Tolerance simultaneously',
          'In the event of a network partition, a distributed system can guarantee at most Consistency OR Availability',
          'Databases must always use ACID transactions',
          'Caching always guarantees eventual consistency',
        ],
        correctIndex: 1,
        explanation: 'CAP states that under network partitions (P), distributed nodes must choose between Consistency (C) and Availability (A).',
      },
      {
        question: 'Which cookie attribute provides strong built-in browser protection against Cross-Site Request Forgery (CSRF)?',
        options: ['Path=/', 'SameSite=Lax or SameSite=Strict', 'Expires=Session', 'Domain=.com'],
        correctIndex: 1,
        explanation: 'The SameSite cookie flag prevents cookies from being sent on cross-site state-changing HTTP requests.',
      },
      {
        question: 'What is the purpose of the Circuit Breaker pattern in microservices?',
        options: [
          'Terminates idle TCP connections after 60 seconds',
          'Fails fast when downstream services become degraded or unresponsive, preventing cascading catastrophic failures',
          'Encrypts inter-service gRPC payloads',
          'Automatically restarts dead Docker containers',
        ],
        correctIndex: 1,
        explanation: 'Circuit breakers stop calling failing downstream dependencies, allowing them to recover without cascading exhaustion.',
      },
    ],
  },
  {
    id: 'typescript',
    name: 'JavaScript & TypeScript Mastery',
    icon: '📜',
    badgeTitle: 'Verified TypeScript Specialist',
    questions: [
      {
        question: 'What is the difference between "unknown" and "any" in TypeScript?',
        options: [
          '"unknown" is type-safe because properties cannot be accessed without narrowing or explicit type guards first',
          '"any" throws compiler errors when assigned to string',
          '"unknown" can only hold null or undefined',
          'They are identical aliases in TypeScript',
        ],
        correctIndex: 0,
        explanation: '"unknown" forces developers to narrow types safely before invoking methods or reading properties.',
      },
      {
        question: 'In the JavaScript runtime, what role does the Event Loop play?',
        options: [
          'Compiles V8 bytecode into ARM instructions',
          'Monitors the Call Stack and moves callbacks from Microtask/Macrotask queues when the stack is empty',
          'Manages CSS layout calculations in the DOM tree',
          'Creates background Web Workers for every async function',
        ],
        correctIndex: 1,
        explanation: 'The Event Loop coordinates asynchronous non-blocking task execution on the single JavaScript thread.',
      },
      {
        question: 'What is a Discriminated Union in TypeScript?',
        options: [
          'A union type where each member shares a common literal property used by the compiler for exhaustiveness checking',
          'A union of conflicting primitive types like string and number',
          'A union that cannot be exported from a module',
          'A deprecated TypeScript 1.0 feature',
        ],
        correctIndex: 0,
        explanation: 'Discriminated unions use literal tag properties (e.g. status: "success" | "error") for pattern matching.',
      },
      {
        question: 'What is a JavaScript closure?',
        options: [
          'A method to close browser tabs programmatically',
          'A function that retains lexical scope access to variables in its enclosing outer scope even after the outer function returns',
          'A syntax error in arrow functions',
          'An immutable object frozen with Object.freeze()',
        ],
        correctIndex: 1,
        explanation: 'Closures bundle a function with references to its surrounding lexical state.',
      },
      {
        question: 'What does Promise.allSettled() guarantee compared to Promise.all()?',
        options: [
          'It rejects immediately on the first failure',
          'It waits for all promises to either resolve or reject, returning an array of all individual outcomes',
          'It executes promises sequentially instead of in parallel',
          'It cancels remaining promises if one is slow',
        ],
        correctIndex: 1,
        explanation: 'Promise.allSettled never short-circuits on rejection, returning status and value/reason for every input promise.',
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
      maxWidth="2xl"
    >
      {!selectedTopic ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Choose a technical domain below to take a timed 5-question knowledge quiz. Verified badges are displayed on your profile and increase application visibility.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto p-1">
            {TOPICS.map((topic) => (
              <button
                key={topic.id}
                onClick={() => handleStartTopic(topic)}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 bg-slate-50/50 dark:bg-slate-800/50 text-left transition-all hover:shadow-md cursor-pointer flex flex-col justify-between group"
              >
                <div>
                  <span className="text-2xl mb-1.5 block">{topic.icon}</span>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2">
                    {topic.name}
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">5 Questions • 80% Pass</p>
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
