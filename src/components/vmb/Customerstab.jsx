/**
 * ── CustomersTab — 2026-11-07 ─────────────────────────────
 * Tab "Khách hàng": gộp booking theo công ty (hoặc "Khách lẻ") và tính:
 *   • Tổng tiền vé  (base + collectionFee + fees của mọi vé)
 *   • Tổng phí xuất vé (issuanceFee của mọi vé)
 *   • Tổng doanh thu = Tổng tiền vé + Tổng phí xuất vé
 *   • Công nợ hiện tại = tổng doanh thu của các booking UNPAID
 *   • Các ngày quan trọng sắp tới (within 3 months) — mỗi công ty có thể gắn
 *     N ngày (sinh nhật sếp, sinh nhật người đặt vé...).
 *
 * ── Dữ liệu ───────────────────────────────────────────────
 * Pull full danh sách booking qua listBookings (phân trang client-side); aggregate
 * theo t.companyId. USD → quy đổi VND qua exchangeRate đã lưu trên booking.
 *
 * ── "Important dates" lưu đâu? ────────────────────────────
 * Tạm lưu LOCAL (localStorage) để không cần sửa BE lần này. Format:
 *   key = "vmb.company.dates.v1"
 *   value = { [companyId]: [{ id, label, isLunar, month, day }] }
 * Khi nào cần sync nhiều máy → đưa sang BE sau. Fallback 'khachle' cho null.
 *
 * ── Sort ──────────────────────────────────────────────────
 * Click header các cột số → toggle asc/desc. Click header cột "Ngày sắp tới"
 * sort theo khoảng cách ngày gần nhất tới hôm nay.
 */
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { listBookings, listCompanies, listPassengers, updatePassengerReferrer } from '../../services/vmbApi'
import { parseAmount, formatMoney } from '../../lib/money'

// ── Config ─────────────────────────────────────────────────
// 2026-11-07 (rev): bump schema version — giờ lưu { dates, notes } thay vì array.
//   Migrate dữ liệu cũ (v1 = array dates) trong loadCustomerMeta.
const META_KEY = 'vmb.company.meta.v2'
const OLD_DATE_KEY = 'vmb.company.dates.v1'
const UPCOMING_WINDOW_DAYS = 90          // ~3 tháng tới (user yêu cầu 90)
// mỗi passenger walk-in là 1 row riêng

// ── Vietnam lunar helpers ──────────────────────────────────
// Hiện chưa dùng lib âm lịch — nếu date.isLunar=true thì user nhập ngày âm
// lịch, FE cố gắng tính ngày dương gần nhất bằng cách tra bảng precomputed.
// Khi bảng miss → bỏ qua (và warn). Đủ cho Tết + Giỗ tổ cho vài năm tới.
// Chi tiết khi scale: cân nhắc dùng `lunar-javascript` npm.
const LUNAR_SOLAR_MAP = {
  // "MM-DD" (lunar) → mảng { year, solar: "YYYY-MM-DD" }
  // Ví dụ Mùng 1 Tết, Giỗ tổ 10/3 âm. Có thể bổ sung thêm tuỳ nhu cầu.
  '01-01': [
    { year: 2026, solar: '2026-02-17' },
    { year: 2027, solar: '2027-02-06' },
    { year: 2028, solar: '2028-01-26' },
  ],
  '03-10': [
    { year: 2026, solar: '2026-04-26' },
    { year: 2027, solar: '2027-04-16' },
    { year: 2028, solar: '2028-04-04' },
  ],
}

/**
 * Tính ngày dương (Date) sắp tới gần nhất cho 1 "important date" (từ hôm nay).
 * ── 2026-11-07 (rev): hỗ trợ field `year` optional.
 *   - Có year → chỉ dùng ngày cụ thể đó (one-shot, ví dụ sinh nhật năm 2027).
 *   - Không year → recurring hàng năm, trả về lần xảy ra sắp tới ≥ hôm nay.
 */
function nextSolarOccurrence({ month, day, isLunar, year }, nowMs = Date.now()) {
  const now = new Date(nowMs)
  if (isLunar) {
    const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const arr = LUNAR_SOLAR_MAP[key]
    if (!arr) return null
    for (const x of arr) {
      const d = new Date(x.solar + 'T00:00:00')
      if (d.getTime() >= now.getTime() - 86400000) return d
    }
    return null
  }
  if (year) {
    // One-shot: chỉ trả về ngày đó, kể cả nếu đã qua (caller sẽ lọc bằng daysUntil).
    return new Date(year, month - 1, day, 0, 0, 0, 0)
  }
  for (let y = now.getFullYear(); y <= now.getFullYear() + 1; y++) {
    const d = new Date(y, month - 1, day, 0, 0, 0, 0)
    if (d.getTime() >= now.getTime() - 86400000) return d
  }
  return null
}

function daysUntil(dateObj, nowMs = Date.now()) {
  if (!dateObj) return Infinity
  return Math.round((dateObj.getTime() - nowMs) / 86400000)
}

// ── localStorage helpers ───────────────────────────────────
// 2026-11-07: meta per company = { dates: [{id,label,day,month,isLunar}],
//                                  notes: [{id,text}] }
// Migrate từ v1 (array dates) nếu có.
function loadCustomerMeta() {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (raw) return JSON.parse(raw) || {}
    const old = localStorage.getItem(OLD_DATE_KEY)
    if (!old) return {}
    const parsed = JSON.parse(old) || {}
    const migrated = {}
    for (const [cid, dates] of Object.entries(parsed)) {
      migrated[cid] = { dates: Array.isArray(dates) ? dates : [], notes: [] }
    }
    localStorage.setItem(META_KEY, JSON.stringify(migrated))
    return migrated
  } catch { return {} }
}
function saveCustomerMeta(map) {
  try { localStorage.setItem(META_KEY, JSON.stringify(map)) } catch {}
}
function metaOf(map, cid) {
  const raw = map[cid]
  if (!raw) return { dates: [], notes: [] }
  if (Array.isArray(raw)) return { dates: raw, notes: [] }
  return { dates: raw.dates || [], notes: raw.notes || [] }
}

// ── 2026-11-07: Validate 1 tuple (day, month, year?) đã là ngày hợp lệ ──
//   Tháng không có 31 → báo sai; tháng 2 → check leap year nếu có year, else
//   cho phép 29 (giả định có thể là năm nhuận).
export function validateCalendarDate(day, month, year) {
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'Ngày phải 1-31'
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Tháng phải 1-12'
  if (year != null && (!Number.isInteger(year) || year < 1900 || year > 2050)) {
    return 'Năm phải trong khoảng 1900-2050'
  }
  const days31 = [1, 3, 5, 7, 8, 10, 12]
  if (day === 31 && !days31.includes(month)) {
    return `Tháng ${month} không có ngày 31`
  }
  if (month === 2) {
    if (day > 29) return 'Tháng 2 không có ngày 30/31'
    if (day === 29 && year != null) {
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)
      if (!isLeap) return `Tháng 2 năm ${year} không có ngày 29`
    }
  }
  return null   // null = OK
}

// Weekday VN: "Chủ Nhật", "Thứ 2"...
export function vnWeekday(d) {
  return d.getDay() === 0 ? 'Chủ Nhật' : `Thứ ${d.getDay() + 1}`
}

// ── 2026-11-07: Màu badge mã hãng ────────────────────────
//   Fallback: #6B7280 (gray-500) nếu không có code.
const AIRLINE_COLORS = {
  VN:  '#0085A1', // Vietnam Airlines
  SP:  '#D9A52B', // Sun PhuQuoc Airways
  VU:  '#142B52', // Vietravel
  BL:  '#003B70', // Pacific Airlines
  MF:  '#0072BC', // Xiamen Airlines
  TR:  '#F5C400', // Scoot
  TK:  '#C8102E', // Turkish Airlines
  SC:  '#00529B', // Shandong Airlines
  KE:  '#0066B3', // Korean Air
  NH:  '#003E7E', // ANA
  JL:  '#C8102E', // JAL
  CX:  '#006564', // Cathay Pacific
  CI:  '#8B1E5A', // China Airlines
  CZ:  '#0066B3', // China Southern
  ZH:  '#C8102E', // Shenzhen Airlines
  BR:  '#008675', // EVA Air
  QR:  '#5C0632', // Qatar Airways
  EK:  '#D71920', // Emirates
  AK:  '#E4002B', // AirAsia
  K6:  '#00529B', // Air Cambodia (Cambodia Angkor Air)
  BI:  '#D4AF37', // Royal Brunei
  MU:  '#C8102E', // China Eastern
  UA:  '#002F6C', // United
  TG:  '#5B2C83', // Thai Airways
  GA:  '#00529B', // Garuda Indonesia
  // Alias phổ biến: VJ, QH, VU...
  VJ:  '#E4002B', // VietJet Air (fallback đỏ VJ phổ biến)
  QH:  '#142B52', // Bamboo Airways (navy)
}
function airlineColor(code) {
  if (!code) return '#6B7280'
  return AIRLINE_COLORS[String(code).toUpperCase()] || '#6B7280'
}

// Chọn màu chữ trắng/đen dựa trên luminance của bg (WCAG ước lượng).
function textOn(bgHex) {
  const h = bgHex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return L > 0.6 ? '#1f2937' : '#ffffff'
}

/** Format epoch ms / ISO → "dd/MM/yyyy" theo local timezone. Null → '—'. */
function fmtDMY(v) {
  if (v == null) return '—'
  const d = typeof v === 'number' ? new Date(v) : new Date(v)
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// ── Money helpers ──────────────────────────────────────────
function toVnd(amount, booking) {
  const n = typeof amount === 'number' ? amount : parseAmount(amount) || 0
  if ((booking.currency || 'VND') === 'USD') {
    const r = parseAmount(booking.exchangeRate) || 0
    return Math.round(n * r)
  }
  return n
}
function ticketSums(t, b) {
  const base = parseAmount(t.basePrice) || 0
  const coll = parseAmount(t.collectionFee) || 0
  const feesSum = (t.fees || []).reduce((s, f) => s + (parseAmount(f.amount) || 0), 0)
  const iss = parseAmount(t.issuanceFee) || 0
  return {
    ticketPrice: toVnd(base + coll + feesSum, b),
    issuanceFee: toVnd(iss, b),
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-11-08: DebtAgeBadge — số ngày công nợ, màu scale theo mức độ.
//   Tính từ fromMs (ngày phát hành hoặc ngày xuất vé) → hôm nay.
//   Xanh lá <7, vàng <30, cam <90, đỏ ≥90.
// ═══════════════════════════════════════════════════════════
function DebtAgeBadge({ fromMs }) {
  if (!fromMs) return <span className="text-gray-400 text-xs">—</span>
  const days = Math.max(0, Math.floor((Date.now() - fromMs) / 86400000))
  let cls
  if (days < 7)       cls = 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300'
  else if (days < 30) cls = 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
  else if (days < 90) cls = 'bg-orange-100 text-orange-800 ring-1 ring-orange-300'
  else                cls = 'bg-rose-100 text-rose-800 ring-1 ring-rose-300'
  return (
    <span className={`inline-block px-2 py-0.5 rounded font-mono font-bold text-[11px] whitespace-nowrap ${cls}`}>
      {days} ngày
    </span>
  )
}

// ═══════════════════════════════════════════════════════════
// 2026-11-08: DebtDatesBadges — list badges nhỏ dưới số tiền công nợ.
//   Xanh LÁ   = ngày phát hành hóa đơn (invoice đã có số).
//   Xanh DƯƠNG = ngày xuất vé (fallback khi booking chưa phát hành hóa đơn).
// ═══════════════════════════════════════════════════════════
function DebtDatesBadges({ bookings }) {
  const items = useMemo(() => buildDebtItems(bookings || []), [bookings])
  if (!items.length) return null
  // Group theo (kind, dd/MM/yyyy) — các timestamp cùng NGÀY gộp 1 badge, có
  //   corner count. Key dùng chuỗi dd/MM/yyyy để tránh case 2 timestamp cùng
  //   ngày nhưng khác giờ sinh ra 2 badge.
  const groupMap = new Map()
  for (const it of items) {
    let kind, date
    if (it.type === 'invoice' && it.issueDate) { kind = 'issue'; date = it.issueDate }
    else if (it.saleDate)                      { kind = 'sale';  date = it.saleDate  }
    else continue
    const dmy = fmtDMY(date)
    const k = `${kind}:${dmy}`
    if (!groupMap.has(k)) groupMap.set(k, { kind, dmy, date, count: 0 })
    const g = groupMap.get(k)
    g.count += 1
    if (date > g.date) g.date = date   // giữ ts mới nhất để sort
  }
  const out = [...groupMap.values()].sort((a, b) => b.date - a.date)
  if (!out.length) return null
  return (
    // 2026-11-08 (rev3): Flex-wrap + justify-end + gap đều (ngang = dọc).
    //   Wrapper minWidth 240px: ép table-layout dành chỗ đủ cho 3 badges/dòng
    //   (mỗi badge ~70px + gap 6px + corner-count 4px).
    //   Dùng cùng 1 value cho gap-x / gap-y → spacing đều.
    // ml-auto để wrapper flex này được đẩy sát biên phải của cell (vì td
    //   `text-right` chỉ ảnh hưởng inline content).
    <div className="mt-1 ml-auto flex flex-wrap gap-1.5 justify-end"
         style={{ width: 260 }}>
      {out.map((x, i) => (
        <span key={i}
          title={x.kind === 'issue'
            ? `Ngày phát hành hóa đơn${x.count > 1 ? ` (${x.count} HĐ)` : ''}`
            : `Ngày xuất vé — chưa phát hành${x.count > 1 ? ` (${x.count} vé)` : ''}`}
          className={`relative inline-block text-[10px] font-mono font-semibold px-1.5 py-1 rounded whitespace-nowrap
            ${x.kind === 'issue'
              ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300'
              : 'bg-blue-100 text-blue-800 ring-1 ring-blue-300'}`}>
          {x.dmy}
          {x.count > 1 && (
            <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-0.5
                rounded-full bg-rose-600 text-white text-[8px] font-bold flex items-center
                justify-center leading-none ring-1 ring-white">
              {x.count}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// 2026-11-08: Phân loại tuyến bay nội địa / quốc tế theo IATA.
//   Rule: Nếu TẤT CẢ segments đều có cả fromCode và toCode thuộc VN → DOMESTIC.
//          Chỉ cần 1 segment có airport không thuộc VN → INTERNATIONAL.
//   Danh sách VN giữ hardcode, bổ sung dễ.
// ═══════════════════════════════════════════════════════════
const VN_AIRPORTS = new Set([
  'SGN','HAN','DAD','HPH','CXR','DLI','HUI','PQC','VCA','VII',
  'UIH','BMV','VDH','VCL','TBB','VCS','VKG','DIN','PXU','CAH',
  'TGH','VDO','VCI','VKS','SQH','THD','HOO',
])
function isDomesticBooking(b) {
  const segs = b?.segments || []
  if (!segs.length) return true // Không có segment → coi như domestic để tránh sai lệch
  for (const s of segs) {
    const f = (s.fromCode || '').toUpperCase()
    const t = (s.toCode || '').toUpperCase()
    if (f && !VN_AIRPORTS.has(f)) return false
    if (t && !VN_AIRPORTS.has(t)) return false
  }
  return true
}

// ═══════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════

export default function CustomersTab() {
  const [companies, setCompanies] = useState([])
  const [bookings, setBookings]   = useState([])
  // 2026-11-08: Danh sách passenger khách-lẻ ĐÃ TẠO. Tab "Khách lẻ" dựng rows
  //   chỉ từ list này + attach dữ liệu từ bookings. Không auto-tạo row cho khách
  //   trong booking mà chưa có record.
  const [walkInPassengers, setWalkInPassengers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [q, setQ]                 = useState('')
  // 2026-11-07 (rev): filter loại khách — default = Công ty.
  const [kind, setKind]           = useState('company')  // 'company' | 'walkin'
  const [sortKey, setSortKey]     = useState('revenue')  // revenue|debt|ticket|iss|date
  const [sortDir, setSortDir]     = useState('desc')     // asc|desc
  // 2026-11-07 (rev): `meta` giờ gồm dates + notes per company.
  const [meta, setMeta]           = useState(() => loadCustomerMeta())
  const [editFor, setEditFor]     = useState(null)   // row cần sửa (có companyId)
  // 2026-11-07: modal chi tiết công nợ khi click vào số công nợ > 0.
  const [debtFor, setDebtFor]     = useState(null)   // { row, items }
  // 2026-11-08: modal chi tiết.
  //   mode='referrer'  → click vào tên khách lẻ: chỉ show người giới thiệu.
  //   mode='revenue'   → click vào cột doanh thu: chỉ show phí xuất vé QT/QN.
  const [detailFor, setDetailFor] = useState(null)   // { row, mode }

  // Load companies + fetch toàn bộ booking (phân trang).
  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true)
      try {
        const all = []
        let page = 0
        const MAX = 50
        while (page < MAX) {
          const res = await listBookings({ page, size: 200 })
          const d = res.data?.data
          all.push(...(d?.content || []))
          if (page + 1 >= (d?.totalPages || 1)) break
          page++
        }
        if (!cancel) setBookings(all)
      } catch (e) {
        console.error('[customers load bookings]', e)
        toast.error('Không tải được booking')
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [])

  // 2026-11-08: Lazy fetch theo tab hiện tại.
  //   - Tab "Công ty" → listCompanies.
  //   - Tab "Khách lẻ" → listPassengers({walkInOnly:true}).
  //   Mỗi lần toggle tab là 1 lần reload (đảm bảo data mới nhất, tránh cache cũ
  //   sau khi tạo/sửa khách ở tab khác).
  useEffect(() => {
    let cancel = false
    if (kind === 'company') {
      ;(async () => {
        try {
          const cRes = await listCompanies()
          if (!cancel) setCompanies(cRes.data?.data || [])
        } catch (e) {
          console.error('[customers load companies]', e)
          toast.error('Không tải được công ty')
        }
      })()
    } else if (kind === 'walkin') {
      ;(async () => {
        try {
          const pRes = await listPassengers({ walkInOnly: true, size: 500 })
          if (!cancel) setWalkInPassengers(pRes.data?.data?.content || [])
        } catch (e) {
          console.error('[customers load walk-in]', e)
          toast.error('Không tải được khách lẻ')
        }
      })()
    }
    return () => { cancel = true }
  }, [kind])

  // Gộp theo công ty (các công ty có booking) + mỗi khách-lẻ ĐÃ TẠO là 1 row.
  //   2026-11-08: Row khách-lẻ dựng từ `walkInPassengers` (đã tạo trong hệ thống)
  //   — không dựng từ tickets. Match ticket với passenger theo passengerId trước,
  //   fallback uppercase name. Ticket không match passenger nào → bỏ qua (dữ liệu
  //   cũ chưa gán passengerId).
  const rows = useMemo(() => {
    const map = new Map()
    const getCompany = (id) => companies.find(c => c.id === id)

    // 1) Seed rows cho mỗi khách-lẻ đã tạo.
    for (const p of walkInPassengers) {
      const paxName = (p.fullName || '').trim().toUpperCase()
      if (!paxName) continue
      const key = `p:${p.id}`   // key theo ID để tránh đụng tên trùng.
      map.set(key, {
        key,
        companyId: null,
        passengerId: p.id,
        passengerKey: paxName,  // dùng để match ticket nếu không có passengerId
        name: paxName,
        isWalkIn: true,
        ticketCount: 0,
        ticket: 0, iss: 0, revenue: 0, debt: 0,
        unpaidBookings: [],
        // 2026-11-08: Phí xuất vé GẦN NHẤT theo loại tuyến.
        latestDomestic: null,
        latestInternational: null,
        // 2026-11-08: Referrer lấy trực tiếp từ passenger (khỏi lệ thuộc booking).
        referrerName: p.referrerName || null,
      })
    }
    // Reverse index tên → key để match ticket theo tên nhanh.
    const walkInByName = new Map()
    for (const r of map.values()) walkInByName.set(r.passengerKey, r.key)
    // 2026-11-08: Set các companyId là "khách lẻ sentinel" (Company seed
    //   tên "Khách lẻ") — để KHÔNG tạo row Công ty cho chúng. Nhận diện
    //   qua companyName trong bản thân passenger walk-in (BE trả về).
    const walkInCompanyIds = new Set()
    for (const p of walkInPassengers) {
      if (p.companyId != null) walkInCompanyIds.add(p.companyId)
    }

    // 2) Gộp booking: ƯU TIÊN match theo passengerId (ticket chọn từ dropdown
    //    → BE/FE set luôn companyId = id của "Khách lẻ" sentinel, nên nếu
    //    duyệt companyId trước thì vé walk-in sẽ vào bucket Company "Khách lẻ"
    //    sai chỗ). Thứ tự match:
    //      1) passengerId có trong map (seeded từ walkInPassengers) → walk-in row
    //      2) companyId != null và KHÔNG phải sentinel → company row
    //      3) passengerName match tên walk-in đã tạo → walk-in row
    //      4) Không match gì → skip (ko tạo row ảo)
    for (const b of bookings) {
      const isUnpaid = (b.paymentStatus || 'UNPAID') !== 'PAID'
      const relatedKeys = new Set()
      for (const t of (b.tickets || [])) {
        const cid = t.companyId
        const paxName = (t.passengerName || '').trim().toUpperCase()
        let key = null
        if (t.passengerId != null && map.has(`p:${t.passengerId}`)) {
          key = `p:${t.passengerId}`
        } else if (cid != null && !walkInCompanyIds.has(cid)) {
          key = `c${cid}`
          if (!map.has(key)) {
            const c = getCompany(cid)
            map.set(key, {
              key, companyId: cid, name: c?.name || `#${cid}`, isWalkIn: false,
              ticketCount: 0, ticket: 0, iss: 0, revenue: 0, debt: 0,
              unpaidBookings: [],
              latestDomestic: null, latestInternational: null, referrerName: null,
            })
          }
        } else if (paxName && walkInByName.has(paxName)) {
          key = walkInByName.get(paxName)
        } else {
          continue    // Khách lẻ chưa tạo record / company là sentinel → skip.
        }
        const sums = ticketSums(t, b)
        const r = map.get(key)
        const sellPrice = sums.ticketPrice + sums.issuanceFee
        if (sellPrice > 0.5) r.ticketCount += 1
        r.ticket  += sums.ticketPrice
        r.iss     += sums.issuanceFee
        r.revenue += sellPrice
        if (isUnpaid) r.debt += sellPrice
        relatedKeys.add(key)

        // 2026-11-08: Theo dõi BOOKING GẦN NHẤT theo nội địa / quốc tế.
        //   "Gần nhất" dựa trên saleDate (fallback createdAt).
        //   Lưu per-ticket để UI render được breakdown: cùng phí → gộp tên,
        //   khác phí → tách dòng.
        const when = b.saleDate || b.createdAt || 0
        const issThis = sums.issuanceFee
        if (issThis > 0.5) {
          const target = isDomesticBooking(b) ? 'latestDomestic' : 'latestInternational'
          const current = r[target]
          const ticketEntry = {
            name: (t.passengerName || '').trim().toUpperCase() || '—',
            iss: issThis,
          }
          if (!current || when > current.saleDate) {
            // Booking mới hơn → reset.
            r[target] = {
              bookingId: b.id,
              bookingCode: b.bookingCode,
              saleDate: when,
              tickets: [ticketEntry],
            }
          } else if (current.bookingId === b.id) {
            // Cùng booking → append vé.
            current.tickets.push(ticketEntry)
          }
          // Cũ hơn → bỏ.
        }
      }
      if (isUnpaid) {
        for (const k of relatedKeys) map.get(k).unpaidBookings.push(b)
      }
    }
    // 2026-11-07 (rev): Attach dates (within window) + noteCount.
    //   Chỉ lấy ngày từ HÔM NAY trở đi cho tới +90 ngày.
    const nowMs = Date.now()
    const list = [...map.values()]
    // 2026-11-08 (rev4): meta dùng r.key (vừa cho company 'c<id>' vừa cho
    //   walk-in 'p:<pid>'), nên khách lẻ cũng có ngày quan trọng + ghi chú.
    for (const r of list) {
      const { dates: ds, notes } = metaOf(meta, r.key)
      const upcoming = ds
        .map(d => ({ ...d, _date: nextSolarOccurrence(d, nowMs) }))
        .filter(d => d._date && daysUntil(d._date, nowMs) <= UPCOMING_WINDOW_DAYS && daysUntil(d._date, nowMs) >= 0)
        .sort((a, b) => a._date.getTime() - b._date.getTime())
      r.upcoming = upcoming
      r.noteCount = notes.length
      r.nearestDays = upcoming.length ? daysUntil(upcoming[0]._date, nowMs) : Infinity
    }
    return list
  }, [bookings, companies, walkInPassengers, meta])

  // Filter + sort.
  const filtered = useMemo(() => {
    // ── 2026-11-07 (rev): filter theo loại khách (Công ty / Khách lẻ) trước.
    // ── 2026-11-08: Ở tab Công ty, bỏ luôn các row có tên "Khách lẻ" (phòng
    //    trường hợp DB có record Company tên trùng).
    let out = rows.filter(r => {
      if ((kind === 'walkin') !== !!r.isWalkIn) return false
      if (kind === 'company' && /^kh[aá]ch\s+l[eẻ]$/i.test((r.name || '').trim())) return false
      return true
    })
    const qq = q.trim().toLowerCase()
    if (qq) out = out.filter(r => r.name.toLowerCase().includes(qq))
    const dir = sortDir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      let va, vb
      switch (sortKey) {
        case 'revenue':     va = a.revenue;     vb = b.revenue;     break
        case 'debt':        va = a.debt;        vb = b.debt;        break
        case 'ticketCount': va = a.ticketCount; vb = b.ticketCount; break
        case 'ticket':      va = a.ticket;      vb = b.ticket;      break
        case 'iss':         va = a.iss;         vb = b.iss;         break
        case 'date':
          va = a.nearestDays; vb = b.nearestDays; break
        default:
          // Fallback: revenue desc (ổn định giữa 2 lần render).
          va = a.revenue; vb = b.revenue
      }
      return (va - vb) * dir
    })
    return out
  }, [rows, q, kind, sortKey, sortDir])

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc') }
  }

  const onMetaChanged = (companyId, patch) => {
    setMeta(prev => {
      const cur = metaOf(prev, companyId)
      const next = { ...prev, [companyId]: { ...cur, ...patch } }
      saveCustomerMeta(next)
      return next
    })
  }

  const SortH = ({ k, children, align = 'left', style }) => {
    const active = sortKey === k
    const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'
    return (
      <th onClick={() => toggleSort(k)} style={style}
        className={`px-3 py-2 text-xs font-bold text-gray-600 cursor-pointer select-none whitespace-nowrap bg-gray-50
          ${align === 'right' ? 'text-right' : 'text-left'}
          ${active ? 'text-blue-700' : 'hover:text-gray-900'}`}>
        <span className="inline-flex items-center gap-1">
          {children}
          <span className={`text-[9px] ${active ? 'opacity-80' : 'opacity-30'}`}>{arrow}</span>
        </span>
      </th>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-2 mb-3 px-1">
        <input type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Tìm khách hàng…"
          className="flex-1 min-w-[220px] max-w-[460px] px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200" />
        {/* ── 2026-11-07: Toggle Công ty / Khách lẻ ── */}
        <div className="inline-flex p-0.5 rounded-lg bg-gray-100 border border-gray-200">
          <button type="button" onClick={() => setKind('company')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
              kind === 'company'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-600 hover:text-gray-900'
            }`}>
            🏢 Công ty
          </button>
          <button type="button" onClick={() => setKind('walkin')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
              kind === 'walkin'
                ? 'bg-amber-500 text-white shadow'
                : 'text-gray-600 hover:text-gray-900'
            }`}>
            👤 Khách lẻ
          </button>
        </div>
        <div className="text-xs text-gray-500">
          {loading ? 'Đang tải…' : `${filtered.length} khách hàng`}
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white">
        {/* 2026-11-08 (rev4): table-layout fixed + colgroup — đảm bảo widths
            giống hệt ở cả 2 tab Công ty / Khách lẻ, không bị flick layout. */}
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '26%' }} />   {/* Tên khách hàng */}
            <col style={{ width: '12%' }} />   {/* Tổng tiền vé */}
            <col style={{ width: '14%' }} />   {/* Tổng phí xuất vé (+ vé) */}
            <col style={{ width: '13%' }} />   {/* Tổng doanh thu */}
            <col style={{ width: '20%' }} />   {/* Công nợ hiện tại (+15% share) */}
            <col style={{ width: '15%' }} />   {/* Ngày sắp tới (-15% share) */}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-gray-50">
            {/* 2026-11-08 (rev5): tương tự body — pseudo ::after inset khỏi
                top/bottom header cell → giao điểm mượt với line ngang. */}
            <tr className={``}>
              {/* 2026-11-08 (rev3): Để các cột auto-size cho cân, chỉ fix width
                  cột "Công nợ" (vì badges cần chỗ cố định 3/dòng). */}
              <th className="px-3 py-2 text-xs font-bold text-gray-600 bg-gray-50 text-left whitespace-nowrap">
                Tên khách hàng
              </th>
              <SortH k="ticket" align="right">Tổng tiền vé</SortH>
              <SortH k="iss"    align="right">Tổng phí xuất vé</SortH>
              <SortH k="revenue" align="right">Tổng doanh thu</SortH>
              <SortH k="debt" align="right">Công nợ hiện tại</SortH>
              <SortH k="date" align="right">Ngày sắp tới</SortH>
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-xs text-gray-400 italic py-10">Đang tải…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-xs text-gray-400 italic py-10">Không có khách hàng</td></tr>
            ) : filtered.map(r => (
              <tr key={r.key} className={`border-t border-gray-100 hover:bg-blue-50/30`}>
                <td className="px-3 py-3 font-semibold text-gray-900 whitespace-normal break-words">
                  <span className={`mr-2 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded font-bold ${
                    r.isWalkIn
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {r.isWalkIn ? 'Khách lẻ' : 'Công ty'}
                  </span>
                  {/* 2026-11-08 (rev4): Click vào TÊN (cả khách lẻ + công ty)
                      → mở modal Ngày quan trọng & ghi chú. Khách lẻ có thêm
                      section Người giới thiệu ở trên. Noti nhỏ (N) khi có note. */}
                  <button type="button"
                    onClick={() => setEditFor(r)}
                    title="Click để quản lý ngày quan trọng & ghi chú"
                    className={`hover:underline decoration-dotted cursor-pointer
                      ${r.isWalkIn ? 'decoration-amber-400' : 'decoration-blue-400'}`}>
                    {r.name}
                    {r.noteCount > 0 && (
                      <span className="ml-1.5 text-[10px] font-semibold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">
                        {r.noteCount} 📝
                      </span>
                    )}
                  </button>
                </td>
                <td className="px-3 py-3.5 text-right font-mono tabular-nums">{formatMoney(r.ticket, 'VND', { withUnit: false })}</td>
                <td className="px-3 py-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                  {formatMoney(r.iss, 'VND', { withUnit: false })}
                  {/* 2026-11-08 (rev2): gộp số vé đã mua vào trong ngoặc, sau phí xuất vé. */}
                  <span className="ml-1 text-[11px] font-sans text-blue-700 font-semibold">
                    ({r.ticketCount} vé)
                  </span>
                </td>
                <td className="px-3 py-3.5 text-right font-mono tabular-nums font-bold text-emerald-700">
                  <button type="button"
                    onClick={() => setDetailFor({ row: r, mode: 'revenue' })}
                    title="Click để xem phí xuất vé Quốc tế / Quốc nội gần nhất"
                    className="hover:bg-emerald-50 rounded px-1 -mx-1 cursor-pointer underline decoration-dotted decoration-emerald-300">
                    {formatMoney(r.revenue, 'VND', { withUnit: false })}
                  </button>
                </td>
                <td className="px-3 py-3.5 text-right font-mono tabular-nums font-bold">
                  {r.debt > 0 ? (
                    <>
                      <button type="button"
                        onClick={() => setDebtFor(r)}
                        title="Click để xem chi tiết hóa đơn / booking chưa thanh toán"
                        className="text-rose-700 hover:bg-rose-50 rounded px-1 -mx-1 cursor-pointer underline decoration-dotted decoration-rose-300">
                        {formatMoney(r.debt, 'VND', { withUnit: false })}
                      </button>
                      {/* 2026-11-08 (rev3): Wrapper min-width 280 để table layout
                          dành chỗ cho 3 badges/dòng, khoảng cách badges đều. */}
                      <DebtDatesBadges bookings={r.unpaidBookings} />
                    </>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-3.5 text-right">
                  {/* 2026-11-08 (rev4): canh phải — dòng 1 thứ + ngày, dòng 2
                      label + số ngày còn lại. */}
                  {r.upcoming && r.upcoming.length > 0 ? (
                    <div className="flex flex-col gap-1.5 items-end">
                      {r.upcoming.map((d, i) => (
                        <div key={i} className="text-xs leading-tight text-right">
                          <div className="font-bold text-indigo-700 whitespace-nowrap">
                            {vnWeekday(d._date)}, {fmtLocalDate(d._date)}
                          </div>
                          <div className="text-[11px] text-gray-500 break-words">
                            {d.label}
                            <span className="ml-1 text-[10px] text-gray-400">
                              (còn {daysUntil(d._date)} ngày{d.year ? ' · 1 lần' : ''})
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <span className="text-xs text-gray-400 italic">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {debtFor && (
        <DebtDetailModal row={debtFor} onClose={() => setDebtFor(null)} />
      )}
      {detailFor && (
        <RevenueDetailModal
          row={detailFor.row}
          mode={detailFor.mode}
          onClose={() => setDetailFor(null)}
          onReferrerSaved={(pid, ref) => {
            // Cập nhật in-place walkInPassengers để row + modal re-render với
            // referrer mới (khỏi phải refetch cả list).
            setWalkInPassengers(list => list.map(p =>
              p.id === pid ? { ...p, referrerName: ref } : p
            ))
            setDetailFor(d => d && d.row.passengerId === pid
              ? { ...d, row: { ...d.row, referrerName: ref } }
              : d)
          }}
        />
      )}
      {editFor && (
        <CustomerMetaModal
          customer={editFor}
          initialDates={metaOf(meta, editFor.key).dates}
          initialNotes={metaOf(meta, editFor.key).notes}
          onClose={() => setEditFor(null)}
          onSave={({ dates, notes }) => {
            onMetaChanged(editFor.key, { dates, notes })
            setEditFor(null)
          }}
          onReferrerSaved={editFor.isWalkIn ? ((pid, ref) => {
            setWalkInPassengers(list => list.map(p =>
              p.id === pid ? { ...p, referrerName: ref } : p))
            setEditFor(f => f && f.passengerId === pid
              ? { ...f, referrerName: ref } : f)
          }) : null}
        />
      )}
    </div>
  )
}

function fmtLocalDate(d) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

// ───────────────────────────────────────────────────────────
//  2026-11-07 (rev): CustomerMetaModal — dates + notes, có thể sửa
//    inline (double-click hoặc nút ✎). Size 80dvw × 70dvh theo yêu cầu.
// ───────────────────────────────────────────────────────────
function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function CustomerMetaModal({ customer, initialDates, initialNotes, onClose, onSave, onReferrerSaved }) {
  const [dates, setDates] = useState(() => initialDates.map(d => ({ ...d })))
  const [notes, setNotes] = useState(() => initialNotes.map(n => ({ ...n })))
  // 2026-11-07 (rev): panel toggle thay cho 2 cột. Default = 'notes'.
  const [panel, setPanel] = useState('notes')   // 'notes' | 'dates'

  // Form thêm ngày
  const [dLabel, setDLabel] = useState('')
  const [dDay, setDDay]     = useState('')
  const [dMonth, setDMonth] = useState('')
  const [dYear, setDYear]   = useState('')   // optional
  // Form thêm note
  const [nText, setNText]   = useState('')
  // Inline edit state
  const [editingDateId, setEditingDateId] = useState(null)
  const [editingNoteId, setEditingNoteId] = useState(null)

  const addDate = () => {
    const dd = parseInt(dDay, 10), mm = parseInt(dMonth, 10)
    const yy = dYear.trim() ? parseInt(dYear, 10) : null
    if (!dLabel.trim()) return toast.error('Nhập nhãn ngày')
    // 2026-11-07: dùng validateCalendarDate thay check rời rạc.
    const err = validateCalendarDate(dd, mm, yy)
    if (err) {
      toast.error(err)
      // user yêu cầu: lỗi → xoá ngày vừa nhập.
      setDDay(''); setDMonth(''); setDYear('')
      return
    }
    setDates(l => [...l, {
      id: newId(), label: dLabel.trim(), day: dd, month: mm, year: yy, isLunar: false,
    }])
    setDLabel(''); setDDay(''); setDMonth(''); setDYear('')
  }
  const removeDate = (id) => setDates(l => l.filter(x => x.id !== id))
  const updateDate = (id, patch) => setDates(l => l.map(x => x.id === id ? { ...x, ...patch } : x))

  const addNote = () => {
    const t = nText.trim()
    if (!t) return toast.error('Nhập nội dung ghi chú')
    setNotes(l => [...l, { id: newId(), text: t, createdAt: Date.now() }])
    setNText('')
  }
  const removeNote = (id) => setNotes(l => l.filter(x => x.id !== id))
  const updateNote = (id, patch) => setNotes(l => l.map(x => x.id === id ? { ...x, ...patch } : x))

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      {/* 2026-11-08 (rev4): Nền slate-100 (tối hơn trắng) — darkmode remap sang
          #1e293b, light mode cũng dịu hơn gradient trắng trước đây. */}
      <div className="relative w-[80dvw] h-[80dvh] bg-slate-100 rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-black/10">
        {/* ── Header gradient — dịu hơn: indigo-700 → blue-700 ── */}
        <div className="shrink-0 px-6 py-4 bg-gradient-to-r from-indigo-700 to-blue-700 text-white flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-xl backdrop-blur-sm">
              🗂️
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold">Ngày quan trọng &amp; ghi chú</div>
              <div className="text-xs text-white/80 truncate">{customer.name}</div>
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-lg text-white/80 hover:bg-white/15 text-xl shrink-0">×</button>
        </div>

        {/* 2026-11-08: Section Người giới thiệu — chỉ khách lẻ. Ở đầu modal
            để nhân viên bàn luôn thấy trước khi scroll xuống ngày/ghi chú. */}
        {customer.isWalkIn && customer.passengerId != null && (
          <div className="shrink-0 px-6 pt-4">
            <ReferrerEditor row={customer} onSaved={onReferrerSaved} />
          </div>
        )}

        {/* ── Panel toggle (segmented) ── */}
        <div className="shrink-0 px-6 pt-4">
          <div className="inline-flex p-1 rounded-xl bg-slate-200 border border-slate-300">
            <button onClick={() => setPanel('notes')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
                panel === 'notes'
                  ? 'bg-white shadow text-amber-700'
                  : 'text-slate-500 hover:text-slate-800'
              }`}>
              <span>📝</span> Ghi chú
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                panel === 'notes' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'
              }`}>{notes.length}</span>
            </button>
            <button onClick={() => setPanel('dates')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
                panel === 'dates'
                  ? 'bg-white shadow text-indigo-700'
                  : 'text-slate-500 hover:text-slate-800'
              }`}>
              <span>📅</span> Ngày quan trọng
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                panel === 'dates' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-600'
              }`}>{dates.length}</span>
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {panel === 'notes' ? (
            <NotesPanel
              notes={notes} nText={nText} setNText={setNText}
              addNote={addNote} removeNote={removeNote} updateNote={updateNote}
              editingNoteId={editingNoteId} setEditingNoteId={setEditingNoteId}
            />
          ) : (
            <DatesPanel
              dates={dates}
              dLabel={dLabel} setDLabel={setDLabel}
              dDay={dDay} setDDay={setDDay}
              dMonth={dMonth} setDMonth={setDMonth}
              dYear={dYear} setDYear={setDYear}
              addDate={addDate} removeDate={removeDate} updateDate={updateDate}
              editingDateId={editingDateId} setEditingDateId={setEditingDateId}
            />
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 px-6 py-3 border-t border-slate-200 bg-white flex items-center gap-2">
          <div className="text-[11px] text-slate-500">
            {dates.length} ngày · {notes.length} ghi chú
          </div>
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Huỷ</button>
          <button onClick={() => onSave({ dates, notes })}
            className="px-5 py-2 text-sm font-bold rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-500/30 hover:shadow-lg">
            💾 Lưu
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Panel: Ghi chú ─────────────────────────────────────────
function NotesPanel({ notes, nText, setNText, addNote, removeNote, updateNote, editingNoteId, setEditingNoteId }) {
  return (
    <div className="space-y-4">
      {/* 2026-11-08 (rev4): Tone neutral — bỏ gradient vàng chói. */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-sm space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700 flex items-center gap-2">
          <span>✍️</span> Thêm ghi chú mới
        </div>
        <textarea value={nText} onChange={e => setNText(e.target.value)}
          placeholder="VD: Khách thích gộp HĐ đầu tháng; email kế toán nh.lan@example.com; thường đặt vé thứ 6…"
          rows={4}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 resize-y leading-relaxed" />
        <div className="flex justify-end">
          <button type="button" onClick={addNote}
            className="h-10 px-4 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-500">
            + Thêm ghi chú
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyState icon="📝" text="Chưa có ghi chú nào — thêm ghi chú đầu tiên ở trên." />
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {notes.map(n => (
            <li key={n.id}
              className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition overflow-hidden">
              {editingNoteId === n.id ? (
                <NoteEditRow value={n} onCancel={() => setEditingNoteId(null)}
                  onSave={(patch) => { updateNote(n.id, patch); setEditingNoteId(null) }} />
              ) : (
                <>
                  <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-400" />
                  <div className="p-3 flex items-start gap-2">
                    <div className="flex-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 min-w-0 break-words">
                      {n.text}
                    </div>
                    <div className="shrink-0 flex items-start gap-1">
                      <button onClick={() => setEditingNoteId(n.id)}
                        title="Sửa"
                        className="text-indigo-600 hover:bg-indigo-50 rounded-md w-8 h-8 text-sm font-semibold">✎</button>
                      <button onClick={() => removeNote(n.id)}
                        title="Xoá"
                        className="text-rose-600 hover:bg-rose-50 rounded-md w-8 h-8 text-lg leading-none">×</button>
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Panel: Ngày quan trọng ─────────────────────────────────
function DatesPanel({
  dates, dLabel, setDLabel, dDay, setDDay, dMonth, setDMonth, dYear, setDYear,
  addDate, removeDate, updateDate, editingDateId, setEditingDateId,
}) {
  return (
    <div className="space-y-4">
      {/* 2026-11-08 (rev4): Tone neutral — bỏ gradient chói, dùng slate-50/100. */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-sm space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-indigo-700 flex items-center gap-2">
          <span>➕</span> Thêm ngày mới
        </div>
        <input type="text" value={dLabel} onChange={e => setDLabel(e.target.value)}
          placeholder="Nhãn (VD: SN sếp Hùng, SN chị Lan, Kỷ niệm thành lập…)"
          className="w-full h-10 px-3 py-0 rounded-lg border border-slate-300 bg-white text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
        <div className="flex flex-wrap gap-2 items-end">
          <LabeledInput label="Ngày" value={dDay} onChange={setDDay} width="w-20" placeholder="DD" maxLen={2} />
          <LabeledInput label="Tháng" value={dMonth} onChange={setDMonth} width="w-20" placeholder="MM" maxLen={2} />
          <LabeledInput label="Năm (tuỳ chọn)" value={dYear} onChange={setDYear} width="w-28" placeholder="YYYY" maxLen={4} />
          <div className="flex-1" />
          <button type="button" onClick={addDate}
            className="h-10 px-4 rounded-lg bg-indigo-700 text-white text-xs font-bold hover:bg-indigo-600">
            + Thêm ngày
          </button>
        </div>
        <div className="text-[10px] text-slate-500">
          💡 Không nhập năm → lặp lại hàng năm. Nhập năm → ngày 1-lần (VD kỷ niệm năm 2027).
        </div>
      </div>

      {dates.length === 0 ? (
        <EmptyState icon="📅" text="Chưa có ngày nào — thêm sinh nhật / kỷ niệm ở trên." />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {dates.map(d => (
            <li key={d.id}
              className="rounded-xl border border-slate-200 bg-slate-50 shadow-sm hover:shadow-md transition overflow-hidden">
              {editingDateId === d.id ? (
                <DateEditRow value={d} onCancel={() => setEditingDateId(null)}
                  onSave={(patch) => { updateDate(d.id, patch); setEditingDateId(null) }} />
              ) : (
                <div className="p-3 flex items-center gap-3">
                  <div className="shrink-0 w-14 h-14 rounded-xl bg-indigo-700 text-white flex flex-col items-center justify-center">
                    <div className="text-[9px] uppercase tracking-wider leading-none mt-0.5">Th {d.month}</div>
                    <div className="text-xl font-black leading-none">{d.day}</div>
                    {d.year && <div className="text-[9px] opacity-80 leading-none mt-0.5">{d.year}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{d.label}</div>
                    <div className="text-[11px] text-slate-500">
                      {fmtDateDMY(d)} · {d.year ? '1 lần' : 'Hàng năm'}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-start gap-1">
                    <button onClick={() => setEditingDateId(d.id)}
                      title="Sửa"
                      className="text-indigo-600 hover:bg-indigo-50 rounded-md w-8 h-8 text-sm font-semibold">✎</button>
                    <button onClick={() => removeDate(d.id)}
                      title="Xoá"
                      className="text-rose-600 hover:bg-rose-50 rounded-md w-8 h-8 text-lg leading-none">×</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LabeledInput({ label, value, onChange, width = 'w-24', placeholder, maxLen = 4 }) {
  // 2026-11-07: input chỉ nhận số, bỏ spinner. Chặn chữ cái / ký tự đặc biệt
  //   ngay từ onChange (regex /\D/g). maxLen = số ký tự tối đa.
  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, maxLen)
    onChange(digits)
  }
  return (
    <div className={width}>
      <div className="text-[10px] font-semibold text-indigo-700 mb-1">{label}</div>
      <input type="text" inputMode="numeric" pattern="[0-9]*"
        value={value} onChange={handleChange}
        placeholder={placeholder}
        className="w-full h-10 px-2 rounded-lg border border-indigo-200 bg-white text-sm font-mono text-center outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
    </div>
  )
}

function EmptyState({ icon, text }) {
  return (
    <div className="py-12 text-center">
      <div className="text-5xl mb-2 opacity-40">{icon}</div>
      <div className="text-sm text-slate-400 italic">{text}</div>
    </div>
  )
}

function fmtDateDMY(d) {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return d.year ? `${dd}/${mm}/${d.year}` : `${dd}/${mm}`
}

function DateEditRow({ value, onSave, onCancel }) {
  const [label, setLabel] = useState(value.label)
  const [day, setDay]     = useState(String(value.day))
  const [month, setMonth] = useState(String(value.month))
  const [year, setYear]   = useState(value.year ? String(value.year) : '')
  const only = (max) => (e) => {
    const s = e.target.value.replace(/\D/g, '').slice(0, max)
    return s
  }
  const commit = () => {
    const dd = parseInt(day, 10), mm = parseInt(month, 10)
    const yy = year.trim() ? parseInt(year, 10) : null
    if (!label.trim()) return toast.error('Nhãn không được trống')
    const err = validateCalendarDate(dd, mm, yy)
    if (err) {
      toast.error(err)
      // user yêu cầu: lỗi → clear phần ngày vừa nhập, để nhập lại.
      setDay(''); setMonth(''); setYear('')
      return
    }
    onSave({ label: label.trim(), day: dd, month: mm, year: yy })
  }
  return (
    <div className="p-3 space-y-2 bg-indigo-50/40">
      <input type="text" value={label} onChange={e => setLabel(e.target.value)}
        className="w-full h-9 px-2 rounded-md border border-indigo-300 bg-white text-sm outline-none focus:border-indigo-500" autoFocus />
      <div className="flex items-center gap-2">
        <input type="text" inputMode="numeric" pattern="[0-9]*" value={day}
          onChange={e => setDay(only(2)(e))}
          className="w-16 h-9 px-1 rounded-md border border-indigo-300 bg-white text-xs font-mono text-center" placeholder="DD" />
        <span className="text-slate-400">/</span>
        <input type="text" inputMode="numeric" pattern="[0-9]*" value={month}
          onChange={e => setMonth(only(2)(e))}
          className="w-16 h-9 px-1 rounded-md border border-indigo-300 bg-white text-xs font-mono text-center" placeholder="MM" />
        <span className="text-slate-400">/</span>
        <input type="text" inputMode="numeric" pattern="[0-9]*" value={year}
          onChange={e => setYear(only(4)(e))}
          className="w-20 h-9 px-1 rounded-md border border-indigo-300 bg-white text-xs font-mono text-center" placeholder="YYYY" />
        <div className="flex-1" />
        <button onClick={onCancel} className="h-9 px-3 rounded-md text-slate-500 hover:bg-slate-100 text-xs">Huỷ</button>
        <button onClick={commit} className="h-9 px-3 rounded-md bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">Lưu</button>
      </div>
    </div>
  )
}

function NoteEditRow({ value, onSave, onCancel }) {
  const [text, setText] = useState(value.text)
  const commit = () => {
    const t = text.trim()
    if (!t) return toast.error('Ghi chú không được trống')
    onSave({ text: t })
  }
  return (
    <div className="p-3 space-y-2 bg-amber-50/40">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={5} autoFocus
        className="w-full px-3 py-2 rounded-md border border-amber-300 bg-white text-sm leading-relaxed resize-y outline-none focus:border-amber-500" />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="h-9 px-3 rounded-md text-slate-500 hover:bg-slate-100 text-xs">Huỷ</button>
        <button onClick={commit} className="h-9 px-3 rounded-md bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">Lưu</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  2026-11-07: DebtDetailModal — chi tiết công nợ khi click
//  Hiển thị:
//    - Mỗi INVOICE đã có số (invoice.invoiceNumbers != null) → 1 dòng:
//      số #C26MCB<n> + số tiền của invoice đó.
//    - Mỗi BOOKING không có invoice nào đã phát hành → 1 dòng:
//      Mã booking + tổng booking.
// ═══════════════════════════════════════════════════════════
function DebtDetailModal({ row, onClose }) {
  const items = useMemo(() => buildDebtItems(row.unpaidBookings || []), [row])
  const total = useMemo(() => items.reduce((s, x) => s + x.amount, 0), [items])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-[80dvw] max-h-[80dvh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-black/5">
        <div className="shrink-0 px-6 py-4 bg-gradient-to-r from-rose-600 to-red-600 text-white flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-xl">💰</div>
            <div className="min-w-0">
              <div className="text-base font-bold">Chi tiết công nợ</div>
              <div className="text-xs text-white/80 truncate">{row.name}</div>
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-lg text-white/80 hover:bg-white/15 text-xl shrink-0">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400 italic">
              Không có hoá đơn / booking chưa thanh toán
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  {/* 2026-11-07 (rev4): bỏ cột "Loại" (badge bây giờ nằm trong
                      "Số hoá đơn"). Thêm "Ngày xuất vé" (vị trí 1) + "Ngày phát
                      hành" (vị trí 3). */}
                  <th className="px-3 py-2.5 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wide w-28">Ngày xuất vé</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wide w-28">Ngày phát hành</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wide w-40">Số hoá đơn</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wide">Mã Booking</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wide">Hành trình</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wide">Tên hành khách</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold text-gray-600 uppercase tracking-wide">Số tiền</th>
                  {/* 2026-11-08: Số ngày công nợ — từ ngày phát hành (nếu có)
                      hoặc ngày xuất vé đến ngày hiện tại. */}
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold text-gray-600 uppercase tracking-wide w-28">Số ngày CN</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-rose-50/30 align-top">
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {fmtDMY(it.saleDate)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {it.type === 'invoice' ? fmtDMY(it.issueDate) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {it.type === 'invoice' ? (
                        <span className="inline-block px-2 py-1 rounded font-mono font-bold text-[11px] bg-indigo-100 text-indigo-800 whitespace-nowrap">
                          {it.code}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="inline-block px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-gray-900 text-white whitespace-nowrap">
                          {it.bookingCode || '—'}
                        </span>
                        {it.airlineCode && (
                          <span className="inline-block px-2 py-0.5 rounded font-mono font-bold text-[10px] whitespace-nowrap"
                            style={{ background: airlineColor(it.airlineCode), color: textOn(airlineColor(it.airlineCode)) }}>
                            {it.airlineCode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-blue-700 font-semibold text-xs">
                      {it.route || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {it.passengers && it.passengers.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          {it.passengers.map((p, j) => (
                            <div key={j}>
                              <div>
                                <span className="font-semibold text-gray-800">{p.name || '—'}</span>
                                {p.ticketNumber && (
                                  <span className="ml-1 font-mono text-[10px] text-gray-500">#{p.ticketNumber}</span>
                                )}
                              </div>
                              {p.fees && p.fees.length > 0 && (
                                <div className="pl-3 mt-0.5 flex flex-col gap-0.5">
                                  {p.fees.map((f, k) => (
                                    <div key={k} className="text-[10px] text-gray-600">
                                      <span className="text-indigo-700">{f.label}</span>
                                      <span className="text-gray-400"> — </span>
                                      <span className="font-mono tabular-nums">
                                        {formatMoney(f.amountVnd, 'VND', { withUnit: false })} VNĐ
                                      </span>
                                      {f.ticketNumber && (
                                        <span className="ml-1 font-mono text-gray-400">#{f.ticketNumber}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-rose-700 whitespace-nowrap">
                      {formatMoney(it.amount, 'VND', { withUnit: false })} <span className="text-[10px] text-gray-500">VND</span>
                    </td>
                    {/* 2026-11-08: Số ngày công nợ. Tính từ ngày phát hành (nếu
                        hóa đơn đã issued), ngược lại từ ngày xuất vé. Badge màu
                        đổi theo mức độ (càng lâu càng đậm). */}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <DebtAgeBadge
                        fromMs={it.type === 'invoice' && it.issueDate ? it.issueDate : it.saleDate} />
                    </td>
                  </tr>
                ))}
                {/* TỔNG CÔNG NỢ — label sát số tiền (~30px). */}
                <tr className="bg-rose-50 border-t-2 border-rose-200">
                  <td colSpan={5} className="px-3 py-2.5"></td>
                  <td className="py-2.5 text-right font-bold text-rose-800 text-sm" style={{ paddingRight: 30 }}>
                    TỔNG CÔNG NỢ
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums font-black text-rose-800 text-sm whitespace-nowrap">
                    {formatMoney(total, 'VND', { withUnit: false })} <span className="text-[10px]">VND</span>
                  </td>
                  <td className="px-3 py-2.5"></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="shrink-0 px-6 py-3 border-t flex items-center gap-2">
          <div className="text-[11px] text-gray-500">
            {items.length} dòng
          </div>
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-100 font-medium">
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Build list items cho DebtDetailModal từ list booking UNPAID.
 * Rule:
 *   - Nếu booking có ≥ 1 invoice có invoiceNumbers → mỗi invoice = 1 dòng
 *     type='invoice', code = "#C26MCB<n>" (join nếu invoice có nhiều số),
 *     amount = tổng sellPrice của các vé mà invoice cover (ticketIds; empty
 *     ticketIds = cover toàn booking). Quy đổi VND nếu USD.
 *   - Nếu booking KHÔNG có invoice nào có số → 1 dòng type='booking',
 *     code = bookingCode, amount = tổng sellPrice toàn booking.
 */
/**
 * ── 2026-11-07 (rev): build route string + passengers kèm vào mỗi item. ──
 */
function buildBookingRoute(segments) {
  const segs = [...(segments || [])].sort((a, b) => (a.segOrder ?? 0) - (b.segOrder ?? 0))
  let out = ''
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const from = s.fromCode || '?'
    const to   = s.toCode   || '?'
    if (i === 0) { out = from + to; continue }
    const prev = segs[i - 1]
    if ((prev.toCode || '') === from) out += to
    else out += '//' + from + to
  }
  return out
}

/**
 * ── 2026-11-07 (rev4): Build ticket passenger payload + fees (quy đổi VND). ──
 */
function buildPassenger(t, b) {
  const fees = (t.fees || []).map(f => {
    const raw = parseAmount(f.amount) || 0
    const isUsd = (f.currency || b.currency || 'VND') === 'USD'
    const amountVnd = isUsd
      ? Math.round(raw * (parseAmount(b.exchangeRate) || 0))
      : raw
    return {
      label: f.feeTypeLabel || f.feeType || 'Phí',
      amountVnd,
      ticketNumber: (f.ticketNumber || '').trim() || null,
    }
  })
  return { name: t.passengerName, ticketNumber: t.ticketNumber, fees }
}

function buildDebtItems(bookings) {
  const out = []
  for (const b of bookings) {
    const route = buildBookingRoute(b.segments)
    const airlineCode = b.airlineCode || null
    const saleDate = b.saleDate ?? b.createdAt ?? null
    const bookingTicketMap = new Map()
    for (const t of (b.tickets || [])) bookingTicketMap.set(t.id, t)
    const invs = (b.invoices || []).filter(i => (i.invoiceNumbers || '').trim())

    if (invs.length === 0) {
      // ── Chưa phát hành → 1 dòng show booking ──
      let total = 0
      const paxs = []
      for (const t of (b.tickets || [])) {
        const s = ticketSums(t, b)
        total += s.ticketPrice + s.issuanceFee
        paxs.push(buildPassenger(t, b))
      }
      if (total > 0.5) {
        out.push({
          type: 'booking', code: b.bookingCode || '—',
          bookingCode: b.bookingCode, airlineCode, saleDate, issueDate: null,
          amount: total, route, passengers: paxs,
        })
      }
      continue
    }
    // ── Đã phát hành → MỖI SỐ HOÁ ĐƠN = 1 DÒNG RIÊNG ──
    //   Nếu 1 invoice có N số (CSV) → chia amount đều cho N để tổng không đổi.
    for (const inv of invs) {
      const ids = (inv.ticketIds && inv.ticketIds.length > 0)
        ? inv.ticketIds
        : [...bookingTicketMap.keys()]
      let amount = 0
      const paxs = []
      for (const id of ids) {
        const t = bookingTicketMap.get(id)
        if (!t) continue
        const s = ticketSums(t, b)
        amount += s.ticketPrice + s.issuanceFee
        paxs.push(buildPassenger(t, b))
      }
      if (amount <= 0.5) continue

      const nums = inv.invoiceNumbers.split(',').map(x => x.trim()).filter(Boolean)
      const n = nums.length
      // Chia đều amount cho N; round phần tử cuối để tổng chính xác đến đồng.
      const per = Math.floor(amount / n)
      const issueDate = inv.updatedAt ?? inv.createdAt ?? null
      nums.forEach((num, idx) => {
        const amt = idx === n - 1 ? amount - per * (n - 1) : per
        out.push({
          type: 'invoice', code: `#C26MCB${num}`,
          bookingCode: b.bookingCode, airlineCode, saleDate, issueDate,
          amount: amt, route, passengers: paxs,
        })
      })
    }
  }
  return out
}

// ═══════════════════════════════════════════════════════════
//  2026-11-08: RevenueDetailModal — click doanh thu (hoặc tên
//  khách lẻ) để xem:
//    - Phí xuất vé Quốc tế gần nhất (breakdown theo phí nếu khác nhau)
//    - Phí xuất vé Quốc nội gần nhất (tương tự)
//    - Người giới thiệu (chỉ khách lẻ)
// ═══════════════════════════════════════════════════════════

/**
 * Gộp list tickets theo số tiền phí xuất vé.
 * Return: [{ amount, names: [...] }, ...] — sorted theo amount desc.
 */
function groupTicketsByFee(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return []
  const m = new Map()
  for (const t of tickets) {
    const k = String(Math.round(t.iss))   // key theo integer VND để tránh floating
    if (!m.has(k)) m.set(k, { amount: t.iss, names: [] })
    m.get(k).names.push(t.name)
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount)
}

function RevenueDetailModal({ row, mode = 'revenue', onClose, onReferrerSaved }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const dom = row.latestDomestic
  const intl = row.latestInternational
  const isReferrer = mode === 'referrer'
  const title = isReferrer ? 'Thông tin khách lẻ' : 'Chi tiết doanh thu'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5">
        <div className={`px-5 py-3 text-white flex items-center justify-between
          ${isReferrer
            ? 'bg-gradient-to-r from-amber-600 to-orange-600'
            : 'bg-gradient-to-r from-emerald-600 to-teal-600'}`}>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/80">
              {title} — {row.isWalkIn ? 'Khách lẻ' : 'Công ty'}
            </div>
            <div className="text-base font-bold truncate">{row.name}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-white/15 text-xl leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
          {isReferrer ? (
            <ReferrerEditor row={row} onSaved={onReferrerSaved} />
          ) : (
            <>
              <FeeBreakdownCard title="Phí xuất vé Quốc tế gần nhất" info={intl} tone="indigo" />
              <FeeBreakdownCard title="Phí xuất vé Quốc nội gần nhất" info={dom} tone="emerald" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 2026-11-08: Editor inline cho người giới thiệu của khách lẻ.
 *   - Rỗng (null/blank) → display "Khách mới" (italic).
 *   - Click "Sửa" → textbox + Lưu/Hủy.
 *   - Lưu → PATCH /passengers/{id}/referrer, cập nhật lại row ở list cha.
 */
function ReferrerEditor({ row, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState(row.referrerName || '')
  const [busy, setBusy]       = useState(false)

  const save = async () => {
    if (!row.passengerId) {
      toast.error('Không xác định được passenger')
      return
    }
    setBusy(true)
    try {
      const v = value.trim()
      await updatePassengerReferrer(row.passengerId, v || null)
      onSaved?.(row.passengerId, v || null)
      setEditing(false)
      toast.success('Đã cập nhật người giới thiệu')
    } catch (e) {
      console.error(e)
      toast.error('Lưu thất bại')
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => { setValue(row.referrerName || ''); setEditing(false) }
  const hasVal = !!(row.referrerName && row.referrerName.trim())

  return (
    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Người giới thiệu</div>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}
            className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 hover:underline">
            ✎ Sửa
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2">
          <input type="text" value={value} autoFocus
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              else if (e.key === 'Escape') cancel()
            }}
            className="w-full px-2 py-1.5 rounded-md bg-white border border-amber-300
              focus:border-amber-500 focus:ring-2 focus:ring-amber-400/30 outline-none text-sm"
            placeholder='VD: "Tiểu Hà (Zalo) thuộc Create Medic" — rỗng = Khách mới' />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={cancel} disabled={busy}
              className="px-3 py-1 rounded-md text-xs font-semibold text-gray-600 hover:bg-gray-100">
              Hủy
            </button>
            <button type="button" onClick={save} disabled={busy}
              className="px-3 py-1 rounded-md text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-60">
              {busy ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 text-sm font-semibold text-amber-800">
          {hasVal
            ? row.referrerName
            : <span className="italic text-gray-500">Khách mới</span>}
        </div>
      )}
    </div>
  )
}

/**
 * Card hiển thị phí xuất vé GẦN NHẤT của 1 loại tuyến.
 *   - info = null → "Chưa có vé loại này".
 *   - tickets cùng amount → "n cho A, B, C".
 *   - tickets khác amount → nhiều dòng, mỗi dòng "n cho A và B".
 * Tone palette chọn class có remap sẵn trong darkmode.css để không bị trôi.
 */
function FeeBreakdownCard({ title, info, tone }) {
  // Bảng tone → bộ class (background + border + label + body).
  //   Dùng class literal (không string interp Tailwind) để JIT giữ được class.
  // Chọn 700/800: darkmode.css có remap các mức này nên hiển thị tốt ở cả 2 theme.
  const toneMap = {
    indigo: {
      bg:    'bg-indigo-50 border-indigo-200',
      label: 'text-indigo-700',
      body:  'text-indigo-800',
      muted: 'text-indigo-700',
    },
    emerald: {
      bg:    'bg-emerald-50 border-emerald-200',
      label: 'text-emerald-700',
      body:  'text-emerald-800',
      muted: 'text-emerald-700',
    },
  }
  const c = toneMap[tone] || toneMap.indigo

  if (!info) {
    return (
      <div className={`p-3 rounded-lg border ${c.bg}`}>
        <div className={`text-[10px] font-bold uppercase tracking-wide ${c.label}`}>{title}</div>
        <div className="mt-1 text-sm italic text-gray-500">Chưa có vé loại này</div>
      </div>
    )
  }
  const groups = groupTicketsByFee(info.tickets)
  const allSame = groups.length === 1
  return (
    <div className={`p-3 rounded-lg border ${c.bg}`}>
      <div className="flex items-center justify-between">
        <div className={`text-[10px] font-bold uppercase tracking-wide ${c.label}`}>{title}</div>
        <div className={`text-[10px] font-mono ${c.muted}`}>
          Booking <b>{info.bookingCode || '—'}</b>
        </div>
      </div>
      {allSame ? (
        <div className={`mt-1 text-sm font-semibold ${c.body}`}>
          <span className="font-mono">{formatMoney(groups[0].amount, 'VND', { withUnit: false })} VNĐ</span>
          {groups[0].names.length > 1 && (
            <span className={`ml-1 ${c.muted} font-normal`}>· cho {groups[0].names.join(', ')}</span>
          )}
        </div>
      ) : (
        <ul className="mt-1 space-y-1">
          {groups.map((g, i) => (
            <li key={i} className={`text-sm font-semibold ${c.body}`}>
              <span className="font-mono">{formatMoney(g.amount, 'VND', { withUnit: false })} VNĐ</span>
              <span className={`ml-1 ${c.muted} font-normal`}>
                · cho {g.names.length > 1
                  ? g.names.slice(0, -1).join(', ') + ' và ' + g.names[g.names.length - 1]
                  : g.names[0]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}