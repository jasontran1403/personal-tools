import { useState, useRef, useEffect, useMemo } from 'react'

/**
 * DateRangePicker — chọn khoảng thời gian bằng 1 popup calendar.
 *
 * Value contract:
 *   { from: 'YYYY-MM-DD' | '', to: 'YYYY-MM-DD' | '' }
 *   onChange(next) — luôn gọi với object đầy đủ {from, to}.
 *
 * Layout:
 *   - Desktop (≥md): hiển thị 2 tháng side-by-side (tháng ngày "đến" +
 *     tháng liền trước).
 *   - Mobile (<md): 1 tháng.
 *
 * View mặc định khi mở:
 *   - Chưa có range → tháng hiện tại
 *   - Đã có range → tháng của {@code to}
 *
 * Tương tác:
 *   - Click 1 ngày lần đầu → set from, clear to
 *   - Click 1 ngày lần 2 (sau ngày from) → set to, đóng popup
 *   - Click ngày trước from → coi như bắt đầu range mới (reset from)
 *   - Hover 1 cell khi đã có from → highlight preview
 *
 * Trigger: 1 button, hiển thị "dd/MM/yyyy — dd/MM/yyyy" hoặc placeholder.
 */

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const MONTHS_VI = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
                   'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12']

export default function DateRangePicker({
  value = { from: '', to: '' },
  onChange,
  placeholder = 'Chọn khoảng ngày',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  )

  // Track viewport width để switch layout 1↔2 tháng
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Tháng đang xem (base) — cột PHẢI trên desktop, cột duy nhất trên mobile
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())

  // Ngày "from" tạm — khi user đã click 1 lần nhưng chưa click lần 2
  // (giúp preview highlight khi hover các cell khác)
  const [hoverDate, setHoverDate] = useState(null) // "YYYY-MM-DD" or null

  const boxRef = useRef(null)

  // ── Khi mở popup: quyết định tháng khởi động ──
  const openPopup = () => {
    if (disabled) return
    // Có "to" → tháng của "to". Không → tháng hiện tại.
    const anchor = parseISO(value?.to) || parseISO(value?.from) || new Date()
    setViewYear(anchor.getFullYear())
    setViewMonth(anchor.getMonth())
    setHoverDate(null)
    setOpen(true)
  }

  // Đóng khi click ngoài / Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const prevMonth = () => {
    let y = viewYear, m = viewMonth - 1
    if (m < 0) { m = 11; y -= 1 }
    setViewYear(y); setViewMonth(m)
  }
  const nextMonth = () => {
    let y = viewYear, m = viewMonth + 1
    if (m > 11) { m = 0; y += 1 }
    setViewYear(y); setViewMonth(m)
  }

  // Trên desktop: tháng trái = viewMonth - 1
  const leftMonthYm = useMemo(() => {
    let y = viewYear, m = viewMonth - 1
    if (m < 0) { m = 11; y -= 1 }
    return { year: y, month: m }
  }, [viewYear, viewMonth])

  // ── Xử lý click ngày ──
  const handlePick = (iso) => {
    const from = value?.from
    const to = value?.to

    if (!from || (from && to)) {
      // Trạng thái rỗng hoặc đã đủ range → bắt đầu range mới
      onChange?.({ from: iso, to: '' })
      setHoverDate(null)
      return
    }

    // Có from, chưa có to → click lần 2
    if (iso < from) {
      // Chọn ngày trước from → coi như đổi from
      onChange?.({ from: iso, to: '' })
      return
    }
    // iso >= from → set to, đóng
    onChange?.({ from, to: iso })
    setHoverDate(null)
    setOpen(false)
  }

  const clearRange = () => {
    onChange?.({ from: '', to: '' })
    setHoverDate(null)
  }
  const setToday = () => {
    const iso = fmtISO(new Date())
    onChange?.({ from: iso, to: iso })
    setHoverDate(null)
    setOpen(false)
  }
  const setThisMonth = () => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    onChange?.({ from: fmtISO(first), to: fmtISO(last) })
    setHoverDate(null)
    setOpen(false)
  }
  const setLastMonth = () => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    onChange?.({ from: fmtISO(first), to: fmtISO(last) })
    setHoverDate(null)
    setOpen(false)
  }

  // Preview range khi hover (chỉ khi đang có from mà chưa có to)
  const previewFrom = value?.from
  const previewTo = (value?.from && !value?.to && hoverDate && hoverDate >= value.from)
    ? hoverDate
    : value?.to

  const triggerLabel = formatTriggerLabel(value)

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button type="button" onClick={() => open ? setOpen(false) : openPopup()}
        disabled={disabled}
        className={`w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm text-left
          hover:border-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none
          disabled:bg-gray-50 disabled:text-gray-400 flex items-center gap-2 ${open ? 'border-blue-500 ring-2 ring-blue-200' : ''}`}>
        <span className="text-gray-400">📅</span>
        {triggerLabel ? (
          <span className="flex-1 truncate text-gray-800 tabular-nums">{triggerLabel}</span>
        ) : (
          <span className="flex-1 truncate text-gray-400 italic">{placeholder}</span>
        )}
        {(value?.from || value?.to) && (
          <span
            onClick={(e) => { e.stopPropagation(); clearRange() }}
            className="text-gray-400 hover:text-rose-600 text-xs w-5 h-5 rounded flex items-center justify-center hover:bg-rose-50"
            title="Xóa lọc ngày">
            ×
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 right-0
                        rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden
                        animate-slide-down">
          <div className="flex">
            {isDesktop && (
              <MonthPane
                year={leftMonthYm.year} month={leftMonthYm.month}
                from={value?.from} to={previewTo}
                onPick={handlePick} onHover={setHoverDate}
                onPrev={prevMonth}
                showLeftBtn
              />
            )}
            <MonthPane
              year={viewYear} month={viewMonth}
              from={value?.from} to={previewTo}
              onPick={handlePick} onHover={setHoverDate}
              onNext={nextMonth}
              onPrev={isDesktop ? undefined : prevMonth}
              showRightBtn
            />
          </div>

          {/* Footer shortcuts */}
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center gap-1.5 text-[11px]">
            <button type="button" onClick={setToday}
              className="px-2 py-1 rounded-md bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300">
              Hôm nay
            </button>
            <button type="button" onClick={setThisMonth}
              className="px-2 py-1 rounded-md bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300">
              Tháng này
            </button>
            <button type="button" onClick={setLastMonth}
              className="px-2 py-1 rounded-md bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300">
              Tháng trước
            </button>
            <div className="flex-1" />
            {(value?.from || value?.to) && (
              <button type="button" onClick={clearRange}
                className="px-2 py-1 rounded-md text-rose-600 hover:bg-rose-50">
                Xóa
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)}
              className="px-2 py-1 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700">
              Đóng
            </button>
          </div>
        </div>
      )}
      <style>{`
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-down { animation: slide-down 0.14s ease-out; }
      `}</style>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  MonthPane
// ══════════════════════════════════════════════════════════════

function MonthPane({ year, month, from, to, onPick, onHover, onPrev, onNext, showLeftBtn, showRightBtn }) {
  const cells = useMemo(() => buildGrid(year, month), [year, month])
  const todayISO = fmtISO(new Date())

  return (
    <div className="p-3 border-r last:border-r-0 border-gray-100" style={{ minWidth: 280 }}>
      {/* Header: prev - title - next */}
      <div className="flex items-center justify-between mb-2">
        {showLeftBtn || onPrev ? (
          <button type="button" onClick={onPrev}
            className="w-7 h-7 rounded-md hover:bg-gray-100 text-gray-600 flex items-center justify-center">
            ‹
          </button>
        ) : <div className="w-7 h-7" />}
        <div className="text-sm font-bold text-gray-800">
          {MONTHS_VI[month]} {year}
        </div>
        {showRightBtn || onNext ? (
          <button type="button" onClick={onNext}
            className="w-7 h-7 rounded-md hover:bg-gray-100 text-gray-600 flex items-center justify-center">
            ›
          </button>
        ) : <div className="w-7 h-7" />}
      </div>

      {/* Weekdays */}
      <div className="grid grid-cols-7 gap-1 text-[10px] text-gray-500 font-semibold mb-1">
        {WEEKDAYS.map(d => <div key={d} className="text-center">{d}</div>)}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          const iso = fmtISO(c.date)
          const isOtherMonth = c.date.getMonth() !== month
          const isFrom = from && iso === from
          const isTo = to && iso === to
          const inRange = from && to && iso >= from && iso <= to
          const isToday = iso === todayISO

          let cls = 'h-8 rounded-md text-xs font-medium transition select-none'
          if (isFrom || isTo) {
            cls += ' bg-blue-600 text-white shadow-md z-10 relative'
          } else if (inRange) {
            cls += ' bg-blue-100 text-blue-800'
          } else if (isOtherMonth) {
            cls += ' text-gray-300 hover:bg-gray-50'
          } else if (isToday) {
            cls += ' bg-blue-50 text-blue-700 ring-1 ring-blue-300'
          } else {
            cls += ' text-gray-700 hover:bg-gray-100'
          }

          return (
            <button key={i} type="button"
              onClick={() => onPick(iso)}
              onMouseEnter={() => onHover?.(iso)}
              onMouseLeave={() => onHover?.(null)}
              className={cls}>
              {c.date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════

/** Grid 42 ô (6×7), bắt đầu Thứ 2. */
function buildGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1)
  const dow = (firstOfMonth.getDay() + 6) % 7 // T2=0..CN=6
  const start = new Date(year, month, 1 - dow)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push({ date: d })
  }
  return cells
}

function fmtISO(d) {
  if (!d) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseISO(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}

function fmtDDMMYYYY(iso) {
  const d = parseISO(iso)
  if (!d) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

function formatTriggerLabel(value) {
  const from = fmtDDMMYYYY(value?.from)
  const to = fmtDDMMYYYY(value?.to)
  if (from && to) return `${from} — ${to}`
  if (from) return `${from} — …`
  if (to) return `… — ${to}`
  return ''
}