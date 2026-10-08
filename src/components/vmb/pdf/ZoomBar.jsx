/**
 * ZoomBar — nhóm 3 nút zoom in / zoom out / reset-to-fit + hiển thị % hiện tại.
 *
 * Props:
 *   zoom      — số thực. 1 = fit page.
 *   onZoom    — (next: number) => void
 *   minZoom, maxZoom — chặn range (default 0.3 → 4)
 *   step      — mức nhân/chia khi bấm (default 1.25)
 */
export default function ZoomBar({ zoom, onZoom, minZoom = 0.3, maxZoom = 4, step = 1.25 }) {
  const zIn    = () => onZoom(Math.min(maxZoom, zoom * step))
  const zOut   = () => onZoom(Math.max(minZoom, zoom / step))
  const zReset = () => onZoom(1)
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-white border border-gray-300 overflow-hidden">
      <button type="button" onClick={zOut} title="Thu nhỏ"
        className="px-2 py-1 text-sm font-bold text-gray-700 hover:bg-gray-100">−</button>
      <button type="button" onClick={zReset} title="Fit page"
        className="px-2 py-1 text-[11px] font-mono tabular-nums text-gray-700 hover:bg-gray-100
          min-w-[48px] border-x border-gray-200">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={zIn} title="Phóng to"
        className="px-2 py-1 text-sm font-bold text-gray-700 hover:bg-gray-100">+</button>
      <button type="button" onClick={zReset} title="Trả về fit page"
        className="px-2 py-1 text-xs text-gray-500 hover:text-blue-700 hover:bg-blue-50
          border-l border-gray-200">
        ⤢
      </button>
    </div>
  )
}