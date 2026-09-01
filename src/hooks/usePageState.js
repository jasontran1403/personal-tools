import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

const STORAGE_KEY = 'invoice:pageState'

/**
 * Giữ state của màn hình hóa đơn (tab đang mở, trang, cửa hàng, khoảng ngày...)
 * trên URL → F5 / mở lại link là khôi phục nguyên trạng.
 *
 * Ngoài ra snapshot vào sessionStorage để khi vào thẳng /orders (không kèm
 * query, ví dụ ngay sau khi đăng nhập) vẫn quay lại đúng chỗ cũ.
 * sessionStorage sẽ bị xóa khi logout (useAuth gọi sessionStorage.clear()).
 *
 * Dùng replace: true để phân trang không làm rác lịch sử trình duyệt.
 */
export function usePageState() {
  const [sp, setSp] = useSearchParams()
  const restored = useRef(false)

  // ── Khôi phục snapshot khi URL chưa có param nào ────────────────
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (sp.toString()) return
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}')
      if (saved && Object.keys(saved).length) {
        setSp(new URLSearchParams(saved), { replace: true })
      }
    } catch { /* bỏ qua, dùng mặc định */ }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lưu lại mỗi khi URL đổi ─────────────────────────────────────
  useEffect(() => {
    const obj = Object.fromEntries(sp.entries())
    if (!Object.keys(obj).length) return
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch { /* bỏ qua */ }
  }, [sp])

  /** Đọc param dạng chuỗi */
  const get = useCallback(
    (key, fallback = '') => sp.get(key) ?? fallback,
    [sp]
  )

  /** Đọc param dạng số nguyên >= 0 */
  const getNum = useCallback((key, fallback = 0) => {
    const n = parseInt(sp.get(key), 10)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }, [sp])

  /**
   * Cập nhật nhiều param một lúc.
   * Giá trị '' / null / undefined → xóa param cho URL gọn.
   * Luôn gộp trong 1 lần gọi để tránh ghi đè lẫn nhau,
   * VD: patch({ store: 3, posPage: 0 })
   */
  const patch = useCallback((next) => {
    const params = new URLSearchParams(sp)
    Object.entries(next).forEach(([k, v]) => {
      if (v === null || v === undefined || v === '') params.delete(k)
      else params.set(k, String(v))
    })
    setSp(params, { replace: true })
  }, [sp, setSp])

  return { get, getNum, patch }
}
