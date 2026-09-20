import { useEffect, useRef, useState } from 'react'

/**
 * TimePicker — popup 2 cột (giờ / phút) scrollable, không dùng native
 * <input type="time">.
 *
 * Value / onChange dùng chuỗi "HH:mm" (24h, khớp native format). Giờ 00-23,
 * phút 00-59 (đủ mọi lịch bay).
 *
 * Đặt cạnh DatePicker trong RouteInput — cùng phong cách button + popup
 * absolute → UX nhất quán.
 */
export default function TimePicker({
  value = '',
  onChange,
  placeholder = '--:--',
  disabled = false,
  className = '',
  size = 'md',
}) {
  const [open, setOpen] = useState(false)
  const [h, m] = splitHM(value)

  const boxRef = useRef(null)
  const hourColRef = useRef(null)
  const minColRef  = useRef(null)

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

  // Khi mở, cuộn giá trị hiện tại vào tầm nhìn
  useEffect(() => {
    if (!open) return
    setTimeout(() => {
      const scrollTo = (col, val) => {
        if (!col) return
        const el = col.querySelector(`[data-v="${val}"]`)
        if (el) col.scrollTop = el.offsetTop - col.clientHeight / 2 + el.clientHeight / 2
      }
      if (h) scrollTo(hourColRef.current, h)
      if (m) scrollTo(minColRef.current, m)
    }, 0)
  }, [open, h, m])

  const setHour = (nh) => {
    onChange?.(`${nh}:${m || '00'}`)
  }
  const setMin = (nm) => {
    onChange?.(`${h || '00'}:${nm}`)
  }

  const btnPad = size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'
  const displayValue = value && /^\d{2}:\d{2}$/.test(value) ? value : ''

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`w-full ${btnPad} inline-flex items-center gap-2 rounded-lg border border-gray-300
          bg-white text-left tabular-nums transition
          hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none
          disabled:bg-gray-50 disabled:text-gray-400`}
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-gray-500 shrink-0" fill="currentColor">
          <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 14a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm1-9a1 1 0 1 0-2 0v3.586l-2.293 2.293a1 1 0 1 0 1.414 1.414l2.586-2.586A1 1 0 0 0 11 11V7z"/>
        </svg>
        <span className={displayValue ? 'text-gray-900 font-mono' : 'text-gray-400'}>
          {displayValue || placeholder}
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 top-full left-0 bg-white rounded-xl shadow-xl
          border border-gray-200 p-2 animate-[fade-in_.12s_ease] w-40">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase text-center mb-1">Giờ</div>
              <div ref={hourColRef}
                className="h-40 overflow-y-auto scrollbar-thin border border-gray-100 rounded-md">
                {Array.from({ length: 24 }, (_, i) => pad(i)).map(hh => (
                  <button key={hh} type="button" data-v={hh}
                    onClick={() => setHour(hh)}
                    className={`w-full py-1 text-xs tabular-nums font-mono ${
                      hh === h ? 'bg-blue-600 text-white font-bold' : 'text-gray-700 hover:bg-blue-50'
                    }`}>
                    {hh}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase text-center mb-1">Phút</div>
              <div ref={minColRef}
                className="h-40 overflow-y-auto scrollbar-thin border border-gray-100 rounded-md">
                {Array.from({ length: 60 }, (_, i) => pad(i)).map(mm => (
                  <button key={mm} type="button" data-v={mm}
                    onClick={() => setMin(mm)}
                    className={`w-full py-1 text-xs tabular-nums font-mono ${
                      mm === m ? 'bg-blue-600 text-white font-bold' : 'text-gray-700 hover:bg-blue-50'
                    }`}>
                    {mm}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
            <button type="button"
              onClick={() => { onChange?.(''); setOpen(false) }}
              className="text-xs text-rose-600 hover:text-rose-800 font-semibold">
              Xóa
            </button>
            <button type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold">
              Xong
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function pad(n) { return String(n).padStart(2, '0') }

function splitHM(s) {
  if (!s || !/^\d{2}:\d{2}$/.test(s)) return ['', '']
  return s.split(':')
}
