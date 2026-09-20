import { useEffect, useRef, useState } from 'react'
import { vmbFileUrl } from '../../services/api'

/**
 * Full-screen preview có zoom + rotate cho ẢNH và PDF.
 *
 * Props:
 *   filePath  — path tương đối như "/vmb-files/xxx.png" (BẮT BUỘC)
 *   fileName  — dùng để đoán loại (pdf vs image) và hiển thị (không bắt buộc)
 *   title     — tiêu đề toolbar
 *   onClose   — đóng preview
 *   onBack    — optional back button
 *   embedded  — nếu true thì render inline không full-screen (dùng cho panel bên
 *               trong modal khác)
 *
 * ── Phím tắt ──────────────────────────────────────────────
 *   +/=     zoom in
 *   -       zoom out
 *   0       reset zoom + rotate + pan về 0
 *   r       xoay 90° (cùng chiều kim đồng hồ)
 *   Esc     đóng
 *
 * ── Auth (2026-09-15) ────────────────────────────────────
 * Endpoint /vmb-files/** giờ PUBLIC (xem SecurityConfiguration ở BE). Không
 * cần fetch qua axios rồi tạo blob URL nữa — dùng thẳng URL cho <img>/<iframe>.
 * Đơn giản hơn nhiều so với bản cũ và tránh được vấn đề token bị đính sai
 * scope đã gây lỗi "signature does not match".
 */
export default function ZoomablePreview({ filePath, fileName, title, onClose, onBack, embedded = false }) {
  const isPdf = (fileName || filePath || '').toLowerCase().endsWith('.pdf')
  const src = filePath ? vmbFileUrl(filePath) : ''

  const [scale, setScale] = useState(1)
  const [rotate, setRotate] = useState(0)
  const [pan, setPan]     = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)

  const zoomIn  = () => setScale(s => Math.min(6, s * 1.2))
  const zoomOut = () => setScale(s => Math.max(0.15, s / 1.2))
  const rotateCW  = () => setRotate(r => (r + 90) % 360)
  const rotateCCW = () => setRotate(r => (r + 270) % 360)
  const reset = () => { setScale(1); setRotate(0); setPan({ x: 0, y: 0 }) }

  useEffect(() => {
    if (embedded) return
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'Escape' && onClose) onClose()
      else if (e.key === '+' || e.key === '=') zoomIn()
      else if (e.key === '-')       zoomOut()
      else if (e.key === '0')       reset()
      else if (e.key === 'r' || e.key === 'R') rotateCW()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  const onWheel = (e) => {
    if (isPdf) return
    e.preventDefault()
    setScale(s => {
      const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1
      return Math.max(0.15, Math.min(6, s * delta))
    })
  }

  const onMouseDown = (e) => {
    if (isPdf || scale <= 1) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan }
    e.preventDefault()
  }
  const onMouseMove = (e) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setPan({ x: dragRef.current.startPan.x + dx, y: dragRef.current.startPan.y + dy })
  }
  const onMouseUp = () => { dragRef.current = null }

  const wrapCls = embedded
    ? 'flex flex-col w-full h-full bg-black/85'
    : 'fixed inset-0 z-[100] bg-black/85 flex flex-col'

  return (
    <div className={wrapCls}
      onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-black/60 text-white shrink-0 flex-wrap">
        {onBack && (
          <button onClick={onBack}
            className="px-2.5 py-1 rounded-md text-xs bg-white/10 hover:bg-white/20">
            ← Đổi loại
          </button>
        )}
        <div className="flex-1 min-w-0 text-sm font-semibold truncate">{title}</div>

        <div className="flex items-center gap-1">
          <button onClick={zoomOut} title="Thu nhỏ (−)"
            className="w-8 h-8 rounded-md bg-white/10 hover:bg-white/20 font-bold text-lg">−</button>
          <span className="min-w-[50px] text-center font-mono text-xs tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <button onClick={zoomIn} title="Phóng to (+)"
            className="w-8 h-8 rounded-md bg-white/10 hover:bg-white/20 font-bold text-lg">+</button>
        </div>

        <div className="flex items-center gap-1 ml-1 pl-2 border-l border-white/20">
          <button onClick={rotateCCW} title="Xoay trái 90°"
            className="w-8 h-8 rounded-md bg-white/10 hover:bg-white/20 text-sm">↺</button>
          <button onClick={rotateCW} title="Xoay phải 90° (R)"
            className="w-8 h-8 rounded-md bg-white/10 hover:bg-white/20 text-sm">↻</button>
          {rotate !== 0 && (
            <span className="text-[10px] font-mono text-white/60 min-w-[36px] text-center">
              {rotate}°
            </span>
          )}
        </div>

        <button onClick={reset} title="Đưa về ban đầu (0)"
          className="ml-1 px-2 h-8 rounded-md bg-white/10 hover:bg-white/20 text-xs">Reset</button>
        {onClose && !embedded && (
          <button onClick={onClose} title="Đóng (Esc)"
            className="ml-2 w-8 h-8 rounded-md bg-white/10 hover:bg-white/20 text-lg font-bold">×</button>
        )}
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-hidden flex items-center justify-center select-none"
        onWheel={onWheel}>
        {!src ? (
          <div className="text-white/60 text-sm">Không có file để hiển thị</div>
        ) : isPdf ? (
          <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
            <div style={{
              width: embedded ? '95%' : '80vw',
              height: embedded ? '90%' : '85vh',
              transform: `rotate(${rotate}deg) scale(${scale})`,
              transformOrigin: 'center center',
              transition: dragRef.current ? 'none' : 'transform 0.15s ease',
            }}>
              <iframe src={src} title={title}
                className="w-full h-full bg-white rounded shadow-2xl"
                style={{ border: 0 }} />
            </div>
          </div>
        ) : (
          <img src={src} alt={title}
            draggable={false}
            onMouseDown={onMouseDown}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) rotate(${rotate}deg)`,
              transformOrigin: 'center center',
              cursor: scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'default',
              maxWidth: rotate % 180 === 0 ? '95%' : '85%',
              maxHeight: rotate % 180 === 0 ? '85%' : '85%',
              transition: dragRef.current ? 'none' : 'transform 0.15s ease',
            }}
          />
        )}
      </div>

      {!embedded && src && (
        <div className="px-4 py-1.5 bg-black/60 text-white/60 text-[11px] text-center shrink-0">
          {isPdf
            ? 'Nút +/− để zoom · ↺/↻ để xoay · Phím R để xoay · 0 để reset · Esc để đóng'
            : 'Cuộn chuột để zoom · Kéo để di chuyển khi đã zoom · Phím +/−/R/0/Esc'}
        </div>
      )}
    </div>
  )
}