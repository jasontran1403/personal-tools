/**
 * Format tiền theo quy ước chung của khu Vé máy bay:
 *
 *   USD  →  "1.234,40 USD"   (2 số lẻ, dấu chấm ngăn hàng nghìn, phẩy ngăn thập phân)
 *   VND  →  "1.234.567 VND"  (số nguyên, dấu chấm ngăn hàng nghìn)
 *
 * BE lưu prices dưới dạng String đã format (giữ nguyên định dạng người dùng
 * nhập) → khi đọc lại phải parse ĐÚNG. Chỗ hay sập là "529.000" cho VND — JS
 * `Number("529.000")` = 529 (dot bị hiểu là thập phân). Hàm parseAmount dưới
 * đây có heuristic phân biệt VN thousands vs US decimal.
 */

/**
 * Chuyển 1 chuỗi input về Number.
 *
 * ── Heuristic phân biệt VN thousands vs decimal ────────────
 *   - Có dấu PHẨY:
 *       Phẩy sau dấu chấm cuối → phẩy là thập phân, dấu chấm là hàng nghìn
 *         "1.234,56"  → 1234.56    (VN/DE style)
 *         "1234,56"   → 1234.56
 *       Phẩy trước dấu chấm cuối → phẩy là hàng nghìn, dấu chấm là thập phân
 *         "1,234.56"  → 1234.56    (US style)
 *   - CHỈ có dấu CHẤM (không phẩy):
 *       Nhiều dấu chấm → tất cả là hàng nghìn
 *         "1.234.567" → 1234567
 *       Một dấu chấm, ≥ 3 chữ số sau dấu chấm → hàng nghìn (VN "529.000")
 *         "529.000"   → 529000
 *         "1.500"     → 1500       (rare US usage; treated as VN)
 *       Một dấu chấm, < 3 chữ số sau → thập phân (US "12.50")
 *         "12.50"     → 12.5
 *         "0.5"       → 0.5
 *   - Không có ký tự phân cách → parse thẳng
 *         "1234"      → 1234
 *
 * Rule "3 chữ số sau = nghìn" hợp lý vì:
 *   - VN luôn viết bội của 1000 với 3 số 0 cuối ("100.000", "1.234.567")
 *   - US decimal ít khi có đúng 3 số lẻ ("12.500" hiếm; thường "12.50" hoặc "12.5")
 *   - Nếu bạn nhập "5.000" tay ở VN thì rõ ràng ý là 5000, không phải 5.0
 */
export function parseAmount(input) {
  if (input === '' || input == null) return NaN
  if (typeof input === 'number') return input

  const s = String(input).trim()
  if (!s) return NaN

  const lastComma = s.lastIndexOf(',')
  const lastDot   = s.lastIndexOf('.')

  let normalized
  if (lastComma >= 0) {
    // Có phẩy — quyết định theo vị trí
    if (lastComma > lastDot) {
      // Phẩy sau chấm (hoặc không có chấm) → phẩy là thập phân
      normalized = s.replace(/\./g, '').replace(',', '.')
    } else {
      // Chấm sau phẩy → chấm là thập phân
      normalized = s.replace(/,/g, '')
    }
  } else if (lastDot >= 0) {
    // Chỉ có chấm — heuristic
    const dotCount = (s.match(/\./g) || []).length
    const digitsAfterLastDot = s.length - lastDot - 1
    if (dotCount > 1 || (digitsAfterLastDot === 3 && lastDot > 0)) {
      // Nghìn: bỏ hết chấm
      normalized = s.replace(/\./g, '')
    } else {
      // Thập phân: giữ chấm
      normalized = s
    }
  } else {
    normalized = s
  }

  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}

export function formatMoney(input, currency = 'VND', { withUnit = true } = {}) {
  const n = typeof input === 'number' ? input : parseAmount(input)
  if (!Number.isFinite(n)) return ''

  const digits = currency === 'USD' ? 2 : 0
  const abs = Math.abs(n).toFixed(digits)
  const [whole, frac] = abs.split('.')

  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const body = frac ? `${withThousands},${frac}` : withThousands
  const signed = n < 0 ? `-${body}` : body

  return withUnit ? `${signed} ${currency}` : signed
}

export function sumAmounts(...items) {
  let s = 0
  for (const it of items) {
    const n = typeof it === 'number' ? it : parseAmount(it)
    if (Number.isFinite(n)) s += n
  }
  return s
}

export function toVnd(amount, currency, exchangeRate) {
  const n = typeof amount === 'number' ? amount : parseAmount(amount)
  if (!Number.isFinite(n)) return NaN
  if (currency === 'VND') return n
  const r = parseAmount(exchangeRate)
  if (!Number.isFinite(r) || r <= 0) return NaN
  return n * r
}
