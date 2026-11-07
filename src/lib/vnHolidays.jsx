/**
 * ── Ngày lễ Việt Nam — 2026-11-07 ─────────────────────────
 * Lễ dương lịch cố định hàng năm (fixed) + Tết Nguyên Đán & Giỗ tổ Hùng Vương
 * precomputed từ âm lịch cho 2026–2028.
 *
 * Mở rộng âm lịch chính xác cho các năm sau: xem xét dùng npm
 * `lunar-javascript` (có Solar.fromYmd(y,m,d).getLunar()) để tra chính xác,
 * hoặc extend bảng dưới đây.
 */

const FIXED_SOLAR = [
  { month: 1,  day: 1,  label: 'Tết Dương Lịch' },
  { month: 4,  day: 30, label: 'Giải Phóng Miền Nam' },
  { month: 5,  day: 1,  label: 'Quốc Tế Lao Động' },
  { month: 9,  day: 2,  label: 'Quốc Khánh' },
]

// Mùng 1 Tết (dương)
const LUNAR_NEW_YEAR_DAY1 = {
  2026: '2026-02-17',
  2027: '2027-02-06',
  2028: '2028-01-26',
}
// Giỗ tổ Hùng Vương (10/3 âm)
const HUNG_KING = {
  2026: '2026-04-26',
  2027: '2027-04-16',
  2028: '2028-04-04',
}

function ymdKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

/**
 * Trả về label lễ cho ngày d (dương), hoặc null nếu không phải lễ.
 * Ưu tiên lễ Tết âm lịch rồi đến lễ dương cố định.
 */
export function getVnHolidayLabel(d) {
  const key = ymdKey(d)
  // Tết — nghỉ 5 ngày quanh mùng 1 (30 tháng chạp + mùng 1-4)
  for (const [yearStr, day1] of Object.entries(LUNAR_NEW_YEAR_DAY1)) {
    const d1 = new Date(day1 + 'T00:00:00')
    for (let off = -1; off <= 4; off++) {
      const dx = new Date(d1); dx.setDate(d1.getDate() + off)
      if (ymdKey(dx) === key) return off === 0 ? 'Mùng 1 Tết' : (off < 0 ? 'Giao thừa' : `Mùng ${off + 1} Tết`)
    }
  }
  if (Object.values(HUNG_KING).some(s => s === key)) return 'Giỗ tổ Hùng Vương'
  const fixed = FIXED_SOLAR.find(f => f.month === d.getMonth()+1 && f.day === d.getDate())
  if (fixed) return fixed.label
  return null
}

/** Shortcut: true nếu là Sat/Sun. */
export function isWeekend(d) {
  const w = d.getDay()
  return w === 0 || w === 6
}