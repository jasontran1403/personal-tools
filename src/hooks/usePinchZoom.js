import { useEffect, useRef } from 'react'

/**
 * Các MỨC zoom cố định cho lưới ảnh — số ảnh trên một dòng.
 * Phóng to nhất = 1 ảnh/dòng; thu nhỏ nhất = 32 ảnh/dòng.
 *   1 → 3 → 5 → 15 → 32
 * Giống ứng dụng Ảnh của iPhone: chụm/xòe sẽ NHẢY giữa các mức này, không phải
 * đổi từng cột một.
 */
export const ZOOM_LEVELS = [1, 3, 5, 15, 32]

/** Mức gần nhất với một số cột bất kỳ (dùng khi đọc giá trị đã lưu / lúc pinch) */
export function snapToLevel(cols, levels = ZOOM_LEVELS) {
  let best = levels[0], bestD = Infinity
  for (const l of levels) {
    const d = Math.abs(l - cols)
    if (d < bestD) { bestD = d; best = l }
  }
  return best
}

/** Chỉ số của mức gần nhất trong mảng ZOOM_LEVELS */
export function nearestLevelIndex(cols, levels = ZOOM_LEVELS) {
  let idx = 0, bestD = Infinity
  levels.forEach((l, i) => {
    const d = Math.abs(l - cols)
    if (d < bestD) { bestD = d; idx = i }
  })
  return idx
}

/**
 * Cử chỉ phóng to/thu nhỏ lưới ảnh — kiểu iPhone, NHẢY theo các mức cố định.
 *
 *   • Cảm ứng (iPhone/Android): chạm HAI NGÓN rồi chụm/xòe.
 *   • Máy tính: giữ Ctrl/⌘ và lăn chuột, hoặc chụm trên trackpad.
 *     Lăn chuột THƯỜNG vẫn cuộn trang như cũ.
 *
 * @param opts.columnsRef  ref giữ số cột hiện tại (một giá trị trong ZOOM_LEVELS)
 * @param opts.levelsRef   ref giữ mảng các mức cho phép
 * @param opts.setColumns  hàm cập nhật số cột
 */
export function usePinchZoom(targetRef, { columnsRef, levelsRef, setColumns }) {
  const pinch = useRef(null)          // { startDist, startCols, last }
  const didPinch = useRef(false)      // vừa pinch xong → nuốt "click ma" mở ảnh
  const wheelReadyAt = useRef(0)      // tiết lưu wheel để không nhảy vọt

  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    const dist = t =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const onTouchStart = e => {
      if (e.touches.length === 2) {
        didPinch.current = false
        pinch.current = {
          startDist: dist(e.touches),
          startCols: columnsRef.current,
          last: columnsRef.current,
        }
      } else if (e.touches.length === 1) {
        didPinch.current = false
        pinch.current = null
      }
    }

    const onTouchMove = e => {
      if (!pinch.current || e.touches.length !== 2) return
      e.preventDefault()                       // chặn zoom trang của trình duyệt
      const ratio = dist(e.touches) / pinch.current.startDist
      if (!isFinite(ratio) || ratio <= 0) return
      didPinch.current = true
      // Xòe ra (ratio > 1) → ít cột hơn (ô to hơn) → snap về mức gần nhất
      const desired = pinch.current.startCols / ratio
      const snapped = snapToLevel(desired, levelsRef.current)
      if (snapped !== pinch.current.last) {
        pinch.current.last = snapped
        setColumns(snapped)
      }
    }

    const onTouchEnd = e => {
      if (didPinch.current) e.preventDefault()  // nuốt click tổng hợp sau pinch
      if (e.touches.length < 2) pinch.current = null
      if (e.touches.length === 0) setTimeout(() => { didPinch.current = false }, 0)
    }

    const onWheel = e => {
      if (!e.ctrlKey) return                   // chỉ zoom khi Ctrl/⌘ hoặc pinch trackpad
      e.preventDefault()
      const now = Date.now()
      if (now < wheelReadyAt.current) return
      wheelReadyAt.current = now + 120
      const levels = levelsRef.current
      const idx = nearestLevelIndex(columnsRef.current, levels)
      const dir = e.deltaY < 0 ? -1 : 1        // lăn lên = zoom in = mức nhỏ hơn
      const nextIdx = Math.max(0, Math.min(levels.length - 1, idx + dir))
      setColumns(levels[nextIdx])
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd,   { passive: false })
    el.addEventListener('touchcancel', onTouchEnd,  { passive: false })
    el.addEventListener('wheel',       onWheel,     { passive: false })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel',       onWheel)
    }
  }, [targetRef, columnsRef, levelsRef, setColumns])
}
