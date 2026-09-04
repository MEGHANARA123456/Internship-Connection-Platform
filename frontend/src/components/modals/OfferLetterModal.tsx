import { useState, useRef, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import {
  Download,
  PenTool,
  RotateCcw,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react'

interface OfferLetterModalProps {
  isOpen: boolean
  onClose: () => void
  candidateName: string
  companyName: string
  roleTitle: string
  stipend: number
  startDate?: string
}

export function OfferLetterModal({
  isOpen,
  onClose,
  candidateName,
  companyName,
  roleTitle,
  stipend,
  startDate = 'October 1, 2026',
}: OfferLetterModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawnSignature, setHasDrawnSignature] = useState(false)
  const [typedSignName, setTypedSignName] = useState('')
  const [signMode, setSignMode] = useState<'draw' | 'type'>('draw')
  const [isSigned, setIsSigned] = useState(false)
  const [signatureTimestamp, setSignatureTimestamp] = useState('')

  useEffect(() => {
    if (isOpen && signMode === 'draw') {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.strokeStyle = '#2563eb'
          ctx.lineWidth = 2
          ctx.lineCap = 'round'
        }
      }
    }
  }, [isOpen, signMode])

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
    setIsDrawing(true)
    setHasDrawnSignature(true)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawnSignature(false)
  }

  const handleConfirmSign = () => {
    setIsSigned(true)
    setSignatureTimestamp(new Date().toLocaleString())
  }

  const handlePrintDownload = () => {
    window.print()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Official Internship Offer Letter"
      description={`Issued by ${companyName} • Confidential & Legally Binding`}
      maxWidth="3xl"
    >
      <div className="space-y-6">
        {/* Printable Formal Offer Document */}
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-5 shadow-inner">
          {/* Letterhead */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">
                {companyName[0].toUpperCase()}
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{companyName}</h3>
                <p className="text-[10px] text-slate-400">People & Talent Operations</p>
              </div>
            </div>
            <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">Offer Ref: #OFF-2026-9041</span>
              <span>Date: {new Date().toLocaleDateString()}</span>
            </div>
          </div>

          {/* Salutation & Body */}
          <div className="space-y-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            <p>
              Dear <strong>{candidateName}</strong>,
            </p>
            <p>
              On behalf of <strong>{companyName}</strong>, we are thrilled to formally extend this offer of internship for the position of <strong>{roleTitle}</strong>. Your technical competence, passion, and problem-solving skills during our selection process deeply impressed our engineering leadership.
            </p>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Designation:</span>
                <span className="font-bold text-slate-900 dark:text-white">{roleTitle}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Monthly Compensation:</span>
                <span className="font-bold text-slate-900 dark:text-white">${stipend} USD / month</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Expected Start Date:</span>
                <span className="font-bold text-slate-900 dark:text-white">{startDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Work Mode:</span>
                <span className="font-bold text-slate-900 dark:text-white">Hybrid / Flexible Mentorship</span>
              </div>
            </div>

            <p>
              By signing below, you confirm your acceptance of the terms outlined and your commitment to intellectual property integrity and professional conduct throughout your tenure.
            </p>
          </div>

          {/* Signature Verification Block */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Authorized Employer Signatory</p>
              <p className="text-xs font-bold text-slate-900 dark:text-white mt-1">Elena Vance</p>
              <p className="text-[10px] text-slate-500">VP of Talent Acquisition, {companyName}</p>
            </div>

            <div className="text-left sm:text-right">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Candidate Electronic Signature</p>
              {isSigned ? (
                <div className="mt-1 space-y-0.5">
                  <span className="text-sm font-serif italic font-bold text-indigo-600 dark:text-indigo-400 block">
                    {typedSignName || candidateName}
                  </span>
                  <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 sm:justify-end">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Cryptographically Signed • {signatureTimestamp}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium block mt-1 italic">
                  Pending Candidate Signature
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Digital E-Signature Pad Section */}
        {!isSigned ? (
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <PenTool className="w-3.5 h-3.5 text-indigo-500" />
                Sign Your Acceptance Digitally
              </span>

              <div className="flex gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setSignMode('draw')}
                  className={`px-2.5 py-1 rounded font-medium cursor-pointer ${
                    signMode === 'draw'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  Draw Signature
                </button>
                <button
                  type="button"
                  onClick={() => setSignMode('type')}
                  className={`px-2.5 py-1 rounded font-medium cursor-pointer ${
                    signMode === 'type'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  Type Name
                </button>
              </div>
            </div>

            {signMode === 'draw' ? (
              <div className="space-y-2">
                <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={110}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    className="w-full h-[110px] cursor-crosshair"
                  />
                  {!hasDrawnSignature && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-slate-400 text-xs">
                      Sign here using mouse or touch
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={clearSignature}
                    className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Clear Pad
                  </button>
                </div>
              </div>
            ) : (
              <Input
                label="Full Legal Name for E-Signature"
                placeholder={candidateName}
                value={typedSignName}
                onChange={(e) => setTypedSignName(e.target.value)}
              />
            )}

            <div className="pt-2 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={handleConfirmSign}
                disabled={signMode === 'draw' ? !hasDrawnSignature : !typedSignName.trim()}
                leftIcon={<ShieldCheck className="w-3.5 h-3.5" />}
              >
                Apply E-Signature & Accept
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              Verified & Signed Offer Letter
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handlePrintDownload}
                leftIcon={<Download className="w-3.5 h-3.5" />}
              >
                Download Official PDF
              </Button>
              <Button size="sm" variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
