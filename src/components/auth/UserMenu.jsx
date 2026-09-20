import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'   // 👈 thêm import này
import toast from 'react-hot-toast'
import { useToolsAuth } from '../../hooks/useToolsAuth'
import UserManagerModal from './UserManagerModal'
import Modal from '../common/Modal'
import { changePassword } from '../../services/toolsAuth'

export default function UserMenu() {
  const { auth, logout } = useToolsAuth()
  const [open, setOpen] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const [showChangePw, setShowChangePw] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = e => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    const onKey   = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!auth) return null

  const display = auth.displayName || auth.username
  const initials = getInitials(display)

  const handleConfirmLogout = () => {
    try { logout() } catch (e) { /* ignore */ }
    try { localStorage.clear() } catch (e) { /* ignore */ }
    setShowLogoutConfirm(false)
    setOpen(false)
    toast.success('Đã đăng xuất')
    window.location.href = '/'
  }

  return (
    <>
      <div className="relative" ref={boxRef}>
        <button
          type="button"
          onClick={() => setShowLogoutConfirm(true)}
          className="flex items-center gap-2 pl-1 pr-2 sm:pl-1.5 sm:pr-3 py-1
                     rounded-full border border-gray-200 bg-white hover:bg-gray-50
                     shadow-sm transition"
          aria-label="Đăng xuất"
          title="Click để đăng xuất"
        >
          <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600
            text-white text-sm font-bold flex items-center justify-center">
            {initials}
          </span>
          <span className="hidden sm:block text-sm font-semibold text-gray-700 max-w-[10rem] truncate">
            {display}
          </span>
          <svg viewBox="0 0 20 20" className="w-4 h-4 text-gray-400" fill="currentColor">
            <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"/>
          </svg>
        </button>
      </div>

      {showUsers && <UserManagerModal onClose={() => setShowUsers(false)} />}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}

      {showLogoutConfirm && (
        <LogoutConfirmModal
          display={display}
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={handleConfirmLogout}
        />
      )}
    </>
  )
}

// ── Modal xác nhận đăng xuất — render qua Portal để luôn giữa viewport ──

function LogoutConfirmModal({ display, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    // Khóa scroll body khi modal mở
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onCancel])

  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 2147483647 }}   /* max int32 — trên mọi thứ */
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-title"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Hộp thoại */}
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl
                      border border-gray-100 p-5"
           style={{ animation: 'logoutFadeIn .15s ease-out' }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600
                          flex items-center justify-center text-xl shrink-0">
            ⏻
          </div>
          <div className="min-w-0">
            <h3 id="logout-title" className="text-base font-semibold text-gray-900">
              Xác nhận đăng xuất
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Bạn có chắc chắn muốn đăng xuất khỏi tài khoản{' '}
              <span className="font-semibold text-gray-900">{display}</span> không?
            </p>
            <p className="mt-1.5 text-xs text-gray-500">
              Dữ liệu lưu cục bộ (localStorage) sẽ bị xóa.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100 transition"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 text-white
                       hover:bg-rose-700 transition"
          >
            Đăng xuất
          </button>
        </div>
      </div>

      <style>{`
        @keyframes logoutFadeIn {
          from { opacity: 0; transform: translateY(4px) scale(.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  )

  // 👇 Render ra thẳng document.body, thoát khỏi mọi ancestor
  if (typeof document === 'undefined') return null
  return createPortal(content, document.body)
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Đổi mật khẩu ───────────────────────────────────────────────────

function ChangePasswordModal({ onClose }) {
  const [cur, setCur] = useState('')
  const [nw,  setNw]  = useState('')
  const [nw2, setNw2] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async e => {
    e.preventDefault()
    if (nw !== nw2) return toast.error('Hai lần nhập mật khẩu mới không khớp')
    if (nw.length < 4) return toast.error('Mật khẩu mới cần ít nhất 4 ký tự')
    setBusy(true)
    try {
      await changePassword(cur, nw)
      toast.success('Đã đổi mật khẩu')
      onClose()
    } catch (err) {
      toast.error(err?.message || 'Đổi mật khẩu thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title="Đổi mật khẩu"
      size="sm"
      closeOnBackdrop={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
          <button type="submit" form="cp-form" disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? 'Đang lưu…' : 'Đổi mật khẩu'}
          </button>
        </div>
      }
    >
      <form id="cp-form" onSubmit={submit} className="space-y-3">
        <Field label="Mật khẩu hiện tại">
          <input type="password" required autoFocus autoComplete="current-password"
            value={cur} onChange={e => setCur(e.target.value)} className="input" />
        </Field>
        <Field label="Mật khẩu mới">
          <input type="password" required autoComplete="new-password"
            value={nw} onChange={e => setNw(e.target.value)} className="input" />
        </Field>
        <Field label="Nhập lại mật khẩu mới">
          <input type="password" required autoComplete="new-password"
            value={nw2} onChange={e => setNw2(e.target.value)} className="input" />
        </Field>
        <p className="text-xs text-gray-500">
          Sau khi đổi, các thiết bị khác không tự động đăng xuất — chỉ đăng nhập lại
          bằng mật khẩu mới ở lần sau.
        </p>
      </form>

      <style>{`
        .input {
          @apply w-full px-3 py-2 rounded-lg border border-gray-300 bg-white
                 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none;
        }
      `}</style>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  )
}