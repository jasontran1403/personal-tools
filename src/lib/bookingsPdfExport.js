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
    text: currency === 'USD' ? 'USD' : 'VND',
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

function feesLines(t, currency) {
  const fees = t.fees || []
  if (fees.length === 0) return [{ text: '—', fontSize: 8, color: '#aaa' }]
  // ── Mỗi dòng phí = 2 cột (nhãn trái, số tiền phải) ──
  return fees.map(f => ({
    columns: [
      {
        text: f.feeTypeLabel || FEE_LABEL[f.feeType] || f.feeType,
        fontSize: 7.5,
        alignment: 'left',
      },
      {
        text: fmt(f.amount, currency),
        fontSize: 7.5,
        alignment: 'right',
        width: 'auto',
      },
    ],
    columnGap: 4,
  }))
}

function customerLabel(t) {
  // Có company → tên công ty đầy đủ. Không có → "Khách lẻ".
  if (t.companyName && t.companyName.trim()) return t.companyName.trim()
  return 'Khách lẻ'
}

function kindLine(b) {
  // ── 3 dòng — Loại, Hãng, Ngày bán (dd/MM/yy) ──
  const lines = [
    { text: KIND_LABEL[b.kind] || b.kind || '—', bold: true, fontSize: 8 },
  ]
  if (b.airlineCode) {
    lines.push({ text: b.airlineCode, fontSize: 7, color: '#666' })
  }
  if (b.saleDate) {
    lines.push({ text: fmtDateShort(b.saleDate), fontSize: 7, color: '#888' })
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
            text: isUsd ? 'USD' : 'VND',
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
              text: 'VND',
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

    tickets.forEach((t, i) => {
      const n = ticketNumbers(t)
      const isFirst = i === 0
      const cell = (content, extra = {}) => ({
        stack: Array.isArray(content) ? content : [content],
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
        }
      }

      const row = [
        cell(kindLine(b)),
        cell({ text: customerLabel(t), fontSize: 8 }),
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
        row.push({})
      }
      row.push(cell(passengerLine(t)))
      if (isFirst) {
        row.push(cell(routeLine(b), { rowSpan: N }))
      } else {
        row.push({})
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
        row.push({})
      }
      // Note — rowSpan
      if (isFirst) {
        row.push(cell(noteLine(b), { rowSpan: N }))
      } else {
        row.push({})
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
    h('Loại/Hãng'),
    h('Khách hàng'),
    h('Mã BK'),
    h('Hành khách'),
    h('Hành trình'),
    h('Giá gốc'),
    h('Phí thu hộ'),
    h('Các loại phí'),
    h('Thành tiền vé'),
    h('Phí xuất vé'),
    h('Giá bán'),
    h('Tổng booking\n(quy đổi VND)'),
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
  const widths = [
    38,   // A Kind
    68,   // B Customer
    32,   // C Booking
    78,   // D Passenger
    75,   // E Route
    48,   // F Base
    42,   // G Coll
    64,   // H Fees
    52,   // I Subtotal
    42,   // J Issuance
    52,   // K Sell
    78,   // L Total + VND (merged)
    '*',  // M Note (~133pt)
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
 * Naming convention (theo yêu cầu 2026-09-25):
 *   - Hóa đơn CHUNG cho booking (ticketIds rỗng) →
 *       Draft-Invoice-<bookingCode>.<ext>
 *   - Hóa đơn RIÊNG cho 1..N vé cụ thể →
 *       Draft-Invoice-<tên hành khách của các vé đó>.<ext>
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

function collectDraftInvoiceJobs(bookings) {
  const jobs = []
  for (const b of bookings || []) {
    const invoices = b.invoices || []
    const tickets  = b.tickets  || []
    for (const inv of invoices) {
      if (!inv.draftUrl) continue

      const scopeIds = inv.ticketIds || []
      const isBookingWide = scopeIds.length === 0

      let baseName
      if (isBookingWide) {
        baseName = `Draft-Invoice-${b.bookingCode || `booking-${b.id}`}`
      } else {
        const names = scopeIds
          .map(id => tickets.find(t => t.id === id)?.passengerName)
          .filter(Boolean)
        const joined = names.length > 0 ? names.join(', ') : `booking-${b.id}`
        baseName = `Draft-Invoice-${joined}`
      }

      const ext = extensionOf(inv.draftOriginal) || extensionOf(inv.draftUrl) || '.pdf'
      jobs.push({
        url: resolveFileUrl(inv.draftUrl),
        filename: sanitizeFilename(baseName) + ext,
      })
    }
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