import { useState, useMemo, useEffect, useRef } from 'react'

/**
 * DateTimePicker chuyên nghiệp — 2 pane: lịch (trái) + đồng hồ (phải).
 *
 * Props:
 *   value    — Date | null | number (ms)
 *   onChange — (Date) => void
 *   minDate  — Date | null — cấm chọn trước ngày này
 *
 * UX:
 *   - Lịch: header có prev/next tháng, grid 6×7, click ngày để chọn.
 *   - Đồng hồ: 2 vòng — giờ (0-23) và phút (0-59), click hoặc kéo để chọn.
 *     Số giờ/phút hiện tại hiển thị to ở giữa; có thể click để nhập trực tiếp.
 *   - Ngày/giờ tổ hợp thành Date object 1 chiều — mỗi lần đổi 1 trong 2
 *     phần đều emit onChange.
 *
 * Không dùng thư viện ngoài — chỉ CSS + React state.
 */
export default function DateTimePicker({ value, onChange, minDate }) {
  const initial = normalize(value)
  const [current, setCurrent] = useState(initial || new Date())

  // Sync khi prop value đổi (VD parent set lại)
  useEffect(() => {
    const v = normalize(value)
    if (v) setCurrent(v)
  }, [value])

  const emit = (d) => {
    setCurrent(d)
    onChange?.(d)
  }

  const setDate = (y, m, d) => {
    const next = new Date(current)
    next.setFullYear(y); next.setMonth(m); next.setDate(d)
    // Nếu trước minDate → clip
    if (minDate && next < new Date(minDate)) {
      const clipped = new Date(minDate)
      emit(clipped); return
    }
    emit(next)
  }
  const setHour   = (h) => { const n = new Date(current); n.setHours(h);   emit(n) }
  const setMinute = (m) => { const n = new Date(current); n.setMinutes(m); emit(n) }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-xl border border-gray-200 bg-white">
      {/* Lịch */}
      <CalendarPane current={current} onPick={setDate} minDate={minDate} />
      {/* Đồng hồ */}
      <ClockPane current={current} onHour={setHour} onMinute={setMinute} />
    </div>
  )
}

function normalize(v) {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') return new Date(v)
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d }
  return null
}

// ═══════════════════════════════════════════════════════════════
//  CALENDAR
// ═══════════════════════════════════════════════════════════════

function CalendarPane({ current, onPick, minDate }) {
  const [viewYm, setViewYm] = useState({ y: current.getFullYear(), m: current.getMonth() })

  useEffect(() => {
    // Khi đổi tháng qua Date đã chọn → cập nhật viewYm
    setViewYm({ y: current.getFullYear(), m: current.getMonth() })
    // eslint-disable-next-line
  }, [current.getFullYear(), current.getMonth()])

  const prev = () => setViewYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))
  const next = () => setViewYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))

  const grid = useMemo(() => buildMonthGrid(viewYm.y, viewYm.m), [viewYm])
  const min = minDate ? new Date(minDate) : null
  const minMs = min ? new Date(min.getFullYear(), min.getMonth(), min.getDate()).getTime() : 0
  const today = new Date()
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const selMs = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()

  const monthLabel = new Date(viewYm.y, viewYm.m, 1)
    .toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prev}
          className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-600 flex items-center justify-center">‹</button>
        <div className="text-sm font-bold text-gray-800 capitalize">{monthLabel}</div>
        <button type="button" onClick={next}
          className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-600 flex items-center justify-center">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] text-gray-500 font-semibold mb-1">
        {['T2','T3','T4','T5','T6','T7','CN'].map(d => (
          <div key={d} className="text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map((day, i) => {
          const dMs = new Date(day.y, day.m, day.d).getTime()
          const disabled = min && dMs < minMs
          const isSelected = dMs === selMs
          const isToday = dMs === todayMs
          const isOtherMonth = day.m !== viewYm.m
          return (
            <button key={i} type="button"
              disabled={disabled}
              onClick={() => onPick(day.y, day.m, day.d)}
              className={`
                h-9 rounded-lg text-xs font-medium transition
                ${isSelected
                  ? 'bg-blue-600 text-white shadow-md'
                  : isToday
                    ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-300'
                    : isOtherMonth
                      ? 'text-gray-300 hover:bg-gray-50'
                      : 'text-gray-700 hover:bg-gray-100'
                }
                ${disabled ? 'opacity-30 cursor-not-allowed' : ''}
              `}>
              {day.d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Trả về mảng 42 ô (6 tuần × 7 ngày), bắt đầu từ Thứ 2. */
function buildMonthGrid(y, m) {
  const firstOfMonth = new Date(y, m, 1)
  // JS: getDay() → 0=CN, 1=T2, ... 6=T7. Chuẩn hoá về T2=0:
  const dow = (firstOfMonth.getDay() + 6) % 7
  const start = new Date(y, m, 1 - dow)
  const out = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    out.push({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() })
  }
  return out
}

// ═══════════════════════════════════════════════════════════════
//  CLOCK — 2 vòng số: giờ (24h) + phút (0-59, chọn theo mốc 5 phút)
// ═══════════════════════════════════════════════════════════════

function ClockPane({ current, onHour, onMinute }) {
  const h = current.getHours()
  const m = current.getMinutes()
  const [mode, setMode] = useState('hour') // 'hour' | 'minute'

  return (
    <div className="p-2 flex flex-col items-center">
      {/* Digital display */}
      <div className="flex items-baseline gap-1 mb-3 font-mono">
        <button type="button" onClick={() => setMode('hour')}
          className={`text-4xl font-bold px-2 rounded transition ${
            mode === 'hour' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
          }`}>
          {String(h).padStart(2, '0')}
        </button>
        <span className="text-4xl font-bold text-gray-400">:</span>
        <button type="button" onClick={() => setMode('minute')}
          className={`text-4xl font-bold px-2 rounded transition ${
            mode === 'minute' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
          }`}>
          {String(m).padStart(2, '0')}
        </button>
      </div>

      {/* Analog clock */}
      <ClockFace mode={mode} value={mode === 'hour' ? h : m} onSelect={mode === 'hour' ? onHour : onMinute} />

      {/* Preset buttons */}
      <div className="mt-3 flex flex-wrap gap-1 justify-center">
        {mode === 'hour'
          ? [8, 9, 10, 12, 14, 16, 17, 18].map(hh => (
              <button key={hh} type="button" onClick={() => onHour(hh)}
                className={`text-[11px] px-2 py-0.5 rounded ${
                  hh === h ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}>
                {hh}h
              </button>
            ))
          : [0, 15, 30, 45].map(mm => (
              <button key={mm} type="button" onClick={() => onMinute(mm)}
                className={`text-[11px] px-2 py-0.5 rounded ${
                  mm === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}>
                :{String(mm).padStart(2, '0')}
              </button>
            ))
        }
      </div>
    </div>
  )
}

function ClockFace({ mode, value, onSelect }) {
  // 12 mốc chính (giờ) hoặc 12 mốc phút (0/5/10/…/55)
  const marks = mode === 'hour'
    ? Array.from({ length: 12 }, (_, i) => i === 0 ? 12 : i) // 12, 1..11
    : Array.from({ length: 12 }, (_, i) => i * 5)             // 0, 5, 10, ...

  const size = 180
  const cx = size / 2, cy = size / 2
  const rMark = size / 2 - 18
  const rHand = rMark - 10

  // Góc tính từ 12h chiều (top) clockwise
  const angleFor = (v) => {
    if (mode === 'hour') return ((v % 12) / 12) * 2 * Math.PI - Math.PI / 2
    return (v / 60) * 2 * Math.PI - Math.PI / 2
  }

  const handAngle = angleFor(value)
  const handX = cx + Math.cos(handAngle) * rHand
  const handY = cy + Math.sin(handAngle) * rHand

  // Click on SVG → tính góc → giá trị
  const svgRef = useRef(null)
  const handleClick = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - cx
    const y = e.clientY - rect.top - cy
    let angle = Math.atan2(y, x) + Math.PI / 2
    if (angle < 0) angle += 2 * Math.PI
    if (mode === 'hour') {
      let hh = Math.round((angle / (2 * Math.PI)) * 12)
      if (hh === 0) hh = 12
      // Nếu đang ở AM (0-11) và click ra số ngoài, giữ AM. Simplify: pick nearest hour but keep AM/PM based on current value >=12
      if (value >= 12) hh = (hh === 12) ? 12 : hh + 12
      else hh = (hh === 12) ? 0 : hh
      onSelect(hh)
    } else {
      const mm = Math.round((angle / (2 * Math.PI)) * 60) % 60
      onSelect(mm)
    }
  }

  return (
    <div>
      <svg ref={svgRef} width={size} height={size} onClick={handleClick}
        className="cursor-pointer select-none">
        {/* face bg */}
        <circle cx={cx} cy={cy} r={size / 2 - 4} fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="2" />
        {/* marks */}
        {marks.map((mk, i) => {
          const a = angleFor(mode === 'hour' ? (mk === 12 ? 0 : mk) : mk)
          const x = cx + Math.cos(a) * rMark
          const y = cy + Math.sin(a) * rMark
          const isActive = mode === 'hour'
            ? (value % 12 === mk % 12)
            : (Math.abs(value - mk) < 3)
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={12}
                fill={isActive ? '#2563EB' : 'transparent'}
                className="transition-colors" />
              <text x={x} y={y + 4} textAnchor="middle"
                className="text-xs font-semibold pointer-events-none"
                fill={isActive ? 'white' : '#334155'}>
                {mode === 'hour' ? mk : String(mk).padStart(2, '0')}
              </text>
            </g>
          )
        })}
        {/* hand */}
        <line x1={cx} y1={cy} x2={handX} y2={handY} stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4} fill="#2563EB" />
        <circle cx={handX} cy={handY} r={5} fill="#2563EB" />
      </svg>
      {mode === 'hour' && (
        <div className="text-center text-[10px] text-gray-500 mt-1">
          {value >= 12 ? 'PM' : 'AM'} · click AM/PM để đổi
          <button type="button" onClick={() => onSelect((value + 12) % 24)}
            className="ml-2 text-[10px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200">
            {value >= 12 ? '→ AM' : '→ PM'}
          </button>
        </div>
      )}
    </div>
  )
}