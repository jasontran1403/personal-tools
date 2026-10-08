import { useCallback, useLayoutEffect, useState } from 'react'

/**
 * useContainerSize — theo dõi kích thước client của 1 element.
 *
 * ── Vì sao callback ref thay vì useRef + useLayoutEffect ────
 * Nếu dùng `const ref = useRef(null)` + `useLayoutEffect(..., [ref])`:
 *   - Effect chạy 1 lần ở mount component. Nếu element gắn ref được
 *     render có điều kiện (VD: `{imgEl && <div ref={vp}/>}`) thì ở
 *     lần đầu `ref.current` vẫn null → effect return sớm → size kẹt
 *     ở {0,0} mãi mãi, kể cả khi element xuất hiện sau.
 *
 * Callback ref được React gọi mỗi lần element mount/unmount → ta
 * `setEl(node)` → effect depend vào `el` sẽ chạy lại khi node xuất
 * hiện. Hoạt động cả với element render có điều kiện.
 *
 * API:
 *   const [containerRef, size] = useContainerSize()
 *   <div ref={containerRef}>...</div>
 */
export default function useContainerSize() {
  const [el, setEl] = useState(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const refCb = useCallback((node) => setEl(node), [])

  useLayoutEffect(() => {
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])

  return [refCb, size]
}

/**
 * fitBox — kích thước lớn nhất giữ aspect `naturalW/naturalH` vừa với
 * containerW × containerH, KHÔNG phóng to vượt natural.
 */
export function fitBox(naturalW, naturalH, containerW, containerH) {
  if (!naturalW || !naturalH || !containerW || !containerH) return { w: 0, h: 0 }
  const ar = naturalW / naturalH
  const cAr = containerW / containerH
  let w, h
  if (ar > cAr) { w = containerW; h = containerW / ar }
  else          { h = containerH; w = containerH * ar }
  return { w, h }
}