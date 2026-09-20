import { useState, useRef, useEffect, useMemo } from 'react'

/**
 * DatePicker — popup lịch tự vẽ, không dùng native <input type="date">.
 *
 * Đặc điểm:
 *   - Value là chuỗi "YYYY-MM-DD" (khớp native format → dễ swap qua lại)
 *   - Grid Tháng chuẩn: 6 hàng × 7 cột, tuần bắt đầu THỨ 2 (kiểu VN)
 *   - Có shortcut Hôm nay + Xóa ở footer
 *   - Đóng khi click ra ngoài / bấm Esc
 *
 * Trigger là 1 button hiển thị "dd/MM/yyyy" (VN) hoặc placeholder. Popup
 * hiện ngay dưới trigger, absolute-positioned. Trong bảng lọc chỉ cần
 * "picker gọn nhẹ", nên không kèm view chọn năm-tháng riêng — user bấm
 * nút prev/next để đi tới tháng cần chọn (có thể click tiêu đề để đổi năm
 * nhanh — mở popup nhỏ chọn năm).
 */
const WEEKDAYS  = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const MONTHS_VI = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6',
                   'Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']

export default function DatePicker({
  value = '',
  onChange,
  placeholder = 'dd/mm/yyyy',
  disabled = false,
  className = '',
  size = 'md',   // 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [yearMode, setYearMode] = useState(false)

  // Ngày đang xem trên grid (không nhất thiết = ngày chọn)
  const initial = parseISO(value) || new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())   // 0-11

  const boxRef = useRef(null)

  // Sync khi value đổi bên ngoài
  useEffect(() => {
    const p = parseISO(value)
    if (p) { setViewYear(p.getFullYear()); setViewMonth(p.getMonth()) }
  }, [value])

  // Đóng khi click ngoài / Esc
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    const onKey  = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Cells: 42 = 6 hàng × 7 ngày. Bao gồm ngày tháng trước/tháng sau xám nhẹ.
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

  const pick = (iso) => {
    onChange?.(iso)
    setOpen(false)
  }

  const btnPad = size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`w-full ${btnPad} inline-flex items-center gap-2 rounded-lg border border-gray-300
          bg-white text-left tabular-nums transition
          hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none
          disabled:bg-gray-50 disabled:text-gray-400`}
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-gray-500 shrink-0" fill="currentColor">
          <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1zm11 6H3v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/>
        </svg>
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>
          {value ? formatVN(value) : placeholder}
        </span>
      </button>

      {/* Popup */}
      {open && (
        <div className="absolute z-50 mt-1 top-full left-0 w-72 bg-white rounded-xl shadow-xl
          border border-gray-200 p-3 animate-[fade-in_.12s_ease]">
          {/* Header: prev, tiêu đề (click đổi năm), next */}
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
            /* Grid năm 4 × 3 gồm 12 năm quanh viewYear */
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
              {/* Weekday row */}
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {WEEKDAYS.map(w => (
                  <div key={w} className="text-center text-[10px] font-bold text-gray-400 uppercase">
                    {w}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((c, i) => {
                  const iso = toISO(c.date)
                  const isSelected = iso === selectedISO
                  const isToday    = iso === todayISO
                  const dim        = !c.inMonth
                  return (
                    <button key={i} type="button"
                      onClick={() => pick(iso)}
                      className={`h-8 rounded-md text-xs tabular-nums transition
                        ${isSelected
                            ? 'bg-blue-600 text-white font-bold'
                            : isToday
                              ? 'bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100'
                              : dim
                                ? 'text-gray-300 hover:bg-gray-50'
                                : 'text-gray-700 hover:bg-gray-100'}`}
                    >
                      {c.date.getDate()}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* Footer shortcuts */}
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
            <button type="button"
              onClick={() => { onChange?.(''); setOpen(false) }}
              className="text-xs text-rose-600 hover:text-rose-800 font-semibold">
              Xóa
            </button>
            <button type="button"
              onClick={() => pick(todayISO)}
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold">
              Hôm nay
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────

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

function formatVN(iso) {
  const d = parseISO(iso)
  if (!d) return iso
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/**
 * Build 42 ô (6 hàng × 7 cột) bắt đầu từ Thứ 2 của tuần chứa ngày 1 của tháng.
 * Trả về array { date, inMonth }.
 */
function buildGrid(year, month) {
  const first = new Date(year, month, 1)
  // JS: 0=CN, 1=T2, ... 6=T7. Muốn tuần bắt đầu T2 → offset = (dow + 6) % 7
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
