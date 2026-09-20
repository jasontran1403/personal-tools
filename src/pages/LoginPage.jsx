import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useToolsAuth } from '../hooks/useToolsAuth'
import { rememberedToolsUsername } from '../services/toolsAuth'

/**
 * Trang đăng nhập cho khu Tiện ích.
 *
 * Điểm cần chú ý:
 *   - Nếu đã đăng nhập rồi mở /login → tự chuyển về `back` (mặc định /).
 *   - `back` được validate là đường dẫn nội bộ (bắt đầu bằng "/"); nếu ai đó
 *     gắn URL ngoài để redirect phishing, bỏ qua.
 *   - "Ghi nhớ đăng nhập" quyết định:
 *       * TTL của token (BE cấp 7 ngày vs 12 giờ)
 *       * Nơi lưu ở client (localStorage vs sessionStorage)
 *       * Có nhớ username để tự điền lần sau không
 *   - Show/hide password bằng nút mắt — bảng phím ảo trên mobile hiển thị mật
 *     khẩu quá dày, cần cách xem lại nhanh mà không nhập lại từ đầu.
 */
export default function LoginPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { auth, ready, login } = useToolsAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPw,   setShowPw]   = useState(false)
  const [busy,     setBusy]     = useState(false)

  // Pre-fill từ lần "ghi nhớ" gần nhất
  useEffect(() => {
    const u = rememberedToolsUsername()
    if (u) setUsername(u)
  }, [])

  // Đã đăng nhập thì đi thẳng vào chỗ đang cần đến
  useEffect(() => {
    if (!ready || !auth) return
    nav(safeBack(params.get('back')), { replace: true })
  }, [ready, auth, nav, params])

  const submit = async e => {
    e.preventDefault()
    if (!username.trim() || !password) {
      return toast.error('Vui lòng nhập đủ tài khoản và mật khẩu')
    }
    setBusy(true)
    try {
      const res = await login(username.trim(), password, remember)
      if (res.ok) {
        toast.success('Đăng nhập thành công')
        nav(safeBack(params.get('back')), { replace: true })
      } else {
        toast.error(res.message || 'Sai tài khoản hoặc mật khẩu')
        setPassword('')  // clear pass để không lỡ nhấn tiếp tự đăng nhập lại
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10
      bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 relative overflow-hidden">

      {/* Trang trí: 2 vòng gradient mờ chạy nền, không tương tác được */}
      <div aria-hidden className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-300/20 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-indigo-300/20 blur-3xl" />

      <div className="relative w-full max-w-sm">
        {/* Logo / tên app */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl
            bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg mb-3">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white">
              <path d="M12 15v2m0-9a3 3 0 1 1-3 3M6 21h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Tools</h1>
          <p className="text-sm text-gray-500 mt-1">Khu tiện ích nội bộ</p>
        </div>

        {/* Card */}
        <form onSubmit={submit}
          className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-2xl shadow-xl p-6 space-y-4">

          <div>
            <label htmlFor="u" className="block text-xs font-semibold text-gray-600 mb-1.5">
              Tên đăng nhập
            </label>
            <input
              id="u" type="text" autoComplete="username" autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={busy}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white
                text-sm font-mono placeholder:font-sans placeholder:text-gray-400
                focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none
                disabled:opacity-60 transition"
              placeholder="nguyenhai"
            />
          </div>

          <div>
            <label htmlFor="p" className="block text-xs font-semibold text-gray-600 mb-1.5">
              Mật khẩu
            </label>
            <div className="relative">
              <input
                id="p" type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={busy}
                className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-gray-300 bg-white
                  text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none
                  disabled:opacity-60 transition"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg
                  text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex items-center justify-center">
                {showPw ? (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l2.02 2.02A10.7 10.7 0 0 0 .46 9.5.75.75 0 0 0 .5 10c.9 3.42 4.7 6 9.5 6a10 10 0 0 0 4.32-.98l2.4 2.4a.75.75 0 1 0 1.06-1.06L3.28 2.22ZM10 14.5c-3.63 0-6.68-1.83-7.66-4.5.3-.83.83-1.6 1.52-2.28l1.6 1.6A3 3 0 0 0 9.68 13.5l1.13 1.14a8.4 8.4 0 0 1-.81.02Z" clipRule="evenodd"/>
                    <path d="M10 5.5c3.63 0 6.68 1.83 7.66 4.5-.31.85-.86 1.63-1.58 2.32l1.06 1.06A10.7 10.7 0 0 0 19.54 10a.75.75 0 0 0-.04-.5C18.6 6.08 14.8 3.5 10 3.5c-.72 0-1.42.06-2.09.18l1.24 1.24c.28-.02.56-.02.85 0Z"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M10 4.5c-4.8 0-8.6 2.58-9.5 6a.75.75 0 0 0 0 .5c.9 3.42 4.7 6 9.5 6s8.6-2.58 9.5-6a.75.75 0 0 0 0-.5c-.9-3.42-4.7-6-9.5-6Zm0 10a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm0-5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 select-none cursor-pointer">
            <input type="checkbox" checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span>Ghi nhớ đăng nhập</span>
          </label>

          <button type="submit" disabled={busy}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600
              text-white text-sm font-semibold shadow-lg shadow-blue-500/20
              hover:from-blue-700 hover:to-indigo-700
              disabled:opacity-60 disabled:cursor-not-allowed transition">
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500 mt-4">
          Quên mật khẩu? Liên hệ quản trị viên để đặt lại.
        </p>
      </div>
    </div>
  )
}

/** Chỉ chấp nhận đường dẫn nội bộ, chặn open-redirect ra domain khác */
function safeBack(raw) {
  if (!raw) return '/'
  try {
    const v = decodeURIComponent(raw)
    if (v.startsWith('/') && !v.startsWith('//')) return v
  } catch { /* thôi bỏ qua, về /  */ }
  return '/'
}
