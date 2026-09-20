import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import { revealLookupPassword, lookupStatus, adminUnlockLookup } from '../../services/vmbApi'
import { copyText } from '../../lib/clipboard'
import { useToolsAuth } from '../../hooks/useToolsAuth'

/**
 * Modal 2FA để reveal password của một mục ACCOUNT.
 *
 * ── FIX 2026-09-13 — loop khi rate limit ────────────────────────────
 * Version cũ auto-submit trong {@code useEffect([code, state, submit])}.
 * Vấn đề: sau khi submit lỗi (rate limit / invalid), state chuyển
 * CHECKING → INPUT mà code vẫn còn 6 số → useEffect fire lại → submit
 * lần nữa (cùng code!) → backend lại rate-limit → vòng lặp toast.
 *
 * Cách sửa: bỏ useEffect auto-submit. Fire submit NGAY khi onChange của
 * input đạt 6 số. Nếu response lỗi, KHÔNG có nguồn nào trigger submit
 * lại đến khi user gõ đủ 6 số mới. Đơn giản, không loop được.
 *
 * ── Trạng thái ────────────────────────────────────────────
 *   'INPUT'         — đang chờ user gõ 6 số
 *   'CHECKING'      — đang gọi API
 *   'SHOWN'         — mật khẩu hiển thị, tự ẩn sau 30s
 *   'LOCKED'        — bị khóa 24h, đếm ngược đến lúc hết khóa
 */
export default function TotpModal({ entry, onClose }) {
  const { auth } = useToolsAuth()
  const isAdmin = auth?.admin === true

  const [state, setState] = useState('INPUT')  // INPUT | CHECKING | SHOWN | LOCKED
  const [code,  setCode]  = useState('')
  const [password, setPassword] = useState('')
  const [remaining, setRemaining] = useState(null)
  const [lockedUntil, setLockedUntil] = useState(null)
  const [autoHideSec, setAutoHideSec] = useState(30)
  const [now, setNow] = useState(Date.now())

  const inputRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state   // để callback đọc state mới nhất mà không cần dep

  // Lấy trạng thái ban đầu (có thể đang bị khóa từ trước)
  useEffect(() => {
    ;(async () => {
      try {
        const res = await lookupStatus()
        const d = res.data?.data
        if (d?.state === 'LOCKED') {
          setState('LOCKED')
          setLockedUntil(d.lockedUntil)
        } else {
          setRemaining(d?.remaining ?? null)
        }
      } catch { /* ignore */ }
    })()
  }, [])

  useEffect(() => {
    if (state === 'INPUT') inputRef.current?.focus()
  }, [state])

  // Tick 1s cho countdown (locked hoặc auto-hide password)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Auto-hide password sau 30s
  useEffect(() => {
    if (state !== 'SHOWN') { setAutoHideSec(30); return }
    setAutoHideSec(30)
    const t0 = Date.now()
    const id = setInterval(() => {
      const left = 30 - Math.floor((Date.now() - t0) / 1000)
      if (left <= 0) {
        clearInterval(id)
        setPassword('')
        setState('INPUT')
        setCode('')
      } else {
        setAutoHideSec(left)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [state])

  /**
   * Gọi reveal với chuỗi code cụ thể. Nhận tham số thay vì đọc state để
   * chắc chắn dùng đúng code mà onChange vừa tạo (setState là async).
   */
  const submit = useCallback(async (codeStr) => {
    if (!codeStr || codeStr.length !== 6) return
    if (stateRef.current === 'CHECKING' || stateRef.current === 'LOCKED') return

    setState('CHECKING')
    try {
      const res = await revealLookupPassword(entry.id, codeStr)
      const d = res.data?.data
      if (!d) {
        toast.error(res.data?.message || 'Lỗi máy chủ')
        setState('INPUT')
        setCode('')
        return
      }
      switch (d.state) {
        case 'OK':
          setPassword(d.password)
          setState('SHOWN')
          setRemaining(d.remaining)
          break
        case 'INVALID_CODE':
          toast.error(`Mã sai — còn ${d.remaining} lần thử`)
          setRemaining(d.remaining)
          setCode('')         // xóa để user gõ lại — cũng ngăn tự resubmit
          setState('INPUT')
          break
        case 'RATE_LIMITED':
          // Không loop nữa vì submit chỉ fire khi onChange đạt 6 số
          toast.error('Bấm quá nhanh, thử lại sau 1 giây')
          setCode('')
          setState('INPUT')
          break
        case 'LOCKED':
          setState('LOCKED')
          setLockedUntil(d.lockedUntil)
          toast.error('Đã khóa 24 giờ do sai quá nhiều lần')
          break
        default:
          setState('INPUT')
          setCode('')
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Lỗi máy chủ')
      setState('INPUT')
      setCode('')
    }
  }, [entry.id])

  /**
   * Handler cho input: clean digits, cap 6 số, và AUTO-FIRE submit ngay khi
   * đủ 6 số. Đây là nơi duy nhất trigger submit (trừ Enter key) — không có
   * useEffect nào tự động chạy lại nên không thể loop.
   */
  const onCodeChange = (raw) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 6)
    setCode(cleaned)
    if (cleaned.length === 6 && stateRef.current === 'INPUT') {
      submit(cleaned)
    }
  }

  const doAdminUnlock = async () => {
    try {
      await adminUnlockLookup()
      toast.success('Đã mở khóa')
      setState('INPUT')
      setLockedUntil(null)
      setCode('')
      setRemaining(5)
    } catch (e) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        toast.error('Bạn cần đăng nhập bằng tài khoản admin ở khu Tools')
      } else {
        toast.error(e?.response?.data?.message || 'Mở khóa thất bại')
      }
    }
  }

  const doCopyPw = async () => {
    const ok = await copyText(password)
    if (ok) toast.success('Đã copy mật khẩu')
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Xem mật khẩu — ${entry.keyword}`}
      size="sm"
      closeOnBackdrop
    >
      {state === 'LOCKED' ? (
        <LockedView lockedUntil={lockedUntil} now={now} isAdmin={isAdmin} onUnlock={doAdminUnlock} />
      ) : state === 'SHOWN' ? (
        <ShownView entry={entry} password={password} autoHideSec={autoHideSec}
          onCopy={doCopyPw} onDone={onClose} />
      ) : (
        <InputView
          code={code}
          onCodeChange={onCodeChange}
          remaining={remaining}
          busy={state === 'CHECKING'}
          inputRef={inputRef}
          onSubmit={() => submit(code)}
        />
      )}
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────

function InputView({ code, onCodeChange, remaining, busy, inputRef, onSubmit }) {
  return (
    <div className="text-center py-2">
      <div className="text-5xl mb-2">🔐</div>
      <p className="text-sm text-gray-700 mb-1">
        Mở ứng dụng Authenticator và nhập 6 số:
      </p>
      <p className="text-xs text-gray-500 mb-4">
        (Google Authenticator / Microsoft Authenticator)
      </p>

      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        maxLength={6}
        autoComplete="one-time-code"
        value={code}
        onChange={e => onCodeChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onSubmit()}
        disabled={busy}
        placeholder="——————"
        className="w-full text-center text-3xl font-mono tracking-[.6em] tabular-nums
          py-3 rounded-xl border-2 border-gray-300 bg-white
          focus:border-blue-500 focus:ring-4 focus:ring-blue-200 outline-none
          disabled:bg-gray-100"
      />

      {remaining != null && remaining < 5 && (
        <p className="mt-3 text-xs text-amber-600 font-semibold">
          Còn {remaining} lần thử trước khi bị khóa 24 giờ
        </p>
      )}

      {busy && (
        <p className="mt-3 text-xs text-gray-500">Đang xác thực…</p>
      )}
    </div>
  )
}

function ShownView({ entry, password, autoHideSec, onCopy, onDone }) {
  return (
    <div>
      <div className="p-4 rounded-xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 mb-3">
        <div className="text-[10px] font-bold text-green-700 uppercase mb-1">Tài khoản</div>
        <div className="font-mono text-sm text-gray-900 mb-3">{entry.loginUsername}</div>
        <div className="text-[10px] font-bold text-green-700 uppercase mb-1">Mật khẩu</div>
        <div className="flex items-center gap-2">
          <span className="flex-1 font-mono text-lg text-gray-900 break-all select-all">{password}</span>
          <button type="button" onClick={onCopy}
            className="px-3 py-1.5 rounded-md bg-green-600 text-white text-xs font-bold hover:bg-green-700 shrink-0">
            📋 Copy
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          Tự ẩn sau <span className="font-mono font-bold tabular-nums">{autoHideSec}s</span>
        </div>
        <button type="button" onClick={onDone}
          className="px-3 py-1.5 rounded-md bg-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-300">
          Ẩn ngay
        </button>
      </div>
    </div>
  )
}

function LockedView({ lockedUntil, now, isAdmin, onUnlock }) {
  const ms = Math.max(0, (lockedUntil || 0) - now)
  const h  = Math.floor(ms / 3_600_000)
  const m  = Math.floor((ms % 3_600_000) / 60_000)
  const s  = Math.floor((ms % 60_000) / 1000)
  const fmt = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  return (
    <div className="text-center py-4">
      <div className="text-5xl mb-2">🔒</div>
      <h3 className="text-base font-bold text-rose-700 mb-2">Đã bị khóa 24 giờ</h3>
      <p className="text-sm text-gray-600 mb-2">
        Do đã nhập sai mã 2FA quá 5 lần liên tiếp.
      </p>
      <div className="inline-block px-4 py-2 rounded-lg bg-rose-50 border border-rose-200">
        <div className="text-[10px] font-bold text-rose-600 uppercase">Mở khóa sau</div>
        <div className="font-mono text-2xl font-bold text-rose-700 tabular-nums">{fmt}</div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        {isAdmin ? (
          <button type="button" onClick={onUnlock}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
            🔧 Admin mở khóa ngay
          </button>
        ) : (
          <p className="text-xs text-gray-500">
            Nếu bạn là quản trị, đăng nhập bằng tài khoản admin ở khu Tools
            (<a href="/login" className="text-blue-600 hover:underline">/login</a>)
            rồi quay lại đây để mở khóa.
          </p>
        )}
      </div>
    </div>
  )
}
