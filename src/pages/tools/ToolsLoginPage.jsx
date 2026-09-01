import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useToolsAuth } from '../../hooks/useToolsAuth'
import { rememberedToolsUsername } from '../../services/toolsAuth'

/**
 * Đăng nhập vào khu Tiện ích (/tools).
 * Sai thông tin → chỉ hiện lỗi, KHÔNG rời trang này.
 * Đúng → vào thẳng /tools (hoặc trang trước đó nếu bị đá ra vì hết phiên).
 */
export default function ToolsLoginPage() {
  const [form, setForm] = useState(() => ({ username: rememberedToolsUsername(), password: '' }))
  const [remember, setRemember] = useState(() => !!rememberedToolsUsername())
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const { login } = useToolsAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleSubmit = async e => {
    e.preventDefault()
    setLoading(true); setErr('')
    try {
      const res = await login(form.username.trim(), form.password, remember)
      if (!res.ok) { setErr(res.message || 'Đăng nhập thất bại'); return }
      const from = location.state?.from?.pathname || '/tools'
      navigate(from, { replace: true })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100svh] w-full bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4 overflow-hidden">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/30 mb-4">
            <span className="text-3xl">🧰</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Tiện ích nội bộ</h1>
          <p className="text-indigo-300 text-sm mt-1">Hình ảnh · Tệp · Office · Watermark</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-indigo-200 uppercase tracking-wider mb-2">
                Tên đăng nhập
              </label>
              <input
                type="text" required autoFocus autoComplete="username"
                value={form.username}
                onChange={e => { setForm(p => ({ ...p, username: e.target.value })); setErr('') }}
                placeholder="username"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/30 outline-none focus:border-indigo-400 focus:bg-white/15 transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-indigo-200 uppercase tracking-wider mb-2">
                Mật khẩu
              </label>
              <input
                type="password" required autoComplete="current-password"
                value={form.password}
                onChange={e => { setForm(p => ({ ...p, password: e.target.value })); setErr('') }}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/30 outline-none focus:border-indigo-400 focus:bg-white/15 transition-all text-sm"
              />
            </div>

            {err && (
              <div className="bg-red-500/15 border border-red-500/30 rounded-xl px-4 py-3 text-red-300 text-sm">
                {err}
              </div>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-500"
              />
              <span className="text-sm text-indigo-100">Ghi nhớ đăng nhập</span>
            </label>
            {remember && (
              <p className="text-xs text-white/30 -mt-2 leading-relaxed">
                Phiên giữ tối đa 30 ngày, còn sau khi đóng trình duyệt. Không nên bật trên máy dùng chung.
              </p>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm mt-2"
            >
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
