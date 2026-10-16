/**
 * Parse chuỗi hành trình dạng "SGNHNDKMJHNDSGN" (5 mã × 3 ký tự = 4 chặng).
 *
 * ── 2026-10-16: Hỗ trợ ĐA CHẶNG KHÔNG LIÊN TỤC qua dấu "//" ──────────
 * Người dùng gõ "SGNHAN//HPHSGN" → 2 nhóm hành trình độc lập:
 *     nhóm 1: SGN → HAN
 *     nhóm 2: HPH → SGN
 * Backend lưu routeStr có dấu "//" nguyên; vmb_segment lưu từng chặng độc lập
 * (chặng cuối nhóm 1 KHÔNG nối với chặng đầu nhóm 2).
 *
 * Trả về array segments:
 *   [ { from, to, groupIdx, isGroupStart } ]
 *
 * Chấp nhận cả các biến thể thân thiện:
 *   - viết thường "sgnhnd..."
 *   - có dấu cách "SGN HND KMJ"
 *   - có dấu gạch "SGN-HND-KMJ"
 *   - có dấu mũi tên "SGN→HND→KMJ" hoặc "SGN>HND>KMJ"
 *   - dấu "//" tách các nhóm chặng độc lập.
 */
export function parseRoute(raw) {
  if (!raw) return { valid: false, codes: [], segments: [], groups: [], error: 'Trống' }

  // Tách thô theo "//" (hoặc dấu đôi khác tương đương "//")
  const rawStr = String(raw)
  const groupStrs = rawStr.split(/\/\/+/)

  const groups = []
  const segments = []
  const allCodes = []

  for (let gi = 0; gi < groupStrs.length; gi++) {
    const chunk = groupStrs[gi]
    const cleaned = chunk.toUpperCase().replace(/[^A-Z]/g, '')
    if (cleaned.length === 0) {
      // "//" liền "//" hoặc để trống cuối chuỗi → bỏ qua chunk rỗng, không
      // tạo nhóm, không báo lỗi tại chỗ (user có thể còn đang gõ).
      continue
    }
    if (cleaned.length % 3 !== 0) {
      return { valid: false, codes: [], segments: [], groups: [],
        error: `Nhóm ${gi + 1}: cần bội số của 3 ký tự (mỗi mã IATA 3 chữ).` }
    }
    const codes = []
    for (let i = 0; i < cleaned.length; i += 3) codes.push(cleaned.slice(i, i + 3))
    if (codes.length < 2) {
      return { valid: false, codes: [], segments: [], groups: [],
        error: `Nhóm ${gi + 1}: cần ít nhất 2 mã sân bay (1 chặng).` }
    }
    const groupSegs = []
    for (let i = 0; i < codes.length - 1; i++) {
      const seg = {
        from: codes[i], to: codes[i + 1],
        groupIdx: groups.length,
        isGroupStart: i === 0,
      }
      groupSegs.push(seg)
      segments.push(seg)
    }
    groups.push({ idx: groups.length, codes, segments: groupSegs })
    allCodes.push(...codes)
  }

  if (groups.length === 0) {
    return { valid: false, codes: [], segments: [], groups: [], error: 'Trống' }
  }

  return { valid: true, codes: allCodes, segments, groups, error: null }
}

/**
 * Rút gọn hiển thị:
 *   "SGN → HND → KMJ"              (1 nhóm)
 *   "SGN → HAN  //  HPH → SGN"     (nhiều nhóm)
 */
export function prettyRoute(raw) {
  const p = parseRoute(raw)
  if (!p.valid) return raw || ''
  return p.groups.map(g => g.codes.join(' → ')).join('  //  ')
}
