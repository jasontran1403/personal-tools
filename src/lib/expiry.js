/**
 * Kiểm tra hạn giấy tờ.
 *
 * Quy ước:
 *   - Hết hạn (< hôm nay)  → 'expired'   (đỏ)
 *   - Trong 6 tháng tới     → 'soon'      (vàng, cảnh báo)
 *   - Còn > 6 tháng          → 'ok'        (bình thường)
 *   - Trống / lỗi parse      → 'none'      (không hiển thị)
 *
 * Ngày lưu ở BE dạng "YYYY-MM-DD" (không có múi giờ) — so ở đây bằng local time
 * của trình duyệt là đủ (sai lệch ± 1 ngày ở boundary giờ chuyển, không quan
 * trọng cho mục đích cảnh báo).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
const SIX_MONTHS_DAYS = 183   // gần đúng 6 tháng

export function expiryStatus(dateStr, nowMs = Date.now()) {
  if (!dateStr) return 'none'
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return 'none'
  const [y, m, d] = parts
  const target = Date.UTC(y, m - 1, d)
  const nowUtc = Date.UTC(new Date(nowMs).getUTCFullYear(),
                          new Date(nowMs).getUTCMonth(),
                          new Date(nowMs).getUTCDate())
  const diffDays = Math.floor((target - nowUtc) / MS_PER_DAY)
  if (diffDays < 0) return 'expired'
  if (diffDays <= SIX_MONTHS_DAYS) return 'soon'
  return 'ok'
}

/** Số tháng còn lại (làm tròn xuống). Trả về null nếu invalid / âm. */
export function monthsUntil(dateStr, nowMs = Date.now()) {
  if (!dateStr) return null
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3) return null
  const [y, m, d] = parts
  const target = Date.UTC(y, m - 1, d)
  const nowUtc = Date.UTC(new Date(nowMs).getUTCFullYear(),
                          new Date(nowMs).getUTCMonth(),
                          new Date(nowMs).getUTCDate())
  const diffDays = Math.floor((target - nowUtc) / MS_PER_DAY)
  if (diffDays < 0) return null
  return Math.floor(diffDays / 30)
}

/** Format "YYYY-MM-DD" → "DD/MM/YYYY". Trả rỗng nếu invalid. */
export function formatDateVn(dateStr) {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}
