import { useState, useRef, useEffect, useCallback } from 'react'

/**
 * Chọn nhiều mục kiểu ứng dụng Ảnh của iPhone, dùng cho cả lưới ảnh và danh sách tệp.
 *
 *   • Nhấn GIỮ một mục (~420ms) → vào chế độ chọn và chọn luôn mục đó.
 *   • Đang ở chế độ chọn:
 *       - Chạm/bấm một mục → bật/tắt chọn mục đó.
 *       - Bấm giữ rồi RÊ qua các mục → quét chọn hàng loạt (như giữ Shift).
 *       - Rê tới mép trên/dưới màn hình → tự cuộn để chọn tiếp các mục xa.
 *
 * Mỗi mục cần thuộc tính data-select-id="<id>" và nằm trong `containerRef`.
 * Khi ở chế độ chọn, đặt style touch-action:none cho container để cú rê là
 * "quét chọn" chứ không phải cuộn trang (việc cuộn do auto-scroll ở mép lo).
 */

const LONG_PRESS_MS  = 420
const MOVE_CANCEL_PX = 10
const EDGE           = 90     // vùng mép (px) để bắt đầu tự cuộn
const MAX_SPEED      = 24     // px mỗi khung hình khi cuộn nhanh nhất

export function useSweepSelect(containerRef) {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected]     = useState(() => new Set())

  const selectModeRef = useRef(false)
  const selectedRef   = useRef(selected)
  selectModeRef.current = selectMode
  selectedRef.current   = selected

  const press   = useRef(null)   // { id, x, y, timer, longFired }
  const sweep   = useRef(null)   // { target:boolean, applied:Set }
  const suppress = useRef(false) // nuốt click mở-mục sau khi giữ/quét
  const point   = useRef({ x: 0, y: 0 })
  const raf      = useRef(0)

  const setSel = useCallback(fn => {
    setSelected(prev => {
      const next = new Set(prev)
      fn(next)
      selectedRef.current = next
      return next
    })
  }, [])

  const applyTo = useCallback((id, on) => {
    setSel(next => { if (on) next.add(id); else next.delete(id) })
  }, [setSel])

  const idUnder = (x, y) => {
    const el = document.elementFromPoint(x, y)
    const node = el && el.closest ? el.closest('[data-select-id]') : null
    return node ? node.getAttribute('data-select-id') : null
  }

  const stopScroll = () => { if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0 } }

  const tick = useCallback(() => {
    raf.current = 0
    if (!sweep.current) return
    const { x, y } = point.current
    const h = window.innerHeight
    let dy = 0
    if (y < EDGE)          dy = -Math.ceil(MAX_SPEED * (1 - y / EDGE))
    else if (y > h - EDGE) dy =  Math.ceil(MAX_SPEED * (1 - (h - y) / EDGE))
    if (dy !== 0) {
      window.scrollBy(0, dy)
      const id = idUnder(x, y)
      if (id && !sweep.current.applied.has(id)) {
        sweep.current.applied.add(id)
        applyTo(id, sweep.current.target)
      }
      raf.current = requestAnimationFrame(tick)
    }
  }, [applyTo])

  const maybeScroll = useCallback(() => {
    const { y } = point.current
    const h = window.innerHeight
    if ((y < EDGE || y > h - EDGE) && !raf.current) raf.current = requestAnimationFrame(tick)
  }, [tick])

  useEffect(() => {
    // Gắn vào window (không phải container) để không phụ thuộc container đã mount
    // hay chưa; lọc theo data-select-id nên chỉ phản ứng với các mục chọn được.
    const onDown = e => {
      if (typeof e.button === 'number' && e.button !== 0) return
      const node = e.target.closest ? e.target.closest('[data-select-id]') : null
      const id = node ? node.getAttribute('data-select-id') : null
      suppress.current = false
      if (!id) return
      point.current = { x: e.clientX, y: e.clientY }

      if (selectModeRef.current) {
        // Chặn bôi đen/kéo mặc định của chuột để cú kéo là "quét chọn"
        if (e.pointerType === 'mouse' && e.cancelable) e.preventDefault()
        const on = !selectedRef.current.has(id)
        sweep.current = { target: on, applied: new Set([id]) }
        applyTo(id, on)
        suppress.current = true
      } else {
        press.current = {
          id, x: e.clientX, y: e.clientY, longFired: false,
          timer: setTimeout(() => {
            if (press.current) press.current.longFired = true
            setSelectMode(true); selectModeRef.current = true
            setSel(next => next.add(id))
            sweep.current = { target: true, applied: new Set([id]) }
            suppress.current = true
          }, LONG_PRESS_MS),
        }
      }
    }

    const onMove = e => {
      point.current = { x: e.clientX, y: e.clientY }
      if (press.current && !press.current.longFired) {
        const dx = e.clientX - press.current.x, dy = e.clientY - press.current.y
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) { clearTimeout(press.current.timer); press.current = null }
      }
      if (sweep.current) {
        if (e.cancelable) e.preventDefault()
        const id = idUnder(e.clientX, e.clientY)
        if (id && !sweep.current.applied.has(id)) {
          sweep.current.applied.add(id)
          applyTo(id, sweep.current.target)
        }
        maybeScroll()
      }
    }

    const onUp = () => {
      if (press.current) { clearTimeout(press.current.timer); press.current = null }
      sweep.current = null
      stopScroll()
    }

    window.addEventListener('pointerdown', onDown, { passive: false })
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      stopScroll()
    }
  }, [applyTo, setSel, maybeScroll])

  const exit = useCallback(() => {
    setSelectMode(false); selectModeRef.current = false
    const empty = new Set(); setSelected(empty); selectedRef.current = empty
  }, [])

  // "Bỏ chọn tất cả": xóa hết lựa chọn nhưng VẪN ở chế độ chọn (để chọn lại).
  const justCleared = useRef(false)
  const clearStay = useCallback(() => {
    justCleared.current = true
    const s = new Set(); setSelected(s); selectedRef.current = s
  }, [])

  // Bỏ chọn dần bằng thao tác (chạm/quét) tới khi hết → tự thoát chế độ chọn.
  // Nhấn "Bỏ chọn tất cả" thì KHÔNG thoát (nhờ cờ justCleared).
  useEffect(() => {
    if (justCleared.current) { justCleared.current = false; return }
    if (selectModeRef.current && selected.size === 0) {
      setSelectMode(false); selectModeRef.current = false
    }
  }, [selected])

  const clear      = useCallback(() => { const s = new Set(); setSelected(s); selectedRef.current = s }, [])
  const toggle     = useCallback(id => applyTo(String(id), !selectedRef.current.has(String(id))), [applyTo])
  const isSelected = useCallback(id => selected.has(String(id)), [selected])
  const consumeClick = useCallback(() => { const s = suppress.current; suppress.current = false; return s }, [])

  return { selectMode, selected, count: selected.size, isSelected, toggle, clear, clearStay, exit, consumeClick }
}