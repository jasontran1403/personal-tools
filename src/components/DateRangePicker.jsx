import { useState, useEffect, useRef } from 'react'
import { todayVN } from '../utils/format'

const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12']
const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

/** Chọn khoảng ngày. onChange(fromDate, toDate) — định dạng YYYY-MM-DD */
export default function DateRangePicker({ fromDate, toDate, onChange }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(null)
  const [selecting, setSelecting] = useState(null)
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const ref = useRef()

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const parseD = s => s ? new Date(s + 'T00:00:00') : null

  // Dùng getFullYear/getMonth/getDate thay vì toISOString() để tránh lệch UTC
  const toStr = d => {
    if (!d) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
  const firstDOW = (y, m) => new Date(y, m, 1).getDay()

  const isBetween = (d, a, b) => {
    if (!a || !b) return false
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    return d > lo && d < hi
  }

  const clickDay = (d) => {
    const ds = toStr(d)
    if (!selecting) {
      setSelecting(ds)
      onChange(ds, ds)
    } else {
      const [lo, hi] = selecting <= ds ? [selecting, ds] : [ds, selecting]
      onChange(lo, hi)
      setSelecting(null)
      setOpen(false)
    }
  }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const from = parseD(fromDate)
  const to = parseD(toDate)
  const sel = selecting ? parseD(selecting) : null
  const hov = hovered ? parseD(hovered) : null

  const totalDays = daysInMonth(viewYear, viewMonth)
  const startDOW = firstDOW(viewYear, viewMonth)
  const cells = []
  for (let i = 0; i < startDOW; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(new Date(viewYear, viewMonth, d))

  const label = fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`

  const dayCls = (d) => {
    if (!d) return ''
    const ds = toStr(d)
    const isFrom = fromDate === ds
    const isTo = toDate === ds
    const isSel = selecting === ds
    const isInRange = !selecting
      ? (from && to && isBetween(d, from, to))
      : (sel && hov && isBetween(d, sel, hov))
    const isHov = hovered === ds

    let cls = 'w-8 h-8 flex items-center justify-center text-xs rounded-full cursor-pointer select-none transition-colors '
    if (isFrom || isTo || isSel) cls += 'bg-blue-600 text-white font-semibold '
    else if (isInRange) cls += 'bg-blue-100 text-blue-800 rounded-none '
    else if (isHov) cls += 'bg-gray-100 '
    else cls += 'hover:bg-gray-100 text-gray-700 '
    return cls
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:border-blue-400 transition-colors shadow-sm"
      >
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="font-medium">{label}</span>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-11 left-0 z-50 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 w-72">
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 transition-colors">
              ‹
            </button>
            <span className="text-sm font-semibold text-gray-800">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button onClick={nextMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600 transition-colors">
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((d, i) => (
              <div key={i} className="flex items-center justify-center">
                {d ? (
                  <div
                    className={dayCls(d)}
                    onClick={() => clickDay(d)}
                    onMouseEnter={() => setHovered(toStr(d))}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {d.getDate()}
                  </div>
                ) : <div className="w-8 h-8" />}
              </div>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1.5">
            {[
              { l: 'Hôm nay', fn: () => { const t = todayVN(); onChange(t, t); setOpen(false) } },
              {
                l: '7 ngày', fn: () => {
                  const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 6)
                  onChange(toStr(f), toStr(t)); setOpen(false)
                }
              },
              {
                l: '30 ngày', fn: () => {
                  const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 29)
                  onChange(toStr(f), toStr(t)); setOpen(false)
                }
              },
              {
                l: 'Tháng này', fn: () => {
                  const t = new Date()
                  const f = new Date(t.getFullYear(), t.getMonth(), 1)
                  onChange(toStr(f), toStr(t)); setOpen(false)
                }
              },
            ].map(({ l, fn }) => (
              <button key={l} onClick={fn}
                className="px-2.5 py-1 text-xs rounded-md bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                {l}
              </button>
            ))}
          </div>

          {selecting && (
            <p className="mt-2 text-xs text-blue-600 text-center">Chọn ngày kết thúc...</p>
          )}
        </div>
      )}
    </div>
  )
}
