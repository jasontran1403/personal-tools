/**
 * Xuất báo cáo "Các vé đã bán" ra PDF (landscape A4).
 *
 * ── Dependencies ──────────────────────────────────────────
 *   npm install pdfmake
 * pdfmake dùng Roboto mặc định → hỗ trợ tiếng Việt sẵn (không phải cài font).
 *
 * ── Nguồn dữ liệu ──────────────────────────────────────────
 * {@link exportBookingsReport} nhận filterParams giống UI đang dùng (q,
 * fromSale, toSale) → tự paginate qua toàn bộ và gom lại. Không giới hạn
 * chỉ trang hiện tại. Safety cap 50 request × 200/page = 10.000 booking.
 *
 * ── Bố cục cột (khớp yêu cầu) ────────────────────────────
 *   A  Loại/Hãng
 *   B  Tên khách hàng (công ty); khách lẻ → "Khách lẻ"
 *   C  Mã booking (rowSpan cả booking)
 *   D  Hành khách + số vé (2 dòng)
 *   E  Hành trình + ngày giờ (rowSpan cả booking)
 *   F  Giá gốc
 *   G  Phí thu hộ (nếu 0 → "—")
 *   H  Danh sách phí phát sinh (mỗi loại 1 dòng: "Phí ... 800.000")
 *   I  Thành tiền vé (base + coll + Σfees)
 *   J  Phí xuất vé
 *   K  Giá bán (Thành tiền + phí xuất vé)
 *   L  Tổng tiền booking (rowSpan cả booking)
 *   M  Quy đổi VND (chỉ khi currency=USD, rowSpan cả booking)
 *   N  Note (rowSpan cả booking)
 *
 * ── 2026-09-21 cập nhật ─────────────────────────────────
 * 1. Đơn vị tiền tệ hiển thị trong từng ô tiền (Giá gốc, Phí thu hộ, Các loại
 *    phí, Thành tiền vé, Phí xuất vé, Giá bán). VND → xám, USD → xanh.
 * 2. Cột Tổng booking: dòng tổng theo đơn vị vé + dòng quy đổi VND (xanh) +
 *    dòng "Tỷ giá ..." (thay cho "TG ...").
 * 3. Header: "DANH SÁCH" thay cho "BÁO CÁO CÁC VÉ ĐÃ BÁN".
 * 4. Date range cùng ngày → "trong ngày dd/MM/yyyy".
 * 5. Ô không có data → emdash "—" thay vì "-".
 * 6. Bỏ đơn vị tiền tệ ở ô Mã BK (đã chuyển vào các ô tiền).
 *
 * ── 2026-09-21 (lần 2) ──────────────────────────────────
 * 7. BỎ màu nền theo loại tiền — tất cả row đều nền trắng.
 * 8. Đơn vị trong ô Tổng booking:
 *    - Sau số tổng booking → in đậm (cùng bold với số).
 *    - Sau số tổng đã quy đổi VND → cùng style với số (bold + màu xanh).
 *
 * ── 2026-09-21 (lần 3) ──────────────────────────────────
 * 9. BỎ màu xanh của đơn vị USD ở các cột tiền thường (Giá gốc, Phí thu hộ,
 *    Các loại phí, Thành tiền vé, Phí xuất vé, Giá bán) → dùng màu xám cho
 *    tất cả đơn vị. CHỈ giữ màu xanh ở cột Tổng booking.
 */

import { parseAmount, formatMoney } from '../lib/money'
import { listBookings } from '../services/vmbApi'

const KIND_LABEL = {
  NEW: 'Vé mới',
  EXCHANGE: 'Đổi',
  REFUND: 'Hoàn',
  SERVICE: 'Dịch vụ',
}

// Vietnamese label cho fee code — trùng LABELS_VI ở BE VmbFeeType.
// Nếu BE bơm feeTypeLabel qua DTO, dùng đó. Fallback ở đây để backup.
const FEE_LABEL = {
  CHANGE_TICKET: 'Phí đổi vé',
  REFUND_TICKET: 'Phí hoàn vé',
  BAGGAGE: 'Phí hành lý',
  SEAT: 'Phí chỗ ngồi',
  MEAL: 'Phí suất ăn',
  FAST_TRACK: 'Phí fast track',
  INSURANCE: 'Phí bảo hiểm',
  SPECIAL_ASSISTANCE: 'Phí trợ giúp đặc biệt',
  UNACCOMPANIED_MINOR: 'Phí trẻ em đi một mình',
  PET: 'Phí mang theo thú cưng',
  PRICE_UPGRADE: 'Phí nâng giá thường',
}

// ── Màu header ─────────────────────────────────────────────
const COLOR_HEADER = '#1E293B'   // slate-800
const COLOR_HEADER_TEXT = '#FFFFFF'

// ── Màu đơn vị tiền tệ ────────────────────────────────────
const CURRENCY_COLOR_VND = '#6B7280'   // gray-500
const CURRENCY_COLOR_USD = '#0284C7'   // sky-600

// ── 2026-11-07: Màu nền cho booking đã thanh toán ─────────
//   Màu xanh lá NHẠT — đọc rõ chữ đen, không chọi với màu header.
const COLOR_PAID_BG = '#DCFCE7'        // green-100 (tailwind)

/**
 * Fetch toàn bộ booking match filter, phân trang tự động.
 */
async function fetchAllBookings(filterParams, onProgress) {
  const all = []
  let page = 0
  const MAX_PAGES = 50
  while (page < MAX_PAGES) {
    const res = await listBookings({ ...filterParams, page, size: 200 })
    const d = res.data?.data
    const content = d?.content || []
    all.push(...content)
    if (onProgress) onProgress(all.length, d?.totalElements || all.length)
    const totalPages = d?.totalPages || 1
    if (page + 1 >= totalPages) break
    page++
  }
  return all
}

// ── Groupp ticket theo company — MATCH UI ─────────────────
// UI (TicketsTab.groupTicketsByCompany) gộp tickets cùng companyId liền nhau,
// giữ thứ tự companyId lần đầu xuất hiện. Port đúng logic đó để PDF khớp
// thứ tự trên bảng.
function groupTicketsByCompany(tickets) {
  const buckets = new Map()
  for (const t of tickets || []) {
    const key = t.companyId == null ? 'none' : `c${t.companyId}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(t)
  }
  const out = []
  for (const arr of buckets.values()) out.push(...arr)
  return out
}

// ── Helpers định dạng ──────────────────────────────────────

/**
 * Format số tiền — KHÔNG kèm đơn vị (đơn vị hiển thị riêng).
 * Không có data hoặc = 0 → emdash.
 */
function fmt(n, currency = 'VND') {
  const v = typeof n === 'number' ? n : parseAmount(n)
  if (!Number.isFinite(v) || v === 0) return '—'
  return formatMoney(v, currency, { withUnit: false })
}

/**
 * Text đơn vị tiền tệ — LUÔN dùng màu xám (không phân biệt VND/USD).
 * Áp dụng cho các cột tiền thường (Giá gốc, Phí thu hộ, Các loại phí,
 * Thành tiền vé, Phí xuất vé, Giá bán).
 */
function currencyUnit(currency) {
  return {
    text: currency === 'USD' ? 'USD' : 'VNĐ',
    fontSize: 6.5,
    color: CURRENCY_COLOR_VND,
    bold: true,
  }
}

function fmtDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** dd/MM/yy — dùng trong ô Loại/Hãng cho gọn */
function fmtDateShort(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`
}

function fmtDateTimeShort(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

function passengerLine(t) {
  const name = t.passengerName || ''
  const num = t.ticketNumber || ''
  return [
    { text: name, bold: true, fontSize: 8 },
    { text: num, fontSize: 7, color: '#666' },
  ]
}

function routeLine(b) {
  const segs = b.segments || []
  if (segs.length === 0) return [{ text: '—', fontSize: 8, color: '#aaa' }]
  // ── Mỗi hành trình 1 dòng, dùng em dash "—", KHÔNG hiển thị giờ bay ──
  return segs.map(s => ({
    text: `${s.fromCode} — ${s.toCode}`,
    fontSize: 8,
    bold: true,
  }))
}

/**
 * ── 2026-11-07 ────────────────────────────────────────────
 * Bỏ tiền tố "Phí " ở đầu nhãn và viết hoa chữ cái đầu của phần còn lại.
 *   "Phí hành lý"   → "Hành lý"
 *   "Phí chỗ ngồi"  → "Chỗ ngồi"
 *   "phí suất ăn"   → "Suất ăn"
 *   "Hành lý ký gửi" (không có tiền tố) → "Hành lý ký gửi"
 */
function stripFeePrefix(label) {
  if (!label) return ''
  const m = /^\s*phí\s+(.+)$/i.exec(label)
  if (!m) return label
  const rest = m[1]
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

function feesLines(t, currency) {
  const fees = t.fees || []
  if (fees.length === 0) return [{ text: '—', fontSize: 8, color: '#aaa' }]
  // ── 2026-11-07 (rev2): Full-width, cả tên phí lẫn số tiền đều CANH TRÁI
  //   cho thẳng hàng. Bỏ "Phí " ở đầu nhãn.
  //     Hành lý
  //     1.000.000
  //     Chỗ ngồi
  //     1.000.000
  // 2026-11-07 (rev3): canh PHẢI cả tên phí lẫn số tiền để thẳng hàng với
  //   các cột tiền bên cạnh.
  const out = []
  fees.forEach((f, i) => {
    if (i > 0) out.push({ text: '', fontSize: 2 })   // spacer giữa 2 cụm phí
    const rawLabel = f.feeTypeLabel || FEE_LABEL[f.feeType] || f.feeType
    out.push({
      text: stripFeePrefix(rawLabel),
      fontSize: 7.5,
      alignment: 'right',
      color: '#334155',
    })
    out.push({
      text: fmt(f.amount, currency),
      fontSize: 7.5,
      alignment: 'right',
      bold: true,
    })
  })
  return out
}

function customerLabel(t) {
  // Có company → tên công ty đầy đủ. Không có → "Khách lẻ".
  if (t.companyName && t.companyName.trim()) return t.companyName.trim()
  return 'Khách lẻ'
}

/**
 * ── 2026-11-07 (rev): kindLine giờ gộp luôn cột "Khách hàng" cũ ──
 * Thứ tự dòng trong cell:
 *   1. Loại           (Vé mới / Đổi / Dịch vụ / Hoàn) — bold
 *   2. Khách hàng     (companyName hoặc "Khách lẻ") — medium
 *   3. Ngày bán       (dd/MM/yy)
 *   4. Hãng           (airlineCode) — small, xám
 * Cột "Khách hàng" riêng đã bị bỏ, dữ liệu dời hết vào đây.
 */
function kindLine(b, t) {
  const lines = [
    { text: KIND_LABEL[b.kind] || b.kind || '—', bold: true, fontSize: 8 },
  ]
  lines.push({ text: customerLabel(t), fontSize: 7.5, color: '#334155' })
  if (b.saleDate) {
    lines.push({ text: fmtDateShort(b.saleDate), fontSize: 7, color: '#888' })
  }
  if (b.airlineCode) {
    // 2026-11-07 (rev): prefix "Hãng bay " trước mã hãng cho rõ.
    lines.push({ text: `Hãng bay ${b.airlineCode}`, fontSize: 7, color: '#666' })
  }
  return lines
}

function noteLine(b) {
  const lines = []
  if (b.note && b.note.trim()) lines.push({ text: b.note.trim(), fontSize: 7 })
  // Có thể gộp thêm note của từng ticket nếu muốn — hiện chỉ hiển thị note booking-level
  return lines.length ? lines : [{ text: '—', fontSize: 7, color: '#aaa' }]
}

// ── Tính toán từng dòng vé ────────────────────────────────

function ticketNumbers(t) {
  const base = parseAmount(t.basePrice) || 0
  const coll = parseAmount(t.collectionFee) || 0
  const iss = parseAmount(t.issuanceFee) || 0
  const feesSum = (t.fees || []).reduce((s, f) => s + (parseAmount(f.amount) || 0), 0)
  const subTotal = base + coll + feesSum
  const sellPrice = subTotal + iss
  return { base, coll, iss, feesSum, subTotal, sellPrice }
}

function bookingTotals(b) {
  let total = 0
  for (const t of (b.tickets || [])) {
    total += ticketNumbers(t).sellPrice
  }
  return total
}

// ── Xây body table ────────────────────────────────────────

function buildRows(bookings) {
  const rows = []
  for (const b of bookings) {
    // ── sort tickets giống UI (group theo companyId) ──
    const tickets = groupTicketsByCompany(b.tickets || [])
    if (tickets.length === 0) continue
    const N = tickets.length
    const total = bookingTotals(b)
    // ── BỎ màu nền theo loại tiền — tất cả row nền trắng ──
    const rowBg = null

    // ── Cột Tổng booking ──
    // - VND: 1 dòng tổng (bold) + đơn vị in đậm cùng style số.
    // - USD: dòng 1 = tổng USD + đơn vị USD (bold cùng số), dòng 2 = ≈ VND +
    //   đơn vị VND (cùng style với số: bold + màu xanh), dòng 3 = "Tỷ giá ...".
    // ── CHỈ cột này giữ màu xanh cho đơn vị USD / VND quy đổi ──
    const isUsd = b.currency === 'USD'
    const unitColor = isUsd ? CURRENCY_COLOR_USD : CURRENCY_COLOR_VND

    const totalStack = [
      {
        columns: [
          { text: fmt(total, b.currency), bold: true, fontSize: 8, alignment: 'right', width: '*' },
          {
            text: isUsd ? 'USD' : 'VNĐ',
            bold: true,                       // in đậm cùng số tổng
            fontSize: 6.5,
            color: unitColor,
            alignment: 'right',
            width: 'auto',
            margin: [2, 0, 0, 0],
          },
        ],
        columnGap: 0,
      },
    ]
    if (isUsd) {
      const rate = parseAmount(b.exchangeRate) || 0
      const vnd = total * rate
      totalStack.push(
        {
          columns: [
            {
              text: '≈ ' + formatMoney(vnd, 'VND', { withUnit: false }),
              fontSize: 7.5,
              color: CURRENCY_COLOR_USD,
              alignment: 'right',
              bold: true,
              width: '*',
            },
            {
              // cùng style với số đã quy đổi: bold + màu xanh
              text: 'VNĐ',
              fontSize: 6.5,
              color: CURRENCY_COLOR_USD,
              bold: true,
              alignment: 'right',
              width: 'auto',
              margin: [2, 0, 0, 0],
            },
          ],
          columnGap: 0,
        },
        {
          text: 'Tỷ giá ' + formatMoney(rate, 'VND', { withUnit: false }),
          fontSize: 6.5,
          color: '#666',
          alignment: 'right',
        },
      )
    }

    // ── 2026-11-07: Booking PAID → fillColor xanh lá nhạt ở mọi cell của
    //   mọi dòng vé thuộc booking. Guard total ≈ 0 → coi là PAID (dữ liệu
    //   cũ có thể chưa rollup nhưng về logic là đã thanh toán).
    const isPaid = (b.paymentStatus === 'PAID') || (total <= 0.5)
    const paidFill = isPaid ? { fillColor: COLOR_PAID_BG } : null

    tickets.forEach((t, i) => {
      const n = ticketNumbers(t)
      const isFirst = i === 0
      const cell = (content, extra = {}) => ({
        stack: Array.isArray(content) ? content : [content],
        ...(paidFill || {}),
        ...extra,
      })
      // Ô số tiền: số ở trên (align right), đơn vị ở dưới (align right).
      // Không có data → chỉ hiển thị emdash, KHÔNG hiển thị đơn vị.
      const numCell = (v) => {
        const val = typeof v === 'number' ? v : parseAmount(v)
        const isEmpty = !Number.isFinite(val) || val === 0
        return {
          stack: [
            { text: isEmpty ? '—' : formatMoney(val, b.currency, { withUnit: false }), fontSize: 8, alignment: 'right' },
            ...(isEmpty ? [] : [{ ...currencyUnit(b.currency), alignment: 'right', margin: [0, 0, 0, 0] }]),
          ],
          alignment: 'right',
          ...(paidFill || {}),
        }
      }

      // 2026-11-07 (rev): bỏ cột "Khách hàng" — customerLabel gộp vào kindLine.
      const row = [
        cell(kindLine(b, t)),
      ]
      // Booking code — rowSpan, BỎ đơn vị tiền tệ
      if (isFirst) {
        row.push(cell(
          [
            { text: b.bookingCode || '—', bold: true, fontSize: 8 },
          ],
          { rowSpan: N }
        ))
      } else {
        row.push(paidFill ? { ...paidFill } : {})
      }
      row.push(cell(passengerLine(t)))
      if (isFirst) {
        row.push(cell(routeLine(b), { rowSpan: N }))
      } else {
        row.push(paidFill ? { ...paidFill } : {})
      }
      row.push(numCell(n.base))
      row.push(numCell(n.coll))
      // Cột Các loại phí: list phí, mỗi dòng "nhãn ... số tiền".
      // Đơn vị tiền tệ hiển thị 1 lần ở cuối (chỉ khi có phí).
      row.push(cell(
        [
          ...feesLines(t, b.currency),
          ...(t.fees && t.fees.length > 0
            ? [{ ...currencyUnit(b.currency), alignment: 'right', margin: [0, 2, 0, 0] }]
            : []),
        ],
        { alignment: 'left' }
      ))
      row.push(numCell(n.subTotal))
      row.push(numCell(n.iss))
      row.push(numCell(n.sellPrice))
      // Tổng booking (gộp quy đổi VND) — rowSpan
      if (isFirst) {
        row.push(cell(totalStack, { rowSpan: N, alignment: 'right' }))
      } else {
        row.push(paidFill ? { ...paidFill } : {})
      }
      // Note — rowSpan
      if (isFirst) {
        row.push(cell(noteLine(b), { rowSpan: N }))
      } else {
        row.push(paidFill ? { ...paidFill } : {})
      }

      rows.push(row)
    })
  }
  return rows
}

// ── Header của bảng ────────────────────────────────────────

function tableHeader() {
  const h = (text) => ({
    text,
    bold: true,
    fontSize: 8,
    color: COLOR_HEADER_TEXT,
    fillColor: COLOR_HEADER,
    alignment: 'center',
  })
  return [
    // 2026-11-07 (rev): Bỏ cột "Khách hàng" — gộp vào "Loại/Hãng".
    h('Loại/Hãng'),
    h('Mã BK'),
    h('Hành khách'),
    h('Hành trình'),
    h('Giá gốc'),
    h('Phí thu hộ'),
    h('Các loại phí'),
    h('Thành tiền vé'),
    h('Phí xuất vé'),
    h('Giá bán'),
    h('Tổng booking\n(quy đổi VNĐ)'),
    h('Ghi chú'),
  ]
}

// ── Xác định khoảng thời gian trên header ────────────────

function computeDateRange(filterParams, bookings) {
  // Ưu tiên filter, nếu không đủ 2 mốc thì lấy min/max saleDate
  let fromMs = filterParams?.fromSale ?? null
  let toMs = filterParams?.toSale ?? null
  if (!fromMs || !toMs) {
    let minD = null, maxD = null
    for (const b of bookings) {
      if (!b.saleDate) continue
      if (minD == null || b.saleDate < minD) minD = b.saleDate
      if (maxD == null || b.saleDate > maxD) maxD = b.saleDate
    }
    if (!fromMs) fromMs = minD
    if (!toMs) toMs = maxD
  }
  return { fromMs, toMs }
}

/**
 * Tạo text date range cho header.
 * - Cùng 1 ngày → "trong ngày dd/MM/yyyy"
 * - Khác ngày → "từ ngày ... đến ngày ..."
 * - Chỉ có 1 mốc → "từ ngày ..." / "đến ngày ..."
 * - Không có → "(toàn bộ)"
 */
function formatDateRangeText(fromMs, toMs) {
  if (fromMs && toMs) {
    const fromDate = new Date(fromMs)
    const toDate = new Date(toMs)
    const sameDay =
      fromDate.getFullYear() === toDate.getFullYear() &&
      fromDate.getMonth() === toDate.getMonth() &&
      fromDate.getDate() === toDate.getDate()
    if (sameDay) {
      return `trong ngày ${fmtDate(fromMs)}`
    }
    return `từ ngày ${fmtDate(fromMs)} đến ngày ${fmtDate(toMs)}`
  }
  if (fromMs) return `từ ngày ${fmtDate(fromMs)}`
  if (toMs) return `đến ngày ${fmtDate(toMs)}`
  return '(toàn bộ)'
}

/**
 * Sinh và tải PDF báo cáo.
 * @param {Object} filterParams  {q?, fromSale?, toSale?} y hệt UI
 */
export async function exportBookingsReport(filterParams, { onProgress } = {}) {
  const bookings = await fetchAllBookings(filterParams, onProgress)
  if (bookings.length === 0) throw new Error('Không có booking nào để xuất')

  // ── KHÔNG sort — giữ nguyên thứ tự API, khớp UI ──
  // BE trả về theo order search() (thường createdAt/saleDate desc); UI hiển
  // thị y hệt. Xuất PDF cũng phải theo đúng thứ tự đó.

  const { fromMs, toMs } = computeDateRange(filterParams, bookings)
  const dateRange = formatDateRangeText(fromMs, toMs)

  const body = [tableHeader(), ...buildRows(bookings)]

  // ── widths ────────────────────────────────────────────
  // 2026-11-07 (rev): Customer -5pt, Route -10pt, Booking +15pt
  //   (mã BK dài 6 ký tự + có khi 2 mã dạng STETEA/ETAET nên cần thêm chỗ).
  // 2026-11-07 (rev3): Bỏ cột "Khách hàng" (63pt), redistribute theo % request.
  //   % tính trên width CŨ của từng cột.
  // 2026-11-07 (rev4): Fees -15 → Kind +15 (để chứa "Hãng bay <mã>").
  const widths = [
    57,   // A Kind + Customer      (42 +15)
    47,   // B Booking
    103,  // C Passenger
    55,   // D Route
    53,   // E Base
    46,   // F Coll
    74,   // G Fees                 (89 -15)
    57,   // H Subtotal
    42,   // I Issuance
    57,   // J Sell
    78,   // K Total + VND (merged)
    '*',  // L Note
  ]

  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [20, 55, 20, 30],
    header: {
      margin: [20, 18, 20, 0],
      stack: [
        // ── Header: "DANH SÁCH" ──
        { text: 'DANH SÁCH', fontSize: 14, bold: true, alignment: 'center' },
        { text: dateRange, fontSize: 10, alignment: 'center', margin: [0, 2, 0, 0] },
      ],
    },
    footer: (currentPage, pageCount) => ({
      text: `Trang ${currentPage}/${pageCount}  ·  Xuất lúc ${new Date().toLocaleString('vi-VN')}  ·  ${bookings.length} booking`,
      fontSize: 7,
      alignment: 'center',
      color: '#666',
      margin: [0, 10, 0, 0],
    }),
    content: [
      {
        table: {
          headerRows: 1,
          widths,
          body,
          dontBreakRows: true,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#CBD5E1',
          vLineColor: () => '#CBD5E1',
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      },
    ],
    defaultStyle: {
      fontSize: 8,
    },
  }

  // Dynamic import pdfmake để tránh nặng khi chưa dùng
  const pdfMakeMod = await import('pdfmake/build/pdfmake')
  const vfsMod = await import('pdfmake/build/vfs_fonts')

  // pdfmake ESM/CJS interop — lấy default nếu có, không thì lấy module trực tiếp
  const pdfMake = pdfMakeMod.default || pdfMakeMod

  // vfs loading khác nhau giữa các bản pdfmake:
  //   v0.1.x  : vfsMod.pdfMake.vfs
  //   v0.2.x  : vfsMod.default.pdfMake.vfs (hoặc vfsMod.pdfMake.vfs với CJS)
  //   v0.2.10+: vfsMod.vfs hoặc vfsMod.default (đôi khi vfs = object trực tiếp)
  const vfs =
    vfsMod?.pdfMake?.vfs
    ?? vfsMod?.default?.pdfMake?.vfs
    ?? vfsMod?.default?.vfs
    ?? vfsMod?.vfs
    ?? vfsMod?.default
    ?? vfsMod
  pdfMake.vfs = vfs

  const filename = `bao-cao-ve-${fmtDate(fromMs || Date.now())}-${fmtDate(toMs || Date.now())}.pdf`
    .replace(/\//g, '-')

  // ── 2026-09-25 v2: DÙNG pdfMake.download() (như gốc) ──────────────────
  // v1 đã thử showSaveFilePicker({ startIn: 'desktop' }) cho UX "mở dialog
  // sẵn ở Desktop", NHƯNG API này yêu cầu "transient user activation" —
  // phải chạy ngay sau user click. Sau chuỗi await (dynamic import + fetch
  // bookings, mất vài giây), activation đã hết. Ở nhiều bản Chrome,
  // showSaveFilePicker khi thiếu activation KHÔNG reject mà silently hang
  // → Promise không resolve → toàn bộ chain treo → nút "Xuất PDF" kẹt ở
  // "Đang xuất…". Đây là bug user report.
  //
  // Cách chắc chắn: dùng <a download> qua pdfMake.download() (giống code
  // gốc). Trình duyệt sẽ save vào download folder mặc định.
  //
  // Muốn tự động save về Desktop mà không hỏi:
  //   Chrome → Settings → Downloads:
  //     - Location: chọn Desktop
  //     - Ask where to save each file before downloading: TẮT
  //
  // Đây là setting per-browser, không code nào bypass được (vì lý do
  // security).
  pdfMake.createPdf(docDefinition).download(filename)

  // Trả bookings + date range để caller (TicketsTab) chain bước tiếp theo:
  // (a) check date range có phải "trong ngày" không,
  // (b) hỏi có tải hóa đơn nháp không.
  return { bookings, fromMs, toMs }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Draft invoice batch download — 2026-09-25
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Đếm số hóa đơn nháp có file draftUrl trong danh sách bookings.
 * Dùng để quyết định có hiện modal hỏi hay không (0 → không hỏi).
 */
export function countDraftInvoices(bookings) {
  let n = 0
  for (const b of bookings || []) {
    for (const inv of b.invoices || []) if (inv.draftUrl) n++
  }
  return n
}

/**
 * GUARD 1 — Chỉ mời tải hóa đơn nháp khi date range của báo cáo NẰM HOÀN
 * TOÀN trong ngày hôm nay (local timezone). Cả 2 mốc phải cùng năm/tháng/
 * ngày với hôm nay. Nếu 1 trong 2 null (không xác định) → false.
 *
 * Lý do: hóa đơn nháp là workflow trong ngày — chốt cuối ngày mới phát hành.
 * Nếu report gộp cả tuần thì các booking cũ đã có hóa đơn ISSUED, không cần
 * kèm draft.
 */
export function isRangeWithinToday(fromMs, toMs) {
  if (!fromMs || !toMs) return false
  const t = new Date()
  const Y = t.getFullYear(), M = t.getMonth(), D = t.getDate()
  const sameToday = (ms) => {
    const dt = new Date(ms)
    return dt.getFullYear() === Y && dt.getMonth() === M && dt.getDate() === D
  }
  return sameToday(fromMs) && sameToday(toMs)
}

/**
 * GUARD 2 — Tìm các vé CHƯA có hóa đơn nháp bao phủ.
 *
 * Rule "bao phủ" (theo yêu cầu 2026-09-25):
 *   Mỗi vé phải xuất hiện trong ít nhất 1 invoice có draftUrl. Invoice
 *   ticketIds rỗng ([]) = "chung cả booking" → cover HẾT các vé của booking.
 *   Invoice ticketIds có ID cụ thể → chỉ cover các vé có ID đó.
 *
 * Ví dụ user cung cấp:
 *   - Booking 1 vé + 1 draft (bất kỳ scope nào)      → đủ.
 *   - Booking 3 vé + 3 draft riêng cho từng vé       → đủ.
 *   - Booking 3 vé + 1 draft chung 2 vé A,B          → THIẾU vé C.
 *
 * @returns {Array<{bookingId, bookingCode, ticketId, passengerName}>}
 *   Rỗng nghĩa là mọi vé đều có hóa đơn nháp.
 */
export function findTicketsMissingDraftInvoice(bookings) {
  const missing = []
  for (const b of bookings || []) {
    const invoices = b.invoices || []
    const tickets  = b.tickets  || []
    if (tickets.length === 0) continue

    // Có ≥ 1 invoice booking-wide có draftUrl → cover TẤT CẢ vé của booking
    const hasWideDraft = invoices.some(
      inv => inv.draftUrl && (!inv.ticketIds || inv.ticketIds.length === 0)
    )
    if (hasWideDraft) continue

    // Không có wide → cover đến đâu là do ticketIds cụ thể trong các invoice
    // có draftUrl. Gom tất cả ID được cover.
    const covered = new Set()
    for (const inv of invoices) {
      if (!inv.draftUrl) continue
      for (const id of inv.ticketIds || []) covered.add(id)
    }

    for (const t of tickets) {
      if (!covered.has(t.id)) {
        missing.push({
          bookingId: b.id,
          bookingCode: b.bookingCode || `#${b.id}`,
          ticketId: t.id,
          passengerName: t.passengerName || `vé #${t.id}`,
        })
      }
    }
  }
  return missing
}

/**
 * Tải tất cả file hóa đơn nháp của các booking (draftUrl).
 *
 * Naming convention (2026-10-16 v3):
 *   - Hóa đơn CHUNG cho 1 booking →
 *       Draft-Invoice-<bookingCode>.<ext>
 *   - Hóa đơn gộp nhiều booking (invoice group — luôn full khách) →
 *       Draft-Invoice-<ownerCode>-<linkedCode1>-...<ext>
 *   - Hóa đơn áp cho 1..N vé cụ thể (CHỈ khi 1 booking) →
 *       Draft-Invoice-<bookingCode>-<pax1>-<pax2>...<ext>
 *
 * Extension lấy từ file gốc (draftOriginal / draftUrl); mặc định .pdf nếu
 * không phát hiện được — vì có thể user upload ảnh (jpg/png) chứ không chỉ
 * PDF, dùng đúng đuôi để file mở được.
 *
 * ── 2026-09-25 v3: bỏ showDirectoryPicker, dùng <a download> tuần tự ──
 * User đã chọn: "user tự chọn nơi lưu file" → dùng cơ chế download chuẩn
 * của trình duyệt. Trình duyệt sẽ hỏi nơi lưu (nếu setting "Ask where to
 * save" bật) hoặc lưu vào download folder mặc định.
 *
 * Lưu ý: Chrome sẽ hiện prompt "Site này đang tải nhiều file" ở file thứ 2
 * — user allow 1 lần là các file sau download thẳng.
 */
export async function downloadDraftInvoices(bookings, { onProgress } = {}) {
  const jobs = collectDraftInvoiceJobs(bookings)
  if (jobs.length === 0) throw new Error('Không có hóa đơn nháp nào để tải')

  let done = 0
  const errors = []
  for (const job of jobs) {
    try {
      const resp = await fetch(job.url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = job.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      // Delay nhỏ giữa các file để trình duyệt xử lý — nếu bấm liên tục
      // Chrome có thể drop file sau.
      await new Promise(r => setTimeout(r, 250))

      done++
    } catch (err) {
      console.warn('[Draft invoice download]', job.filename, err)
      errors.push({ filename: job.filename, error: err?.message || String(err) })
    }
    onProgress?.(done, jobs.length)
  }
  return { total: jobs.length, done, errors }
}

/**
 * ── 2026-10-16: Convention mới cho tên file hóa đơn nháp ──
 *
 *   • Hóa đơn CHUNG 1 booking:              Draft-Invoice-<bookingCode>
 *   • Hóa đơn gộp N booking (invoice group) qua link:
 *                                           Draft-Invoice-<code1>-<code2>-...
 *   • Hóa đơn tách theo tập vé:             Draft-Invoice-<ownerCode>-<pax1>-<pax2>-...
 *   • Hóa đơn gộp N booking + tách theo vé: Draft-Invoice-<code1>-<code2>-...-<pax1>-<pax2>-...
 *
 * Dedupe theo invoice.id — khi 1 invoice group hiển thị ở nhiều booking cùng
 * lúc trong `bookings`, chỉ tải MỘT lần (owner trước).
 */
function collectDraftInvoiceJobs(bookings) {
  // 1. Dedupe invoices theo id. Mỗi invoice gom "danh sách booking share".
  //    sourceBookingId = booking GỐC (upload file). Các booking khác là "ké".
  // ── 2026-10-16 v2: Dedupe theo invoice GỐC ──
  //   Mirror invoice có `sourceBookingId` chỉ về owner booking (có `sourceBookingCode`).
  //   Key dedupe = `sourceBookingId + sourceBookingCode` (chung cho owner + mirror).
  //   Khi `bookings` list chứa cả owner & member → mỗi booking có record Invoice
  //   riêng (vật lý), nhưng vì cùng key → chỉ tải 1 lần.
  const invByKey = new Map()  // key → { inv (owner preferred), ownerCode, codes: Set }
  for (const b of bookings || []) {
    for (const inv of b.invoices || []) {
      if (!inv.draftUrl) continue
      const isOwner = inv.sourceBookingId == null || inv.sourceBookingId === b.id
      const ownerBookingCode = inv.sourceBookingCode || b.bookingCode || `booking-${b.id}`
      // key: ưu tiên sourceBookingId (owner booking) + inv.sourceBookingId
      // Nếu là owner invoice thì sourceBookingId = chính b.id (từ mapper BE)
      const key = `${inv.sourceBookingId || b.id}::${inv.draftOriginal || inv.draftUrl}`
      const bCode = b.bookingCode || `booking-${b.id}`
      if (!invByKey.has(key)) {
        invByKey.set(key, {
          inv,
          ownerCode: ownerBookingCode,
          codes: new Set([bCode]),
        })
      } else {
        const rec = invByKey.get(key)
        rec.codes.add(bCode)
        // Nếu record cũ là mirror, mà record mới là owner → prefer owner
        if (isOwner) {
          rec.inv = inv
          rec.ownerCode = ownerBookingCode
        }
      }
    }
  }
  const invById = invByKey  // alias cho đoạn code dưới

  const jobs = []
  for (const rec of invById.values()) {
    const { inv, ownerCode, codes } = rec

    // Danh sách mã booking: owner trước, các booking member sau (loại trùng).
    const codeList = [ownerCode, ...[...codes].filter(c => c !== ownerCode)]
    const codePart = codeList.join('-')

    const scopeIds = inv.ticketIds || []
    const isBookingWide = scopeIds.length === 0
    const isGrouped = codes.size > 1   // 2026-10-16: >1 booking → đã gộp

    let baseName
    if (isGrouped) {
      // Hóa đơn gộp nhiều booking: luôn hiểu là FULL khách (của cả nhóm) →
      // chỉ cần mã các booking, không liệt kê tên.
      baseName = `Draft-Invoice-${codePart}`
    } else if (isBookingWide) {
      // 1 booking, chung → chỉ mã booking.
      baseName = `Draft-Invoice-${codePart}`
    } else {
      // 1 booking, tách theo vé → mã booking + tên các khách.
      const nameFor = (tid) => {
        for (const b of bookings || []) {
          const t = (b.tickets || []).find(x => x.id === tid)
          if (t) return t.passengerName
        }
        return null
      }
      const names = scopeIds.map(nameFor).filter(Boolean)
      const paxPart = names.length > 0 ? names.join('-') : `booking-${inv.id}`
      baseName = `Draft-Invoice-${codePart}-${paxPart}`
    }

    const ext = extensionOf(inv.draftOriginal) || extensionOf(inv.draftUrl) || '.pdf'
    jobs.push({
      url: resolveFileUrl(inv.draftUrl),
      filename: sanitizeFilename(baseName) + ext,
    })
  }
  return jobs
}

function extensionOf(u) {
  if (!u) return null
  const clean = u.split('?')[0].split('#')[0]
  const m = clean.match(/\.([a-zA-Z0-9]{2,5})$/)
  return m ? '.' + m[1].toLowerCase() : null
}

function resolveFileUrl(u) {
  if (!u) return u
  if (/^https?:\/\//i.test(u)) return u
  const BASE = import.meta.env.VITE_API_URL || 'http://localhost:9009'
  return BASE + (u.startsWith('/') ? u : '/' + u)
}

/** Bỏ ký tự cấm trong tên file trên Windows / macOS. */
function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]+/g, '_')   // ký tự cấm
    .replace(/\s+/g, ' ')             // gom whitespace
    .trim()
    .slice(0, 200)                    // giới hạn độ dài cho an toàn
}
// ═══════════════════════════════════════════════════════════════════════════
//  Báo cáo CÔNG NỢ — 2026-11-07
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lấy mốc 00:00:00 và 23:59:59 của HÔM NAY ở local timezone.
 * Dùng cho tùy chọn "Báo cáo vé hôm nay" để bỏ qua filter hiện tại.
 */
export function getTodayRangeMs() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  const fromMs = new Date(y, m, d, 0, 0, 0, 0).getTime()
  const toMs   = new Date(y, m, d, 23, 59, 59, 999).getTime()
  return { fromMs, toMs }
}

/**
 * Fetch toàn bộ booking CHƯA THANH TOÁN khớp một hay nhiều company id.
 *
 * ── 2026-11-07 (rev): `idOrIds` giờ nhận 1 ID hoặc mảng ID ──
 *   - Chọn công ty mẹ (root) → caller truyền mảng [root, ...các chi nhánh].
 *   - Chọn chi nhánh → caller truyền [branchId].
 *   Booking match nếu có ≥ 1 vé có companyId thuộc mảng.
 */
export async function fetchUnpaidBookingsByCompany(idOrIds, onProgress) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds]
  const idSet = new Set(ids)
  const base = { paymentStatus: 'UNPAID' }
  const all = []
  let page = 0
  const MAX_PAGES = 50
  while (page < MAX_PAGES) {
    const res = await listBookings({ ...base, page, size: 200 })
    const d = res.data?.data
    const content = d?.content || []
    all.push(...content)
    if (onProgress) onProgress(all.length, d?.totalElements || all.length)
    if (page + 1 >= (d?.totalPages || 1)) break
    page++
  }
  return all.filter(b => (b.tickets || []).some(t => idSet.has(t.companyId)))
}

/**
 * Format số hoá đơn thành chuỗi "#C26MCB<n>".
 * '', null → chuỗi rỗng để cell không hiện mã rác.
 */
export function formatInvoiceCode(num) {
  if (num == null) return ''
  const s = String(num).trim()
  if (!s) return ''
  return `#C26MCB${s}`
}

/**
 * ── 2026-11-07 (rev3): Build chuỗi hành trình gọn ──
 *   - Nếu toCode của segment trước = fromCode của segment sau → nối thẳng.
 *   - Nếu không → chèn "//" rồi viết đầy đủ fromCode+toCode của segment mới.
 *   Ví dụ:
 *     [SGN→HAN, HAN→SGN]   → "SGNHANSGN"      (khứ hồi)
 *     [SGN→HAN, HPH→SGN]   → "SGNHAN//HPHSGN" (đa chặng không nối)
 */
function buildRouteStr(segments) {
  const segs = [...(segments || [])].sort((a, b) =>
    (a.segOrder ?? 0) - (b.segOrder ?? 0))
  let out = ''
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const from = s.fromCode || '?'
    const to = s.toCode || '?'
    if (i === 0) { out = from + to; continue }
    const prev = segs[i - 1]
    if ((prev.toCode || '') === from) out += to
    else out += '//' + from + to
  }
  return out || '—'
}

/**
 * 2026-11-07: Gom các số hoá đơn (CSV) của 1 booking thành array dedupe + sort.
 * Dùng cho PDF báo cáo công nợ (auto-pull, không user nhập nữa).
 */
function collectInvoiceNumbers(b) {
  const set = new Set()
  for (const inv of (b.invoices || [])) {
    if (!inv.invoiceNumbers) continue
    inv.invoiceNumbers.split(',').forEach(n => {
      const t = n.trim()
      if (t) set.add(t)
    })
  }
  return [...set].sort((a, c) => {
    const na = Number(a), nc = Number(c)
    if (Number.isFinite(na) && Number.isFinite(nc)) return na - nc
    return a.localeCompare(c)
  })
}

/**
 * 2026-11-07: Quy đổi số tiền USD về VND theo tỷ giá đã lưu của booking.
 * Nếu booking là VND → trả về số gốc. USD mà thiếu tỷ giá → 0 (thay vì NaN).
 */
function toVnd(amount, b) {
  const n = typeof amount === 'number' ? amount : parseAmount(amount) || 0
  if ((b.currency || 'VND') === 'USD') {
    const r = parseAmount(b.exchangeRate) || 0
    return Math.round(n * r)
  }
  return n
}

/**
 * ── 2026-11-07 (rev2): Build & tải PDF Báo cáo công nợ dạng MULTI-SECTION ──
 *
 * Mỗi "section" = 1 công ty (chính hoặc 1 chi nhánh) kèm list booking UNPAID
 * của công ty đó. Header của PDF in tên công ty mẹ. Trong body, mỗi section
 * có 1 tiêu đề (tên công ty + số booking) rồi bảng của section, cuối bảng có
 * subtotal của section. Hết các section → 1 dòng GRAND TOTAL tổng cộng.
 *
 * @param opts.rootName         Tên công ty mẹ (cho header PDF)
 * @param opts.sections         [{ companyName, bookings }]
 * @param opts.invoiceNumbers   Map<bookingId, string>
 */
export async function exportDebtReport({ rootName, rootCode, sections }) {
  if (!sections || sections.length === 0) throw new Error('Không có section nào để xuất')

  // ── 2026-11-07 (rev5): 9 cột, FIT 1 TRANG ──
  //   Usable: 842 - 2*20 (margin) = 802pt.
  //   pdfmake paddingLeft/Right 3 + border 0.5 → mỗi col chiếm thêm ~7pt.
  //   9 cột × 7 = 63pt overhead. Budget cho widths ≈ 802 - 63 = 739pt.
  //   Scale từ bộ cũ (802) × (739/802 ≈ 0.921).
  const widths = [55, 30, 44, 117, 158, 79, 78, 72, 105]
  const colCount = widths.length
  const headL = (t) => ({
    text: t, bold: true, fontSize: 8,
    color: COLOR_HEADER_TEXT, fillColor: COLOR_HEADER, alignment: 'left',
  })
  const headR = (t) => ({
    text: t, bold: true, fontSize: 8,
    color: COLOR_HEADER_TEXT, fillColor: COLOR_HEADER, alignment: 'right',
  })
  const headerRow = [
    headL('Ngày xuất vé'),     // A (ngày + loại 2 dòng)
    headL('Hãng'),              // B
    headL('Mã BK'),             // C
    headL('Hành trình'),        // D
    headL('Tên hành khách'),    // E (đổi label)
    headL('Số vé'),             // F
    headR('Giá bán'),           // G
    headR('Tổng booking'),      // H
    headR('Số hoá đơn'),        // I
  ]

  // Build body cho 1 section → table riêng.
  const buildSectionTable = (section) => {
    const body = [headerRow]
    let sumSellVnd = 0
    let sumBookingVnd = 0
    for (const b of section.bookings) {
      const tickets = b.tickets || []
      if (tickets.length === 0) continue
      const N = tickets.length
      const bookingTotalVnd = toVnd(bookingTotals(b), b)
      sumBookingVnd += bookingTotalVnd
      const route = buildRouteStr(b.segments)
      const invNums = collectInvoiceNumbers(b)   // ["355", "356"]
      tickets.forEach((t, i) => {
        const n = ticketNumbers(t)
        const sellVnd = toVnd(n.sellPrice, b)
        sumSellVnd += sellVnd
        const isFirst = i === 0
        const cellL = (content, extra = {}) => ({
          stack: Array.isArray(content) ? content : [content],
          alignment: 'left',
          ...extra,
        })
        const cellR = (content, extra = {}) => ({
          stack: Array.isArray(content) ? content : [content],
          alignment: 'right',
          ...extra,
        })
        const row = []
        // A Ngày xuất vé + Loại (2 dòng, rowSpan)
        if (isFirst) row.push(cellL(
          [
            { text: b.saleDate ? fmtDateShort(b.saleDate) : '—', fontSize: 8 },
            { text: KIND_LABEL[b.kind] || b.kind || '—', fontSize: 7, bold: true, color: '#475569' },
          ],
          { rowSpan: N }
        ))
        else row.push({})
        // B Hãng
        if (isFirst) row.push(cellL({ text: b.airlineCode || '—', fontSize: 8 }, { rowSpan: N }))
        else row.push({})
        // C Mã BK
        if (isFirst) row.push(cellL({ text: b.bookingCode || '—', fontSize: 8, bold: true }, { rowSpan: N }))
        else row.push({})
        // D Hành trình
        if (isFirst) row.push(cellL({ text: route, fontSize: 8, bold: true, color: '#1e40af' }, { rowSpan: N }))
        else row.push({})
        // E Tên hành khách
        row.push(cellL({ text: (t.passengerName || '—').toUpperCase(), fontSize: 8 }))
        // F Số vé
        row.push(cellL({ text: t.ticketNumber || '—', fontSize: 8, color: t.ticketNumber ? '#111' : '#aaa' }))
        // G Giá bán (VND, đơn vị INLINE cùng style với số)
        row.push(cellR({
          text: `${formatMoney(sellVnd, 'VND', { withUnit: false })} VNĐ`,
          fontSize: 8, bold: true, alignment: 'right',
        }))
        // H Tổng booking (VND, inline, rowSpan)
        if (isFirst) row.push(cellR({
          text: `${formatMoney(bookingTotalVnd, 'VND', { withUnit: false })} VNĐ`,
          fontSize: 8, bold: true, alignment: 'right',
        }, { rowSpan: N }))
        else row.push({})
        // I Số hoá đơn (rowSpan)
        if (isFirst) {
          if (invNums.length === 0) {
            row.push(cellR({ text: '—', fontSize: 8, color: '#aaa' }, { rowSpan: N }))
          } else {
            row.push(cellR(
              invNums.map(nn => ({
                text: `#C26MCB${nn}`,
                fontSize: 8, bold: true, color: '#0f172a', alignment: 'right',
              })),
              { rowSpan: N }
            ))
          }
        } else row.push({})
        body.push(row)
      })
    }
    // Subtotal row (nền indigo nhạt) — gộp 6 cột đầu cho label "Cộng".
    const subRow = new Array(colCount).fill(null).map(() => ({ text: '', fillColor: '#eef2ff' }))
    subRow[0] = { text: 'Cộng', bold: true, fontSize: 8, fillColor: '#eef2ff', colSpan: 6, alignment: 'right' }
    for (let i = 1; i < 6; i++) subRow[i] = { text: '', fillColor: '#eef2ff' }
    subRow[6] = { text: `${formatMoney(sumSellVnd, 'VND', { withUnit: false })} VNĐ`,
      bold: true, fontSize: 8, fillColor: '#eef2ff', alignment: 'right' }
    subRow[7] = { text: `${formatMoney(sumBookingVnd, 'VND', { withUnit: false })} VNĐ`,
      bold: true, fontSize: 8, fillColor: '#eef2ff', alignment: 'right' }
    subRow[8] = { text: '', fillColor: '#eef2ff' }
    body.push(subRow)
    return { body, sumSellVnd, sumBookingVnd, invNumCount: (() => {
      const set = new Set()
      for (const b of section.bookings) {
        for (const n of collectInvoiceNumbers(b)) set.add(n)
      }
      return set.size
    })() }
  }

  // Build nội dung: mỗi section = title + table
  const content = []
  let grandSell = 0
  let grandBooking = 0
  let grandInv = 0
  sections.forEach((s, idx) => {
    const built = buildSectionTable(s)
    grandSell += built.sumSellVnd
    grandBooking += built.sumBookingVnd
    grandInv += built.invNumCount
    content.push({
      text: s.companyName,
      fontSize: 10, bold: true, color: '#1e293b',
      margin: [0, idx === 0 ? 0 : 10, 0, 2],
    })
    // ── 2026-11-07 (rev5): chỉ hiển thị "N hoá đơn" ──
    content.push({
      text: built.invNumCount > 0
        ? `${built.invNumCount} hoá đơn`
        : `Chưa có hoá đơn`,
      fontSize: 8, color: '#64748b',
      margin: [0, 0, 0, 4],
    })
    content.push({
      table: { headerRows: 1, widths, body: built.body, dontBreakRows: true },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: () => '#CBD5E1', vLineColor: () => '#CBD5E1',
        paddingLeft: () => 3, paddingRight: () => 3,
        paddingTop: () => 2, paddingBottom: () => 2,
      },
    })
  })

  // Grand total nếu > 1 section — khớp 10 cột, canh phải.
  if (sections.length > 1) {
    const totalRow = new Array(widths.length).fill(null).map(() =>
      ({ text: '', fillColor: '#1e293b' }))
    totalRow[0] = { text: 'TỔNG CỘNG TẤT CẢ', bold: true, fontSize: 10,
      fillColor: '#1e293b', color: '#fff', colSpan: 6, alignment: 'right' }
    for (let i = 1; i < 6; i++) totalRow[i] = { text: '', fillColor: '#1e293b' }
    totalRow[6] = { text: `${formatMoney(grandSell, 'VND', { withUnit: false })} VNĐ`,
      bold: true, fontSize: 10, fillColor: '#1e293b', color: '#fff', alignment: 'right' }
    totalRow[7] = { text: `${formatMoney(grandBooking, 'VND', { withUnit: false })} VNĐ`,
      bold: true, fontSize: 10, fillColor: '#1e293b', color: '#fff', alignment: 'right' }
    totalRow[8] = { text: '', fillColor: '#1e293b' }
    content.push({
      table: { widths, body: [totalRow] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0,
        paddingLeft: () => 3, paddingRight: () => 3,
        paddingTop: () => 4, paddingBottom: () => 4 },
      margin: [0, 8, 0, 0],
    })
  }

  const totalBookings = sections.reduce((s, x) => s + x.bookings.length, 0)
  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [20, 65, 20, 30],
    header: {
      margin: [20, 18, 20, 0],
      stack: [
        { text: 'BÁO CÁO CÔNG NỢ', fontSize: 14, bold: true, alignment: 'center' },
        { text: rootName || '—', fontSize: 10, alignment: 'center', margin: [0, 2, 0, 0] },
        { text: `Xuất ngày ${fmtDate(Date.now())}`, fontSize: 9, alignment: 'center',
          color: '#666', margin: [0, 2, 0, 0] },
      ],
    },
    footer: (currentPage, pageCount) => ({
      text: `Trang ${currentPage}/${pageCount}  ·  ${sections.length} công ty / chi nhánh  ·  ${grandInv} hoá đơn chưa thanh toán`,
      fontSize: 7, alignment: 'center', color: '#666', margin: [0, 10, 0, 0],
    }),
    content,
    defaultStyle: { fontSize: 8 },
  }

  const pdfMakeMod = await import('pdfmake/build/pdfmake')
  const vfsMod = await import('pdfmake/build/vfs_fonts')
  const pdfMake = pdfMakeMod.default || pdfMakeMod
  const vfs = vfsMod?.pdfMake?.vfs ?? vfsMod?.default?.pdfMake?.vfs
    ?? vfsMod?.default?.vfs ?? vfsMod?.vfs ?? vfsMod?.default ?? vfsMod
  pdfMake.vfs = vfs

  // ── 2026-11-07 (rev4): filename dùng MÃ CÔNG TY (không dấu, ASCII) ──
  //   Pattern: Cong_no_<rootCode>.pdf
  const safeCode = (rootCode || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)
  const fn = `Cong_no_${safeCode || 'UNKNOWN'}.pdf`
  pdfMake.createPdf(docDefinition).download(fn)
}