import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import ConfirmModal from '../common/ConfirmModal'
import { generateTOTP } from '../../lib/totp'
import { load2fa, remove2fa, subscribe2fa } from '../../lib/twoFaStore'

/**
 * 2026-11-12: Mục 2FA trong "Tra cứu" — sinh mã TOTP như Google Authenticator.
 *
 * ⚠ Secret 2FA lưu LOCAL trên thiết bị (localStorage), KHÔNG đồng bộ server.
 *
 * Việc THÊM 2FA nằm trong modal "Thêm mục tra cứu" (LookupFormModal, loại 2FA).
 *   Mục này chỉ HIỂN THỊ + copy + xoá. Khi kho đổi (thêm ở modal) → tự cập nhật
 *   nhờ subscribe2fa.
 */
export default function TwoFaSection({ active, query = '' }) {
  const [entries, setEntries] = useState(() => load2fa())
  const [confirmDel, setConfirmDel] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  // Đồng bộ khi kho 2FA đổi (thêm từ modal, hoặc tab khác).
  useEffect(() => subscribe2fa(() => setEntries(load2fa())), [])

  // Tick mỗi giây để cập nhật mã + vòng đếm ngược.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  const delEntry = (id) => { remove2fa(id); setConfirmDel(null) }

  if (!active) return null

  const q = query.trim().toLowerCase()
  const shown = q
    ? entries.filter(e => (e.name || '').toLowerCase().includes(q) || (e.issuer || '').toLowerCase().includes(q))
    : entries

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-gray-700 uppercase">🔑 2FA ({entries.length})</span>
      </div>

      {shown.length === 0 ? (
        <div className="text-xs text-gray-400 italic px-1 py-3">
          {entries.length === 0
            ? 'Chưa có mã 2FA. Bấm "Thêm mục" → chọn loại 2FA để thêm bằng chuỗi bí mật hoặc QR.'
            : 'Không khớp tìm kiếm.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {shown.map(e => (
            <TotpCard key={e.id} entry={e} now={now} onDelete={() => setConfirmDel(e)} />
          ))}
        </div>
      )}

      {confirmDel && (
        <ConfirmModal open title="Xoá mã 2FA?"
          message={`Xoá "${confirmDel.name}"? Secret sẽ mất khỏi thiết bị này, không khôi phục được.`}
          confirmLabel="Xoá" danger
          onConfirm={() => delEntry(confirmDel.id)}
          onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}

function TotpCard({ entry, now, onDelete }) {
  const period = entry.period || 30
  const digits = entry.digits || 6
  const [code, setCode] = useState('•'.repeat(digits))
  const counter = Math.floor(now / 1000 / period)

  // Sinh lại mã mỗi khi sang chu kỳ mới (counter đổi).
  useEffect(() => {
    let alive = true
    generateTOTP(entry.secret, { period, digits, algorithm: entry.algorithm, timeMs: now })
      .then(c => { if (alive && c) setCode(c) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counter, entry.secret])

  const secondsLeft = period - (Math.floor(now / 1000) % period)
  const danger = secondsLeft <= 5
  const display = digits === 6 ? `${code.slice(0, 3)} ${code.slice(3)}`
    : digits === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code

  const copy = () => {
    navigator.clipboard.writeText(code)
      .then(() => toast.success('Đã copy mã 2FA'))
      .catch(() => toast.error('Không copy được'))
  }

  return (
    <div onClick={copy}
      title="Bấm để copy mã"
      className={`relative cursor-copy select-none rounded-xl border p-3 transition
        ${danger ? 'border-rose-400 bg-rose-50 animate-pulse' : 'border-gray-200 bg-white'}`}>
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute top-2 right-2 w-6 h-6 rounded-md text-gray-400 hover:text-rose-600 hover:bg-rose-50 text-xs">
        🗑
      </button>
      <div className="text-xs font-bold text-gray-800 truncate pr-6">{entry.name || '(không tên)'}</div>
      {entry.issuer && <div className="text-[10px] text-gray-400 truncate">{entry.issuer}</div>}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className={`font-mono tabular-nums text-2xl font-bold tracking-wider
          ${danger ? 'text-rose-600' : 'text-blue-700'}`}>
          {display}
        </span>
        <CountdownRing secondsLeft={secondsLeft} period={period} danger={danger} />
      </div>
    </div>
  )
}

function CountdownRing({ secondsLeft, period, danger }) {
  const r = 12
  const circ = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, secondsLeft / period))
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="shrink-0">
      <circle cx="17" cy="17" r={r} fill="none" strokeWidth="3" className="text-gray-200" stroke="currentColor" />
      <circle cx="17" cy="17" r={r} fill="none" strokeWidth="3" strokeLinecap="round" stroke="currentColor"
        className={danger ? 'text-rose-500' : 'text-blue-500'}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)}
        transform="rotate(-90 17 17)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      <text x="17" y="21" textAnchor="middle"
        className={`text-[11px] font-bold ${danger ? 'fill-rose-600' : 'fill-gray-500'}`}>
        {secondsLeft}
      </text>
    </svg>
  )
}