/**
 * Parse chuỗi hành trình dạng "SGNHNDKMJHNDSGN" (5 mã × 3 ký tự = 4 chặng).
 *
 * Trả về array segments:
 *   [ { from: "SGN", to: "HND" }, { from: "HND", to: "KMJ" }, ... ]
 *
 * Chấp nhận cả các biến thể thân thiện:
 *   - viết thường "sgnhnd..."
 *   - có dấu cách "SGN HND KMJ"
 *   - có dấu gạch "SGN-HND-KMJ"
 *   - có dấu mũi tên "SGN→HND→KMJ" hoặc "SGN>HND>KMJ"
 *
 * → tách hết ký tự không phải chữ, viết hoa, kiểm tra tổng độ dài %3 = 0 và
 * độ dài / 3 >= 2 (ít nhất 2 mã = 1 chặng).
 */
export function parseRoute(raw) {
  if (!raw) return { valid: false, codes: [], segments: [], error: 'Trống' }

  const cleaned = String(raw).toUpperCase().replace(/[^A-Z]/g, '')
  if (cleaned.length === 0) return { valid: false, codes: [], segments: [], error: 'Trống' }
  if (cleaned.length % 3 !== 0) {
    return { valid: false, codes: [], segments: [],
      error: 'Cần bội số của 3 ký tự (mỗi mã IATA gồm 3 chữ).' }
  }

  const codes = []
  for (let i = 0; i < cleaned.length; i += 3) codes.push(cleaned.slice(i, i + 3))

  if (codes.length < 2) return { valid: false, codes, segments: [],
    error: 'Cần ít nhất 2 mã sân bay (1 chặng).' }

  const segments = []
  for (let i = 0; i < codes.length - 1; i++) {
    segments.push({ from: codes[i], to: codes[i + 1] })
  }
  return { valid: true, codes, segments, error: null }
}

/** Rút gọn hiển thị: "SGN → HND → KMJ → HND → SGN" */
export function prettyRoute(raw) {
  const p = parseRoute(raw)
  if (!p.valid) return raw || ''
  return p.codes.join(' → ')
}
