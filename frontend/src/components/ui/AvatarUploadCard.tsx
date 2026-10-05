import { useState, useRef } from 'react'
import { isAxiosError } from 'axios'
import { Camera, Trash2, Loader2 } from 'lucide-react'
import { api, getFullMediaUrl } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Button } from './Button'
import { Modal } from './Modal'

interface AvatarUploadCardProps {
  currentAvatarUrl?: string | null
  name: string
  roleLabel: string
  onAvatarUpdated?: (newUrl: string | null) => void
}

export function AvatarUploadCard({
  currentAvatarUrl,
  name,
  roleLabel,
  onAvatarUpdated,
}: AvatarUploadCardProps) {
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [removeModalOpen, setRemoveModalOpen] = useState(false)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateAvatarInStore = useAuthStore((state) => state.updateAvatar)

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      setErrorMsg('Please select a valid image file (JPEG, PNG, WEBP, SVG, GIF).')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image size must be less than 5MB.')
      return
    }

    setErrorMsg('')
    setSuccessMsg('')
    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await api.post('/profiles/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      const newAvatarUrl = res.data.avatar_url
      setFailedAvatarUrl(null)
      updateAvatarInStore(newAvatarUrl)
      if (onAvatarUpdated) onAvatarUpdated(newAvatarUrl)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to upload profile picture.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemoveAvatar = async () => {
    setRemoving(true)
    setErrorMsg('')
    setSuccessMsg('')
    try {
      await api.delete('/profiles/avatar')
      updateAvatarInStore(null)
      if (onAvatarUpdated) onAvatarUpdated(null)
      setFailedAvatarUrl(null)
      setRemoveModalOpen(false)
      setSuccessMsg('Profile photo removed')
    } catch (err: unknown) {
      const detail = isAxiosError<{ detail?: unknown }>(err)
        ? err.response?.data?.detail
        : undefined
      setErrorMsg(
        typeof detail === 'string' && detail
          ? detail
          : 'Failed to remove profile photo.'
      )
    } finally {
      setRemoving(false)
    }
  }

  const closeRemoveModal = () => {
    if (removing) return
    setRemoveModalOpen(false)
    setErrorMsg('')
  }

  const openRemoveModal = () => {
    setErrorMsg('')
    setRemoveModalOpen(true)
  }

  const avatarFullUrl = getFullMediaUrl(currentAvatarUrl)
  const initials = name
    ? name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U'

  return (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row items-center sm:items-start gap-4">
      {/* Avatar Image / Placeholder */}
      <div className="relative group">
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-2 border-indigo-200 dark:border-indigo-800/80 shadow-md bg-linear-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shrink-0">
          {avatarFullUrl && failedAvatarUrl !== avatarFullUrl ? (
            <img
              src={avatarFullUrl}
              alt={name}
              className="w-full h-full object-cover"
              onError={() => setFailedAvatarUrl(avatarFullUrl)}
            />
          ) : (
            <span className="text-2xl font-bold font-serif">{initials}</span>
          )}
        </div>

        {currentAvatarUrl && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-slate-950/55 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
            <button
              type="button"
              onClick={openRemoveModal}
              disabled={removing}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              Remove photo
            </button>
          </div>
        )}

        {/* Floating Upload Quick Badge */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="absolute -bottom-1 -right-1 z-20 p-1.5 rounded-full bg-indigo-600 text-white shadow-md hover:bg-indigo-700 transition-transform active:scale-95 cursor-pointer disabled:opacity-50"
          title="Change Profile Photo"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Info & Actions */}
      <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
        <div>
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {name || 'Profile Picture'}
            </h4>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {roleLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            PNG, JPG, WEBP or SVG up to 5MB. Visible to recruiters and candidates across InternSphere.
          </p>
        </div>

        {errorMsg && (
          !removeModalOpen && <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium" role="alert">
            {errorMsg}
          </p>
        )}
        {successMsg && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium" role="status">
            {successMsg}
          </p>
        )}

        {/* Actions Row */}
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            isLoading={uploading}
            leftIcon={<Camera className="w-3.5 h-3.5 text-indigo-500" />}
            className="text-xs"
          >
            {currentAvatarUrl ? 'Change Photo' : 'Upload Photo'}
          </Button>

          {currentAvatarUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={openRemoveModal}
              leftIcon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
              className="text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <Modal
        isOpen={removeModalOpen}
        onClose={closeRemoveModal}
        title="Remove profile photo?"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Your initials will be shown instead.
          </p>
          {errorMsg && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium" role="alert">
              {errorMsg}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={closeRemoveModal} disabled={removing}>
              Cancel
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={handleRemoveAvatar} isLoading={removing}>
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
