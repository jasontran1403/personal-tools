/**
 * Tiện ích xử lý chuỗi tiếng Việt.
 *
 * ── 2026-11-07 ────────────────────────────────────────────
 *   - removeVnDiacritics: bỏ dấu tiếng Việt, giữ chữ "đ/Đ" → "d/D".
 *     Dùng để chuẩn hóa họ tên khách khi copy ra hệ thống hãng
 *     (SR DOCS, check-in) — các hệ thống chỉ chấp nhận ASCII.
 *   - splitVnName: tách "họ" (chữ đầu tiên) và phần còn lại.
 *   - buildSrDocs: build chuỗi SR DOCS HK1 cho Amadeus theo passport.
 */

/**
 * Bỏ dấu tiếng Việt (NFD + loại combining marks). Riêng chữ đ/Đ (không tách
 * diacritic ra được) phải thay riêng.
 */
export function removeVnDiacritics(str) {
  if (!str) return ''
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

/**
 * Tách tên thành { surname, rest }. "Họ" = chữ đầu tiên (space-delimited).
 * Phần còn lại = các chữ sau. Ví dụ:
 *   "RIMA NIDAUL HASANAH" → { surname: "RIMA", rest: "NIDAUL HASANAH" }
 *   "HUANG WEI JIA"       → { surname: "HUANG", rest: "WEI JIA" }
 *   "NGUYEN"              → { surname: "NGUYEN", rest: "" }
 */
export function splitVnName(fullName) {
  const clean = removeVnDiacritics(String(fullName || '').trim())
    .replace(/\s+/g, ' ')
  if (!clean) return { surname: '', rest: '' }
  const parts = clean.split(' ')
  if (parts.length === 1) return { surname: parts[0].toUpperCase(), rest: '' }
  const [head, ...rest] = parts
  return {
    surname: head.toUpperCase(),
    rest: rest.join(' ').toUpperCase(),
  }
}

/** Format DDMMYY → DDMMMYY ví dụ 14/03/1993 → 14MAR93. Input "YYYY-MM-DD" hoặc "DD/MM/YYYY". */
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
export function formatDdmmmYy(dateStr) {
  if (!dateStr) return ''
  const s = String(dateStr).trim()
  let y, m, d
  let mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (mm) { y = mm[1]; m = mm[2]; d = mm[3] }
  else {
    mm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
    if (mm) { d = mm[1]; m = mm[2]; y = mm[3] }
  }
  if (!y || !m || !d) return ''
  const mon = MONTHS[parseInt(m, 10) - 1]
  if (!mon) return ''
  return `${d}${mon}${y.slice(-2)}`
}

/**
 * Build chuỗi SR DOCS HK1 (Amadeus) cho 1 hộ chiếu.
 *
 * Format:
 *   SR DOCS HK1-P-{iso3}-{docNumber}-{iso3}-{dobDDMMMYY}-{M|F}-{expDDMMMYY}-{SURNAME}-{REST} {MR|MS}
 * Ví dụ:
 *   SR DOCS HK1-P-TWN-360024143-TWN-02NOV79-M-03MAY31-HUANG-WEI JIA MR
 *
 * @param passenger { fullName, dob, gender }
 * @param doc       { nationality, docNumber, expiryDate }   (passport)
 * @returns chuỗi SR DOCS, hoặc '' nếu thiếu dữ liệu bắt buộc.
 */
export function buildSrDocs(passenger, doc) {
  if (!passenger || !doc) return ''
  const iso3 = String(doc.nationality || '').trim().toUpperCase()
  const docNo = String(doc.docNumber || '').trim()
  const dob = formatDdmmmYy(passenger.dob)
  const exp = formatDdmmmYy(doc.expiryDate)
  const genderCode = passenger.gender === 'FEMALE' ? 'F' : 'M'
  const titleCode  = passenger.gender === 'FEMALE' ? 'MS' : 'MR'
  const { surname, rest } = splitVnName(passenger.fullName)

  if (!iso3 || !docNo || !dob || !exp || !surname) return ''

  const namePart = rest
    ? `${surname}-${rest} ${titleCode}`
    : `${surname} ${titleCode}`
  return `SR DOCS HK1-P-${iso3}-${docNo}-${iso3}-${dob}-${genderCode}-${exp}-${namePart}`
}