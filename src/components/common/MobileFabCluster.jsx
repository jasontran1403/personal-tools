import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Cụm nút nổi (FAB) cho MOBILE — chỉ hiện dưới breakpoint lg.
 *
 * - Mặc định nằm góc phải dưới, KÉO ĐƯỢC đi bất kỳ đâu qua tay cầm ⠿.
 * - Vị trí được nhớ trong localStorage theo `storageKey`.
 * - children = các nút FAB (dùng <Fab/> bên dưới hoặc tự truyền).
 *
 * Desktop/laptop: component tự ẩn (lg:hidden) nên không ảnh hưởng layout cũ.
 *
 * ── 2026-11-15: portal ra document.body ────────────────────────────────
 * Trước đây render inline. Khi cụm FAB nằm BÊN TRONG 1 ancestor có `transform`
 * (VD slider "Vé máy bay ⟷ Quản lý hóa đơn" ở VmbPage dùng translateX), thì
 * `position: fixed` lại bị neo theo ancestor transform đó → nút bị "trôi" sang
 * nửa kia (biến mất khỏi tab Vé máy bay, lọt vào trang Quản lý hóa đơn).
 * Giải pháp: portal thẳng ra <body> để `fixed` luôn neo theo viewport.
 *
 * ── prop `hidden` ──
 * Cho phép cha tạm ẩn cụm FAB (VD khi đã trượt sang trang Quản lý hóa đơn,
 * không muốn FAB của tab vé đè lên).
 */
export default function MobileFabCluster({ children, storageKey = 'fabPos', hidden = false }) {
  const ref = useRef(null)
  const latest = useRef(null)
  const drag = useRef(null)
  const [pos, setPos] = useState(() => {
    try { const s = localStorage.getItem(storageKey); if (s) return JSON.parse(s) } catch { /* ignore */ }
    return null // null → dùng vị trí mặc định (góc phải dưới)
  })

  const onDown = (e) => {
    const el = ref.current; if (!el) return
    const r = el.getBoundingClientRect()
    drag.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, w: r.width, h: r.height, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => {
    const d = drag.current; if (!d) return
    const maxX = window.innerWidth - d.w - 6
    const maxY = window.innerHeight - d.h - 6
    const left = Math.max(6, Math.min(d.ox + (e.clientX - d.sx), maxX))
    const top  = Math.max(6, Math.min(d.oy + (e.clientY - d.sy), maxY))
    d.moved = true
    const p = { left, top }
    latest.current = p
    setPos(p)
  }
  const onUp = () => {
    const d = drag.current; drag.current = null
    if (d && d.moved && latest.current) {
      try { localStorage.setItem(storageKey, JSON.stringify(latest.current)) } catch { /* ignore */ }
    }
  }

  if (hidden) return null

  const style = pos
    ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' }
    : { right: 16, bottom: 24 }

  return createPortal(
    // class `vmb-fab`: cho phép ẩn cụm FAB bằng CSS khi body có class
    //   `vmb-invoices-open` (VmbPage bật khi trượt sang trang Quản lý hóa đơn).
    //   → không phụ thuộc việc patch prop `hidden` vào TicketsTab.
    <div ref={ref} style={style}
      className="vmb-fab fixed z-40 lg:hidden flex flex-col items-center gap-3">
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        title="Kéo để di chuyển"
        className="w-10 h-5 flex items-center justify-center text-gray-400 cursor-grab active:cursor-grabbing
                   select-none [touch-action:none] rounded bg-white/70 shadow-sm">
        ⠿
      </div>
      {children}
    </div>,
    document.body
  )
}

/**
 * Nút FAB tròn dùng trong cụm. `tone` quyết định màu.
 */
export function Fab({ tone = 'blue', onClick, title, children }) {
  const TONES = {
    blue:    'bg-blue-600 text-white text-xl',
    filter:  'bg-gradient-to-br from-blue-600 to-indigo-600 text-white text-xl',
    add:     'bg-blue-600 text-white text-2xl',
    sum:     'bg-sky-500 text-white text-xl',
    export:  'bg-emerald-600 text-white text-xl',
    toggle:  'bg-white text-blue-700 border-2 border-blue-600 text-sm font-extrabold',
  }
  return (
    <button type="button" onClick={onClick} title={title}
      className={`w-[52px] h-[52px] rounded-full shadow-lg shadow-black/20 flex items-center
                  justify-center active:scale-95 transition ${TONES[tone] || TONES.blue}`}>
      {children}
    </button>
  )
}
