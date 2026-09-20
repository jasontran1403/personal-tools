/**
 * Đếm ngược đến giờ khởi hành.
 *
 * ── Format (Phase E) ────────────────────────────────────────
 * Hiển thị D ngày H giờ M phút S giây, rút gọn khi có thể:
 *   > 1 ngày:   "3d 5h"         (bỏ phút, giây)
 *   > 1 giờ:    "5h 30m"        (bỏ giây)
 *   > 1 phút:   "5m 30s"
 *   < 1 phút:   "30s"
 * Đã qua:       "" (không hiển thị — badge ẩn)
 *
 * Chọn format ngắn (d/h/m/s) thay vì "ngày/giờ/phút/giây" cho gọn trên badge
 * góc card. UI có thể tự thêm "còn" ở trước nếu muốn.
 */

export const H24 = 24 * 60 * 60 * 1000
export const H12 = 12 * 60 * 60 * 1000

/**
 * Format khoảng thời gian còn lại tới departMs. Trả rỗng nếu đã qua hoặc
 * không có timestamp — caller thường ẩn badge trong trường hợp đó.
 */
export function countdownText(departMs, nowMs = Date.now()) {
  if (!departMs) return ''
  const diff = departMs - nowMs
  if (diff <= 0) return ''   // đã bay — không hiển thị

  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor((diff % 86_400_000) / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1000)

  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * Trạng thái đơn cho 1 giờ khởi hành:
 *   'past'    — đã qua
 *   'warn'    — trong 24h tới (nền vàng)
 *   'future'  — còn > 24h
 *   'none'    — không có timestamp
 */
export function bandOf(departMs, nowMs = Date.now()) {
  if (!departMs) return 'none'
  const diff = departMs - nowMs
  if (diff < 0) return 'past'
  if (diff <= H24) return 'warn'
  return 'future'
}

/**
 * Với 1 booking có N chặng, chỉ segment ĐẦU TIÊN (chưa qua giờ khởi hành) là
 * "chặng chính" — dùng cho badge tổng của booking card. Chặng sau (transit)
 * ẩn badge vì thường cách nhau vài giờ, không có ý nghĩa cảnh báo riêng.
 *
 * Trả về { departMs, band, text } của chặng đầu chưa qua, hoặc null nếu tất cả
 * đã qua / chưa có dữ liệu.
 */
export function primaryDeparture(segments, nowMs = Date.now()) {
  if (!segments || segments.length === 0) return null
  for (const s of segments) {
    if (!s.departLocalMs) continue
    if (s.departLocalMs > nowMs) {
      return {
        departMs: s.departLocalMs,
        band: bandOf(s.departLocalMs, nowMs),
        text: countdownText(s.departLocalMs, nowMs),
      }
    }
  }
  return null
}

/**
 * Trả về array warnings tương ứng với segments — dùng cho hiển thị inline
 * trong bảng nếu cần. Với thiết kế mới ưu tiên primaryDeparture cho badge,
 * hàm này giữ lại để tương thích cũ, nhưng warn cho từng chặng cũng OK.
 */
export function warningsForSegments(segments, nowMs = Date.now()) {
  const out = (segments || []).map(s => ({
    band: bandOf(s.departLocalMs, nowMs),
    text: countdownText(s.departLocalMs, nowMs),
    isTransitOf: null,
  }))
  for (let i = 1; i < (segments?.length || 0); i++) {
    const prev = segments[i - 1]?.departLocalMs
    const cur  = segments[i]?.departLocalMs
    if (prev && cur && cur - prev > 0 && cur - prev < H12) {
      if (out[i].band === 'warn') out[i].band = 'future'
      out[i].isTransitOf = i - 1
    }
  }
  return out
}
