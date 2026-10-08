import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * DateInputVN — Ô nhập ngày theo định dạng VN dd/MM/yyyy.
 *
 * ── Yêu cầu (2026-10-08) ────────────────────────────────────
 * Ở form thêm/sửa khách, các field ngày sinh / ngày cấp / ngày hết hạn
 * trước đây dùng native <input type="date"> (format yyyy-mm-dd, UX hãm).
 * Thay bằng:
 *   - Hiển thị dd/MM/yyyy
 *   - Click icon lịch → mở calendar popup chọn
 *   - Có thể gõ thủ công dd/MM/yyyy (số tự chèn / sau dd/MM)
 *
 * Props value / onChange giữ format "YYYY-MM-DD" để không ảnh hưởng BE.
 */
export default function DateInputVN({
  value = '',
  onChange,
  placeholder = 'dd/MM/yyyy',
  disabled = false,
  className = '',
}) {
  const [text, setText] = useState(isoToVn(value))
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Sync lại text khi value ngoài đổi (load edit, reset form, …) mà text
  // hiện tại không khớp — tránh nuốt input user đang gõ.
  useEffect(() => {
    const curIso = vnToIso(text)
    if (curIso !== value) setText(isoToVn(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleChange = (raw) => {
    // Nhận số, tự chèn / sau dd và sau MM.
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 8)
    let formatted = ''
    if (digits.length <= 2) formatted = digits
    else if (digits.length <= 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
    else formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    setText(formatted)
    if (!formatted) { onChange?.(''); return }
    const iso = vnToIso(formatted)
    if (iso) onChange?.(iso)
  }

  const handleBlur = () => {
    if (!text) { onChange?.(''); return }
    const iso = vnToIso(text)
    if (iso) { setText(isoToVn(iso)); onChange?.(iso) }
    else setText(isoToVn(value))   // không hợp lệ → rollback
  }

  const pickFromCalendar = (iso) => {
    setText(isoToVn(iso))
    onChange?.(iso || '')
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="flex items-stretch rounded-lg border border-gray-300 bg-white overflow-hidden
        focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200 transition">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 min-w-0 px-3 py-2 text-sm tabular-nums bg-transparent outline-none disabled:text-gray-400"
        />
        <button type="button"
          onClick={() => !disabled && setOpen(o => !o)}
          disabled={disabled}
          title="Mở lịch"
          className="px-2.5 border-l border-gray-200 text-gray-500 hover:text-blue-600 hover:bg-blue-50
            disabled:text-gray-300 disabled:cursor-not-allowed transition">
          <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor">
            <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1zm11 6H3v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/>
          </svg>
        </button>
      </div>

      {open && (
        <CalendarPopup value={value} onPick={pickFromCalendar} onClear={() => pickFromCalendar('')} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Mini calendar popup (độc lập, grid tuần bắt đầu T2)
// ═══════════════════════════════════════════════════════════════

const WEEKDAYS  = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const MONTHS_VI = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6',
                   'Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']

function CalendarPopup({ value, onPick, onClear }) {
  const initial = parseISO(value) || new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())
  const [yearMode, setYearMode] = useState(false)

  useEffect(() => {
    const p = parseISO(value)
    if (p) { setViewYear(p.getFullYear()); setViewMonth(p.getMonth()) }
  }, [value])

  const cells = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth])
  const selectedISO = value
  const todayISO = toISO(new Date())

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  return (
    <div className="absolute z-50 mt-1 top-full left-0 w-72 bg-white rounded-xl shadow-xl
      border border-gray-200 p-3 animate-[fade-in_.12s_ease]">
      <div className="flex items-center gap-1 mb-2">
        <button type="button" onClick={prevMonth}
          className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-600 text-lg font-semibold">‹</button>
        <button type="button" onClick={() => setYearMode(m => !m)}
          className="flex-1 py-1.5 rounded-lg hover:bg-gray-100 text-sm font-bold text-gray-800">
          {yearMode ? viewYear : `${MONTHS_VI[viewMonth]} ${viewYear}`}
        </button>
        <button type="button" onClick={nextMonth}
          className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-600 text-lg font-semibold">›</button>
      </div>

      {yearMode ? (
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 12 }, (_, i) => {
            const y = viewYear - 6 + i
            const active = y === viewYear
            return (
              <button key={y} type="button"
                onClick={() => { setViewYear(y); setYearMode(false) }}
                className={`py-1.5 rounded-md text-xs font-semibold ${
                  active ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-700'
                }`}>
                {y}
              </button>
            )
          })}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map(w => (
              <div key={w} className="text-center text-[10px] font-bold text-gray-400 uppercase">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c, i) => {
              const iso = toISO(c.date)
              const isSelected = iso === selectedISO
              const isToday    = iso === todayISO
              const dim        = !c.inMonth
              return (
                <button key={i} type="button"
                  onClick={() => onPick(iso)}
                  className={`h-8 rounded-md text-xs tabular-nums transition
                    ${isSelected
                        ? 'bg-blue-600 text-white font-bold'
                        : isToday
                          ? 'bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100'
                          : dim
                            ? 'text-gray-300 hover:bg-gray-50'
                            : 'text-gray-700 hover:bg-gray-100'}`}>
                  {c.date.getDate()}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
        <button type="button" onClick={onClear}
          className="text-xs text-rose-600 hover:text-rose-800 font-semibold">Xóa</button>
        <button type="button" onClick={() => onPick(todayISO)}
          className="text-xs text-blue-600 hover:text-blue-800 font-semibold">Hôm nay</button>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

function isoToVn(iso) {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

function vnToIso(vn) {
  if (!vn) return ''
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(vn.trim())
  if (!m) return ''
  const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3])
  if (mo < 1 || mo > 12) return ''
  const dim = new Date(y, mo, 0).getDate()
  if (d < 1 || d > dim) return ''
  if (y < 1900 || y > 2200) return ''
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseISO(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}

function toISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function buildGrid(year, month) {
  const first = new Date(year, month, 1)
  const dow = first.getDay()
  const offset = (dow + 6) % 7
  const start = new Date(year, month, 1 - offset)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    cells.push({ date: d, inMonth: d.getMonth() === month })
  }
  return cells
}
