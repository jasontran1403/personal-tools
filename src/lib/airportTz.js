/**
 * Bảng ánh xạ mã IATA → IANA timezone ID.
 *
 * Bao phủ các sân bay Việt Nam + châu Á đông dân + châu Âu/Mỹ hay bay. Nếu mã
 * không có ở đây, hàm {@link zoneOf} fallback về "Asia/Ho_Chi_Minh" — an toàn
 * (không đổi giờ) và log warning ra console để bổ sung dần.
 *
 * Danh sách này ĐỦ dùng cho > 95% chuyến bay của agent Việt. Cần thêm sân bay?
 * Bổ sung 1 dòng, không đổi cấu trúc.
 */
const MAP = {
  // Việt Nam
  SGN: 'Asia/Ho_Chi_Minh',  HAN: 'Asia/Ho_Chi_Minh',  DAD: 'Asia/Ho_Chi_Minh',
  CXR: 'Asia/Ho_Chi_Minh',  PQC: 'Asia/Ho_Chi_Minh',  HPH: 'Asia/Ho_Chi_Minh',
  VII: 'Asia/Ho_Chi_Minh',  HUI: 'Asia/Ho_Chi_Minh',  UIH: 'Asia/Ho_Chi_Minh',
  VCS: 'Asia/Ho_Chi_Minh',  VCL: 'Asia/Ho_Chi_Minh',  BMV: 'Asia/Ho_Chi_Minh',
  DLI: 'Asia/Ho_Chi_Minh',  VDO: 'Asia/Ho_Chi_Minh',  TBB: 'Asia/Ho_Chi_Minh',
  THD: 'Asia/Ho_Chi_Minh',  DIN: 'Asia/Ho_Chi_Minh',  VKG: 'Asia/Ho_Chi_Minh',
  CAH: 'Asia/Ho_Chi_Minh',

  // Nhật
  HND: 'Asia/Tokyo',  NRT: 'Asia/Tokyo',  KIX: 'Asia/Tokyo',  ITM: 'Asia/Tokyo',
  KMJ: 'Asia/Tokyo',  FUK: 'Asia/Tokyo',  CTS: 'Asia/Tokyo',  NGO: 'Asia/Tokyo',
  OKA: 'Asia/Tokyo',  HIJ: 'Asia/Tokyo',  SDJ: 'Asia/Tokyo',

  // Hàn Quốc
  ICN: 'Asia/Seoul',  GMP: 'Asia/Seoul',  PUS: 'Asia/Seoul',  CJU: 'Asia/Seoul',

  // Trung Quốc + HK/Macau/Đài Loan
  PVG: 'Asia/Shanghai', SHA: 'Asia/Shanghai', PEK: 'Asia/Shanghai',
  PKX: 'Asia/Shanghai', CAN: 'Asia/Shanghai', SZX: 'Asia/Shanghai',
  CTU: 'Asia/Shanghai', HGH: 'Asia/Shanghai', NKG: 'Asia/Shanghai',
  KMG: 'Asia/Shanghai', XIY: 'Asia/Shanghai', TAO: 'Asia/Shanghai',
  HKG: 'Asia/Hong_Kong', MFM: 'Asia/Macau',
  TPE: 'Asia/Taipei', TSA: 'Asia/Taipei', KHH: 'Asia/Taipei',

  // Đông Nam Á
  BKK: 'Asia/Bangkok', DMK: 'Asia/Bangkok', HKT: 'Asia/Bangkok',
  CNX: 'Asia/Bangkok', USM: 'Asia/Bangkok',
  SIN: 'Asia/Singapore',
  KUL: 'Asia/Kuala_Lumpur', PEN: 'Asia/Kuala_Lumpur',
  MNL: 'Asia/Manila', CEB: 'Asia/Manila', DVO: 'Asia/Manila',
  DPS: 'Asia/Makassar', CGK: 'Asia/Jakarta', SUB: 'Asia/Jakarta',
  RGN: 'Asia/Yangon',
  PNH: 'Asia/Phnom_Penh', REP: 'Asia/Phnom_Penh',
  VTE: 'Asia/Vientiane', LPQ: 'Asia/Vientiane',

  // Nam Á + Trung Đông
  DEL: 'Asia/Kolkata', BOM: 'Asia/Kolkata', MAA: 'Asia/Kolkata',
  DXB: 'Asia/Dubai',   AUH: 'Asia/Dubai',   DOH: 'Asia/Qatar',
  IST: 'Europe/Istanbul',

  // Châu Âu
  LHR: 'Europe/London',  LGW: 'Europe/London',
  CDG: 'Europe/Paris',   ORY: 'Europe/Paris',
  FRA: 'Europe/Berlin',  MUC: 'Europe/Berlin',
  AMS: 'Europe/Amsterdam',
  MAD: 'Europe/Madrid',  BCN: 'Europe/Madrid',
  FCO: 'Europe/Rome',    MXP: 'Europe/Rome',
  ZRH: 'Europe/Zurich',
  VIE: 'Europe/Vienna',
  SVO: 'Europe/Moscow',  DME: 'Europe/Moscow',

  // Mỹ + Canada + Úc
  LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', SEA: 'America/Los_Angeles',
  JFK: 'America/New_York',    EWR: 'America/New_York',    BOS: 'America/New_York',
  ORD: 'America/Chicago',     DFW: 'America/Chicago',     ATL: 'America/New_York',
  YVR: 'America/Vancouver',   YYZ: 'America/Toronto',
  SYD: 'Australia/Sydney',    MEL: 'Australia/Melbourne', BNE: 'Australia/Brisbane',
}

/** ZoneId cho FE. Fallback về giờ VN nếu chưa có trong bảng. */
export function zoneOf(iata) {
  if (!iata) return 'Asia/Ho_Chi_Minh'
  const z = MAP[iata.toUpperCase()]
  if (!z) {
    if (typeof console !== 'undefined') {
      console.warn(`[airportTz] Chưa có mapping cho ${iata}, dùng giờ VN tạm.`)
    }
    return 'Asia/Ho_Chi_Minh'
  }
  return z
}

/** VN time reference — countdown luôn dùng zone này (theo yêu cầu). */
export const VN_ZONE = 'Asia/Ho_Chi_Minh'

/**
 * Format epoch millis (UTC) theo timezone của một sân bay.
 * Trả về "DDMMM HH:mm" ví dụ "23Oct 23:15" — quy ước của agent vé.
 */
export function formatDepart(msUtc, iata) {
  if (!msUtc) return ''
  const tz = zoneOf(iata)
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(msUtc))
    const p = (t) => parts.find(x => x.type === t)?.value || ''
    return `${p('day')}${p('month')} ${p('hour')}:${p('minute')}`
  } catch {
    return new Date(msUtc).toISOString().slice(0, 16).replace('T', ' ')
  }
}

/**
 * Chuyển từ (yyyy-MM-dd HH:mm giờ địa phương của airport) → epoch millis UTC.
 * Dùng khi người dùng nhập giờ khởi hành ở form: FE đưa cho BE luôn ms UTC.
 *
 * Kỹ thuật: ta biết "wall time" (23:15) và biết TZ ("Asia/Tokyo"). Cần tìm
 * millis UTC sao cho format theo TZ đó ra đúng wall time.
 *
 * Cách đơn giản: dựng UTC tạm bằng Date.UTC(y,m,d,h,mm), rồi tìm offset của TZ
 * ở thời điểm đó và trừ đi. Cách này chính xác cho hầu hết case (kể cả DST) trừ
 * đúng 1-2 giờ chuyển đổi DST — chấp nhận vì agent vé không đặt lịch bay ngay
 * giữa lúc lùi giờ.
 */
export function localWallToUtcMs(dateStr, timeStr, iata) {
  if (!dateStr || !timeStr) return null
  const tz = zoneOf(iata)

  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = timeStr.split(':').map(Number)
  if (!y || !mo || !d) return null

  // Bước 1: giả sử đó là UTC → có epoch tạm
  const guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0, 0)
  // Bước 2: xem cùng thời điểm này thì "hiển thị theo TZ" ra mấy giờ
  const tzWall = wallInZone(new Date(guess), tz)
  const wantWall = Date.UTC(y, mo - 1, d, h || 0, mi || 0, 0)
  // Bước 3: chênh lệch = offset của TZ tại thời điểm đó
  const offset = tzWall - wantWall
  return guess - offset
}

/** Ngược lại: epoch UTC → { date: "YYYY-MM-DD", time: "HH:MM" } theo TZ của sân bay */
export function utcMsToLocalWall(ms, iata) {
  if (!ms) return { date: '', time: '' }
  const tz = zoneOf(iata)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(ms))
    const p = (t) => parts.find(x => x.type === t)?.value || ''
    return { date: `${p('year')}-${p('month')}-${p('day')}`, time: `${p('hour')}:${p('minute')}` }
  } catch {
    return { date: '', time: '' }
  }
}

// ── Internal ──────────────────────────────────────────────

/** Trả về epoch tương đương "wall time trong TZ" nếu ta đọc nó là UTC */
function wallInZone(d, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t) => Number(parts.find(x => x.type === t)?.value || 0)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
}
