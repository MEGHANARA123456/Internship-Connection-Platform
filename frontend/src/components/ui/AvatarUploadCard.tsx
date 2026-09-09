import { useState, useRef } from 'react'
import { Camera, Trash2, Loader2 } from 'lucide-react'
import { api, getFullMediaUrl } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Button } from './Button'

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
    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await api.post('/profiles/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      const newAvatarUrl = res.data.avatar_url
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
    if (!confirm('Are you sure you want to remove your profile photo?')) return
    setRemoving(true)
    setErrorMsg('')
    try {
      await api.delete('/profiles/avatar')
      updateAvatarInStore(null)
      if (onAvatarUpdated) onAvatarUpdated(null)
    } catch {
      setErrorMsg('Failed to remove profile photo.')
    } finally {
      setRemoving(false)
    }
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
          {avatarFullUrl ? (
            <img
              src={avatarFullUrl}
              alt={name}
              className="w-full h-full object-cover"
              onError={(e) => {
                // If failed to load image, hide image and show initials
                ;(e.currentTarget as HTMLElement).style.display = 'none'
              }}
            />
          ) : (
            <span className="text-2xl font-bold font-serif">{initials}</span>
          )}
        </div>

        {/* Floating Upload Quick Badge */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-indigo-600 text-white shadow-md hover:bg-indigo-700 transition-transform active:scale-95 cursor-pointer disabled:opacity-50"
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
          <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
            {errorMsg}
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
              onClick={handleRemoveAvatar}
              isLoading={removing}
              leftIcon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
              className="text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
