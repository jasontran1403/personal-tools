import { useEffect, useMemo, useRef, useState } from 'react'
import { listPassengers } from '../../services/vmbApi'

/**
 * PassengerSearchSelect — combobox typeahead cho hành khách, LỌC theo
 * companyId của vé hiện tại.
 *
 * ── 2026-10-16 ──────────────────────────────────────────────
 * Dùng trong BookingFormModal thay cho `<input type="text">` tên khách.
 * - Khi gõ → debounce 300ms → gọi listPassengers({ q, companyId, size: 20 }).
 * - User cũng có thể gõ tay (nhập tên không có trong hệ thống — khách lẻ /
 *   khách mới chưa thêm): props cho phép free-text, onPick(null) = clear.
 * - Khi chọn 1 entry → onPick({ id, fullName, documents, dob, gender, ... }).
 * - Có nút ✕ để clear hoàn toàn khi đã chọn (chuyển về mode free-text).
 *
 * Props:
 *   value         — tên hành khách hiện tại (string). Hiển thị trong input.
 *   companyId     — null → tất cả hệ thống (khuyến nghị truyền để lọc).
 *   onChangeText  — (text) => void. Gọi khi user gõ tay. Khi text không khớp
 *                   passenger nào trong hệ thống thì vẫn giữ, free-text.
 *   onPick        — (passenger | null). Gọi khi user chọn 1 entry hoặc clear.
 *   disabled      — ẩn dropdown nếu đang disabled.
 *   placeholder
 */
export default function PassengerSearchSelect({
  value = '',
  companyId = null,
  onChangeText,
  onPick,
  disabled = false,
  placeholder = 'Gõ tên khách / mã CCCD / số HC…',
}) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  // Debounce query khi value đổi
  const [debouncedQ, setDebouncedQ] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(value), 300)
    return () => clearTimeout(t)
  }, [value])

  // Fetch khi mở hoặc query đổi
  useEffect(() => {
    if (!open || disabled) return
    let abort = false
    setLoading(true)
    listPassengers({
      q: debouncedQ || '',
      companyId: companyId || undefined,
      size: 20,
    })
      .then(res => {
        if (abort) return
        setResults(res.data?.data?.content || [])
      })
      .catch(() => { if (!abort) setResults([]) })
      .finally(() => { if (!abort) setLoading(false) })
    return () => { abort = true }
  }, [open, debouncedQ, companyId, disabled])

  // Click ngoài → đóng
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (p) => {
    onPick?.(p)
    setOpen(false)
  }

  const clear = () => {
    onPick?.(null)
    onChangeText?.('')
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={disabled}
          onChange={e => { onChangeText?.(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="input pr-7"
          autoComplete="off"
        />
        {value && (
          <button type="button" onClick={clear}
            title="Xóa chọn"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded hover:bg-rose-100 text-rose-500 text-sm leading-none">
            ×
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {loading && (
            <div className="px-3 py-2 text-xs text-gray-400">Đang tìm…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">
              Không thấy khách nào.
              {!companyId && ' (Thử chọn Công ty trước)'}
            </div>
          )}
          {!loading && results.map(p => (
            <PassengerRow key={p.id} p={p} onClick={() => pick(p)} />
          ))}
        </div>
      )}
    </div>
  )
}

function PassengerRow({ p, onClick }) {
  const cccd = (p.documents || []).find(d => d.type === 'CCCD')
  const pp   = (p.documents || []).find(d => d.type === 'PASSPORT')
  const nearest = p.nearestExpiry || cccd?.expiryDate || pp?.expiryDate

  return (
    <button type="button" onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{p.fullName}</div>
          <div className="text-[10px] text-gray-500 truncate">
            {p.companyName || 'Khách lẻ'}
            {cccd && <span className="ml-1 text-indigo-600">· CCCD</span>}
            {pp && <span className="ml-1 text-emerald-600">· HC</span>}
            {p.dob && <span className="ml-1 font-mono">· {p.dob}</span>}
          </div>
        </div>
        {nearest && (
          <span className="text-[10px] text-gray-500 font-mono shrink-0">
            Exp {nearest}
          </span>
        )}
      </div>
    </button>
  )
}
