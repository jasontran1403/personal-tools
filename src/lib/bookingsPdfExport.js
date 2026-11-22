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

import { parseAmount, formatMoney, sumTicketFees } from '../lib/money'
import { listBookings, getReportDraftInvoices } from '../services/vmbApi'
import { unpaidTicketsOf, invoicesOfTicket } from './ticketDebt'

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
  // 2026-11-20: Mỗi dòng phí hiển thị theo currency GỐC của chính nó
  //   (không ép theo booking.currency) — phí 2.457.650 VNĐ không thể bị
  //   hiển thị thành 2.457.650 USD. Phí khác currency booking → tô amber
  //   cho dễ nhận biết.
  const out = []
  fees.forEach((f, i) => {
    if (i > 0) out.push({ text: '', fontSize: 2 })   // spacer giữa 2 cụm phí
    const rawLabel = f.feeTypeLabel || FEE_LABEL[f.feeType] || f.feeType
    const feeCur = (f.currency || currency || 'VND').toUpperCase()
    out.push({
      text: stripFeePrefix(rawLabel),
      fontSize: 7.5,
      alignment: 'right',
      color: '#334155',
    })
    out.push({
      // Hiển thị số + đơn vị ngay cùng dòng cho mỗi phí (vì các phí có thể
      //   khác currency nhau → không thể gom 1 đơn vị dưới cột).
      text: `${fmt(f.amount, feeCur)} ${feeCur === 'USD' ? 'USD' : 'VNĐ'}`,
      fontSize: 7.5,
      alignment: 'right',
      bold: true,
      color: feeCur !== (currency || 'VND') ? '#b45309' /* amber-700 */ : '#111',
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
  for (const t of (b.tickets || [])) {
    const pct = (t.commission == null ? '' : String(t.commission)).trim()
    const pctNum = Number(pct)
    const hasPct = pct !== '' && Number.isFinite(pctNum) && pctNum > 0
    const comAmt = parseAmount(t.commissionAmount) || 0
    if (!hasPct && comAmt <= 0) continue
    const parts = []
    if (hasPct) parts.push(`${pct}%`)
    if (comAmt > 0) parts.push(`${new Intl.NumberFormat('vi-VN').format(comAmt)} VNĐ`)
    lines.push({ text: `Comm. : ${parts.join(' · ')}`, fontSize: 6, color: '#555' })
  }
  // 2026-11-07: Hiển thị Phí xuất vé HNH của từng vé trong Ghi chú.
  for (const t of (b.tickets || [])) {
    const hnh = parseAmount(t.hnhFee) || 0
    if (hnh > 0) {
      const who = (t.passengerName || '').trim() || t.ticketNumber || 'Vé'
      const hnhStr = new Intl.NumberFormat('vi-VN').format(hnh)
      lines.push({ text: `• Phí HNH ${who}: ${hnhStr} VNĐ`, fontSize: 6, color: '#555' })
    }
  }
  // 2026-11-07: Người giới thiệu — hữu ích khi review báo cáo khách lẻ.
  if (b.referrerName && b.referrerName.trim()) {
    lines.push({ text: `• Giới thiệu: ${b.referrerName.trim()}`, fontSize: 6, color: '#555' })
  }
  return lines.length ? lines : [{ text: '—', fontSize: 7, color: '#aaa' }]
}

// ── Tính toán từng dòng vé ────────────────────────────────

// 2026-11-20: Tổng phí CÙNG currency với booking (cộng thẳng, không quy đổi).
function sumFeesSameCurrencyPdf(fees, bookingCurrency) {
  if (!fees) return 0
  const bc = (bookingCurrency || 'VND').toUpperCase()
  let sum = 0
  for (const f of fees) {
    const fc = (f.currency || bc).toUpperCase()
    if (fc !== bc) continue
    const amt = parseAmount(f.amount)
    if (Number.isFinite(amt)) sum += amt
  }
  return sum
}

// 2026-11-20: Tổng phí KHÁC currency với booking, quy sang VND.
function sumFeesCrossAsVndPdf(fees, bookingCurrency, exchangeRate) {
  if (!fees) return 0
  const bc = (bookingCurrency || 'VND').toUpperCase()
  const rate = parseAmount(exchangeRate) || 0
  let sum = 0
  for (const f of fees) {
    const fc = (f.currency || bc).toUpperCase()
    if (fc === bc) continue
    const amt = parseAmount(f.amount)
    if (!Number.isFinite(amt)) continue
    if (fc === 'VND') sum += amt
    else if (fc === 'USD' && rate > 0) sum += amt * rate
  }
  return sum
}

function ticketNumbers(t, b) {
  const base = parseAmount(t.basePrice) || 0
  const coll = parseAmount(t.collectionFee) || 0
  const iss  = parseAmount(t.issuanceFee) || 0
  const hnh  = parseAmount(t.hnhFee) || 0
  // 2026-11-20: Thành tiền / Giá bán CHỈ gộp phí CÙNG currency với booking
  //   (phí khác currency tách ra để tránh làm tròn 2 số USD sai lệch).
  const feesSameCur = sumFeesSameCurrencyPdf(t.fees, b?.currency || 'VND')
  // Phí KHÁC currency, đã quy VND. Dùng để cộng vào Quy đổi VNĐ của cột
  //   "Tổng booking" (chỗ duy nhất gộp được 2 đơn vị tiền).
  const feesCrossVnd = sumFeesCrossAsVndPdf(t.fees, b?.currency || 'VND', b?.exchangeRate)
  // Tổng phí quy VND (gồm CẢ cùng & khác currency). Dùng cho báo cáo công nợ.
  const feesVnd = sumTicketFees(t.fees, 'VND', b?.exchangeRate)
  const subTotal  = base + coll + feesSameCur + hnh
  const sellPrice = subTotal + iss
  return { base, coll, iss, hnh, feesSum: feesSameCur, feesCrossVnd, feesVnd, subTotal, sellPrice }
}

function bookingTotals(b) {
  let total = 0
  for (const t of (b.tickets || [])) {
    total += ticketNumbers(t, b).sellPrice
  }
  return total
}

// 2026-11-20: Tổng phí khác currency quy VND của cả booking (dùng cho Quy đổi VNĐ).
function bookingCrossFeesVnd(b) {
  let total = 0
  for (const t of (b.tickets || [])) total += ticketNumbers(t, b).feesCrossVnd
  return total
}

// 2026-11-20: Tổng phí đã quy VND của cả booking (gồm cả cùng và khác currency).
//   Dùng cho báo cáo công nợ.
function bookingFeesVnd(b) {
  let total = 0
  for (const t of (b.tickets || [])) total += ticketNumbers(t, b).feesVnd
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
    // - VND: 1 dòng tổng (bold) — phí đã nằm trong tổng, không hiển thị gì thêm.
    // - USD: dòng 1 = tổng USD (đã gộp phí cross-converted),
    //        dòng 2 = ≈ quy đổi VNĐ = (tổng USD × tỷ giá) + TỔNG PHÍ VNĐ GỐC,
    //        dòng 3 = "Tỷ giá …".
    //   2026-11-20: KHÔNG hiển thị dòng "(đã cộng phí …)" — gộp vào số chính luôn.
    const isUsd = b.currency === 'USD'
    const unitColor = isUsd ? CURRENCY_COLOR_USD : CURRENCY_COLOR_VND

    const totalStack = [
      {
        columns: [
          { text: fmt(total, b.currency), bold: true, fontSize: 8, alignment: 'right', width: '*' },
          {
            text: isUsd ? 'USD' : 'VNĐ',
            bold: true, fontSize: 6.5, color: unitColor,
            alignment: 'right', width: 'auto', margin: [2, 0, 0, 0],
          },
        ],
        columnGap: 0,
      },
    ]
    if (isUsd) {
      const rate = parseAmount(b.exchangeRate) || 0
      // 2026-11-20: Booking USD + phí khác currency (vd phí VNĐ) →
      //   Tổng booking quy VNĐ = (tổng USD × tỷ giá) + 2 × phí (quy VNĐ).
      //   User coi "total×rate + phí" (vd 24.473.020 ở FR49M5) là baseline đã
      //   có, nay CỘNG THÊM phí nữa → 26.930.670 cho FR49M5.
      const crossVnd = bookingCrossFeesVnd(b)
      const baselineVnd = total * rate + crossVnd
      const vnd = baselineVnd + crossVnd
      totalStack.push(
        {
          columns: [
            { text: '≈ ' + formatMoney(vnd, 'VND', { withUnit: false }),
              fontSize: 7.5, color: CURRENCY_COLOR_USD, alignment: 'right', bold: true, width: '*' },
            { text: 'VNĐ', fontSize: 6.5, color: CURRENCY_COLOR_USD, bold: true,
              alignment: 'right', width: 'auto', margin: [2, 0, 0, 0] },
          ],
          columnGap: 0,
        },
        {
          text: 'Tỷ giá ' + formatMoney(rate, 'VND', { withUnit: false }),
          fontSize: 6.5, color: '#666', alignment: 'right',
        },
      )
    }

    // ── 2026-11-07: Booking PAID → fillColor xanh lá nhạt ở mọi cell của
    //   mọi dòng vé thuộc booking. Guard total ≈ 0 → coi là PAID (dữ liệu
    //   cũ có thể chưa rollup nhưng về logic là đã thanh toán).
    const isPaid = (b.paymentStatus === 'PAID') || (total <= 0.5)
    const paidFill = isPaid ? { fillColor: COLOR_PAID_BG } : null

    tickets.forEach((t, i) => {
      const n = ticketNumbers(t, b)
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
      // Cột Các loại phí: list phí, mỗi dòng "nhãn ... số tiền <đơn vị>".
      // 2026-11-20: Đơn vị tiền tệ nay nằm NGAY SAU số tiền của từng phí
      //   (xem feesLines) → không còn dòng đơn vị gom ở cuối cột nữa.
      row.push(cell(
        feesLines(t, b.currency),
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
 *
 * ── 2026-11-11: ZIP TOÀN BỘ ──
 * Trước đây mỗi hóa đơn là một lệnh click `<a download>`, trình duyệt bật
 * popup "Lưu ở đâu?" riêng cho từng file. Nay gộp tất cả vào 1 file ZIP và
 * tải 1 lần → trình duyệt chỉ hỏi (hoặc không hỏi) 1 lần duy nhất. Tên ZIP:
 *   Hoa-don-nhap-<dd-MM-yyyy>.zip
 * Nếu người dùng tải ZIP cùng tên 2 lần, trình duyệt tự thêm `(1)`, `(2)` —
 * không cần FE xử lý.
 *
 * Trường hợp chỉ có 1 hóa đơn: tải thẳng file đó, không ZIP cho đỡ dư thao tác.
 */
export async function downloadDraftInvoices(bookings, { onProgress } = {}) {
  const jobs = collectDraftInvoiceJobs(bookings)
  if (jobs.length === 0) throw new Error('Không có hóa đơn nháp nào để tải')

  // Fetch tất cả file song song (giới hạn 4 concurrent cho khỏi nghẽn).
  const blobs = []
  const errors = []
  let fetched = 0
  const CONC = 4
  for (let i = 0; i < jobs.length; i += CONC) {
    const batch = jobs.slice(i, i + CONC).map(async (job) => {
      try {
        const resp = await fetch(job.url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const blob = await resp.blob()
        blobs.push({ job, blob })
      } catch (err) {
        console.warn('[Draft invoice fetch]', job.filename, err)
        errors.push({ filename: job.filename, error: err?.message || String(err) })
      } finally {
        fetched++
        onProgress?.(fetched, jobs.length)
      }
    })
    await Promise.all(batch)
  }

  const saveBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (blobs.length === 0) {
    return { total: jobs.length, done: 0, errors, zipped: false }
  }
  if (blobs.length === 1) {
    // 1 file → không cần zip, tải thẳng.
    saveBlob(blobs[0].blob, blobs[0].job.filename)
    return { total: jobs.length, done: 1, errors, zipped: false }
  }

  // Nhiều file → gom vào 1 ZIP để chỉ hỏi "Lưu ở đâu?" đúng 1 lần.
  const JSZipMod = await import('jszip')
  const JSZip = JSZipMod.default || JSZipMod
  const zip = new JSZip()
  const used = new Map()         // phòng trường hợp tên file trùng
  for (const { job, blob } of blobs) {
    let name = job.filename
    const n = (used.get(name) || 0) + 1
    used.set(name, n)
    if (n > 1) {
      // thêm (n) trước đuôi mở rộng
      const dot = name.lastIndexOf('.')
      name = dot > 0
        ? `${name.slice(0, dot)} (${n - 1})${name.slice(dot)}`
        : `${name} (${n - 1})`
    }
    zip.file(name, blob)
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const zipName = `Hoa-don-nhap-${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}.zip`
  saveBlob(zipBlob, zipName)

  return { total: jobs.length, done: blobs.length, errors, zipped: true, zipName }
}

function saveBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function base64ToBlob(b64, type = 'application/pdf') {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

function reportDraftFilename(u) {
  const codes = ((u.bookingCodes && u.bookingCodes.length ? u.bookingCodes : [u.bookingCode]) || [])
    .filter(Boolean)
  const pax = u.paxCount || 0
  const base = codes.length > 1
    ? `Draft-Invoice-${codes.join('-')}-${pax}pax`
    : `Draft-Invoice-${codes[0] || u.bookingId}`
  return sanitizeFilename(base) + '.pdf'
}

export async function generateReportDraftInvoices(bookings, { onProgress } = {}) {
  const ids = []
  for (const b of bookings || []) if (b?.id != null) ids.push(b.id)
  if (ids.length === 0) throw new Error('Không có booking nào để tạo hóa đơn nháp')

  const res = await getReportDraftInvoices(ids)
  const env = res?.data
  if (env && typeof env.code === 'number' && !(env.code >= 900 && env.code < 1000)) {
    throw new Error(env.message || 'Không tạo được hóa đơn nháp')
  }
  const units = env?.data || []

  const blobs = []
  const errors = []
  let done = 0
  for (const u of units) {
    if (!u.pdfBase64) {
      errors.push({ filename: u.bookingCode || `#${u.bookingId}`, error: u.error || 'Không có file' })
    } else {
      try {
        blobs.push({ blob: base64ToBlob(u.pdfBase64), filename: reportDraftFilename(u) })
      } catch (e) {
        errors.push({ filename: u.bookingCode || `#${u.bookingId}`, error: e?.message || String(e) })
      }
    }
    done++
    onProgress?.(done, units.length)
  }

  if (blobs.length === 0) {
    return { total: units.length, done: 0, errors, zipped: false }
  }
  if (blobs.length === 1) {
    saveBlobFile(blobs[0].blob, blobs[0].filename)
    return { total: units.length, done: 1, errors, zipped: false }
  }

  const JSZipMod = await import('jszip')
  const JSZip = JSZipMod.default || JSZipMod
  const zip = new JSZip()
  const used = new Map()
  for (const { blob, filename } of blobs) {
    let name = filename
    const n = (used.get(name) || 0) + 1
    used.set(name, n)
    if (n > 1) {
      const dot = name.lastIndexOf('.')
      name = dot > 0 ? `${name.slice(0, dot)} (${n - 1})${name.slice(dot)}` : `${name} (${n - 1})`
    }
    zip.file(name, blob)
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const zipName = `Hoa-don-nhap-${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}.zip`
  saveBlobFile(zipBlob, zipName)
  return { total: units.length, done: blobs.length, errors, zipped: true, zipName }
}

/**
 * ── 2026-11-11 (rev3): Convention tên file hóa đơn nháp ──
 *
 *   • 1 booking, hóa đơn CHUNG cả booking:
 *           Draft-Invoice-<bookingCode>.pdf
 *   • 1 booking, có nhiều hóa đơn TÁCH theo vé:
 *           Draft-Invoice-<bookingCode>-<idx>-<N>pax.pdf
 *       `idx` là thứ tự hóa đơn tách trong booking (1-based, theo id invoice).
 *       `N`   là số vé mà hóa đơn này áp cho.
 *   • Hóa đơn GỘP nhiều booking (ví dụ DZRAG7 + 5JW8XD dùng chung 1 file):
 *       Tải 1 lần duy nhất, tên gộp tất cả mã booking và tổng số vé:
 *           Draft-Invoice-<codeA>-<codeB>-<N>pax.pdf
 *     Cách này tránh tải trùng file giống nhau dưới 2 tên, và vẫn cho biết
 *     file cover những booking nào.
 *
 * Dedupe theo file nguồn — khi cùng 1 file nháp xuất hiện ở nhiều booking
 * (mirror, invoice group) chỉ tải MỘT lần, owner trước nếu có.
 */
function collectDraftInvoiceJobs(bookings) {
  // ── 1. Dedupe theo file nguồn ────────────────────────────
  //   Mirror invoice (sourceBookingId != null) trỏ về bản owner — cùng file
  //   vật lý. Key dedupe gồm cả owner id và tên file để an toàn khi 2 booking
  //   trong group dùng chung file.
  const invByKey = new Map()
  for (const b of bookings || []) {
    for (const inv of b.invoices || []) {
      if (!inv.draftUrl) continue
      const isOwner = inv.sourceBookingId == null || inv.sourceBookingId === b.id
      const ownerCode = inv.sourceBookingCode || b.bookingCode || `booking-${b.id}`
      const key = `${inv.sourceBookingId || b.id}::${inv.draftOriginal || inv.draftUrl}`
      const bCode = b.bookingCode || `booking-${b.id}`
      if (!invByKey.has(key)) {
        invByKey.set(key, {
          inv, ownerCode, codes: new Set([bCode]),
          // Toàn bộ vé mà hóa đơn này áp cho (gom khi nhiều booking share).
          ticketIds: new Set(inv.ticketIds || []),
        })
      } else {
        const rec = invByKey.get(key)
        rec.codes.add(bCode)
        for (const tid of (inv.ticketIds || [])) rec.ticketIds.add(tid)
        if (isOwner) { rec.inv = inv; rec.ownerCode = ownerCode }
      }
    }
  }

  // ── 2. Đánh số hóa đơn TÁCH trong cùng 1 booking (idx 1..M) ──────
  //   Hóa đơn tách = có ticketIds cụ thể và KHÔNG cover toàn bộ vé. Hóa đơn
  //   chung booking (ticketIds rỗng) không được đánh số. Thứ tự: theo id
  //   invoice tăng dần cho ổn định giữa các lần chạy.
  const splitSeq = new Map()    // bookingCode → [{key, invId}, ...] (đã sort)
  for (const [key, rec] of invByKey) {
    if (rec.codes.size !== 1) continue              // cross-booking → tính riêng
    const bCode = [...rec.codes][0]
    if (rec.ticketIds.size === 0) continue          // hóa đơn chung
    if (!splitSeq.has(bCode)) splitSeq.set(bCode, [])
    splitSeq.get(bCode).push({ key, invId: rec.inv.id || 0 })
  }
  for (const list of splitSeq.values()) list.sort((a, b) => a.invId - b.invId)

  // Số vé của 1 booking → để biết hóa đơn có cover hết không.
  const ticketCount = new Map()
  for (const b of bookings || []) {
    ticketCount.set(b.bookingCode, (b.tickets || []).length)
  }

  // ── 3. Dựng tên file ─────────────────────────────────────
  const jobs = []
  for (const [key, rec] of invByKey) {
    const { inv, ticketIds, codes } = rec
    const codeList = [...codes].sort()               // ổn định
    const paxCount = ticketIds.size
    const ext = extensionOf(inv.draftOriginal) || extensionOf(inv.draftUrl) || '.pdf'

    let baseName
    if (codes.size > 1) {
      // Hóa đơn GỘP nhiều booking → 1 file duy nhất, tên ghép tất cả mã.
      // Luôn kèm "-<N>pax" để phân biệt với hóa đơn chung đơn lẻ.
      baseName = `Draft-Invoice-${codeList.join('-')}-${paxCount}pax`
    } else {
      const bCode = codeList[0]
      const total = ticketCount.get(bCode) || 0
      const isBookingWide = ticketIds.size === 0 || (total > 0 && ticketIds.size === total
        && [...ticketIds].every(() => true))
      if (isBookingWide) {
        // Cả booking 1 hóa đơn (dù 1 vé hay nhiều vé).
        baseName = `Draft-Invoice-${bCode}`
      } else {
        // Booking tách nhiều hóa đơn → <code>-<idx>-<N>pax
        const seq = splitSeq.get(bCode) || []
        const idx = Math.max(1, seq.findIndex(x => x.key === key) + 1)
        baseName = `Draft-Invoice-${bCode}-${idx}-${paxCount}pax`
      }
    }

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
 *   Booking match nếu có ≥ 1 vé CHƯA THU có companyId thuộc mảng.
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
  // 2026-11-11: chỉ giữ booking còn ít nhất 1 VÉ CHƯA THU thuộc các công ty
  //   này (công nợ tính theo từng vé / hoá đơn tách, không theo cả booking).
  return all.filter(b => unpaidTicketsOf(b, t => idSet.has(t.companyId)).length > 0)
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
 * 2026-11-20: Gom số hóa đơn + ngày phát hành của 1 booking cho PDF báo cáo công nợ.
 * Chỉ gom các invoice đã ISSUED/ADJUSTED. Mỗi invoiceNumbers (CSV) sinh ra 1 bản ghi
 * cho mỗi số (cặp với cùng issuedDate của invoice mẹ).
 */
function collectIssuedInfo(b) {
  const out = []
  for (const inv of (b.invoices || [])) {
    const issued = inv.status === 'ISSUED' || inv.status === 'ADJUSTED' || !!inv.issuedUrl
    if (!issued) continue
    const nums = (inv.invoiceNumbers || '')
      .split(',').map(s => s.trim()).filter(Boolean)
    const at = inv.issuedDate || inv.updatedAt || inv.createdAt || null
    if (nums.length === 0 && at) {
      // Invoice đã phát hành nhưng chưa nhập số → vẫn ghi ngày.
      out.push({ number: null, issuedAt: at })
    } else {
      for (const n of nums) out.push({ number: n, issuedAt: at })
    }
  }
  // Dedupe theo number (giữ ngày sớm nhất).
  const seen = new Map()
  for (const r of out) {
    const key = r.number || `@${r.issuedAt}`
    if (!seen.has(key) || (r.issuedAt && r.issuedAt < seen.get(key).issuedAt)) seen.set(key, r)
  }
  return [...seen.values()].sort((a, c) => {
    const na = Number(a.number), nc = Number(c.number)
    if (Number.isFinite(na) && Number.isFinite(nc)) return na - nc
    return String(a.number || '').localeCompare(String(c.number || ''))
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

  // ── 2026-11-20: 9 cột mới, FIT 1 TRANG (landscape A4 802pt usable) ──
  //   Cuối cột "Tổng booking" (72) được thay bằng "Ngày phát hành HĐ" (65, gọn hơn),
  //   phần dự ra cộng vào cột Hành trình/tên HK cho dễ đọc.
  const widths = [55, 30, 44, 117, 165, 79, 78, 65, 105]
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
    headL('Ngày xuất vé'),     // A
    headL('Hãng'),              // B
    headL('Mã BK'),             // C
    headL('Hành trình'),        // D
    headL('Tên / Nội dung'),    // E (tên HK hoặc loại phí)
    headL('Số vé'),             // F
    headR('Giá bán'),           // G (quy đổi VNĐ)
    headL('Ngày PH HĐ'),       // H (mới — thay Tổng booking)
    headR('Số hoá đơn'),        // I
  ]

  // 2026-11-20: Mỗi BOOKING thành 1 mini-table riêng, bọc trong stack
  //   `unbreakable: true` → booking KHÔNG bao giờ bị tách giữa 2 trang.
  //   Header row là 1 bảng độc lập (1 lần / section); subtotal là 1 bảng độc
  //   lập ở cuối section. pdfmake sẽ tự nhảy trang trước mỗi booking nếu
  //   phần còn lại của trang không đủ chứa.
  const commonLayout = {
    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
    hLineColor: () => '#CBD5E1', vLineColor: () => '#CBD5E1',
    paddingLeft: () => 3, paddingRight: () => 3,
    paddingTop: () => 2, paddingBottom: () => 2,
  }
  // Mini-table booking: KHÔNG vẽ đường ngang TRÊN để không bị trùng với
  //   đường ngang DƯỚI của bảng ngay phía trên (header / booking trước).
  const bookingLayout = {
    ...commonLayout,
    hLineWidth: (i, node) => (i === 0 ? 0 : 0.5),
  }

  const buildSectionContent = (section) => {
    const items = []        // các node pdfmake của section
    let sumSellVnd = 0      // tổng giá vé (không tính phí) đã quy đổi VNĐ
    let sumFeeVnd  = 0      // tổng phí quy đổi VNĐ

    // Bảng chứa HEADER ROW — 1 lần đầu section.
    items.push({
      table: { widths, body: [headerRow] },
      layout: commonLayout,
    })

    for (const b of section.bookings) {
      const tickets = b.tickets || []
      if (tickets.length === 0) continue

      // ── 2026-11-20 (fix): Gom vé theo HOÁ ĐƠN. Vé cùng chung 1 hoá đơn
      //   nằm liền nhau; cột "Ngày PH HĐ" và "Số hoá đơn" rowSpan trong PHẠM VI
      //   NHÓM (không phải cả booking). Dòng đầu nhóm hiện ngày+số, các dòng
      //   kế trong nhóm để trống (do rowSpan).
      const groupMap = new Map()
      for (const t of tickets) {
        const invs = invoicesOfTicket(b, t.id)
        const key = invs.map(i => i.id).sort((a, c) => a - c).join(',') || '__none__'
        if (!groupMap.has(key)) groupMap.set(key, { key, invoices: invs, tickets: [] })
        groupMap.get(key).tickets.push(t)
      }
      const groups = [...groupMap.values()]
      // Mỗi nhóm: build issuedInfos (số + ngày) & rowSpan (số dòng vé + phí).
      for (const g of groups) {
        g.rowSpan = g.tickets.reduce((s, t) => s + 1 + (t.fees ? t.fees.length : 0), 0)
        g.issuedInfos = []
        for (const inv of g.invoices) {
          const issued = inv.status === 'ISSUED' || inv.status === 'ADJUSTED' || !!inv.issuedUrl
          if (!issued) continue
          const nums = (inv.invoiceNumbers || '').split(',').map(s => s.trim()).filter(Boolean)
          const at = inv.issuedDate || inv.updatedAt || inv.createdAt || null
          if (nums.length === 0 && at) {
            g.issuedInfos.push({ number: null, issuedAt: at })
          } else {
            for (const n of nums) g.issuedInfos.push({ number: n, issuedAt: at })
          }
        }
        g.issuedInfos.sort((a, c) => {
          const na = Number(a.number), nc = Number(c.number)
          if (Number.isFinite(na) && Number.isFinite(nc)) return na - nc
          return String(a.number || '').localeCompare(String(c.number || ''))
        })
      }

      // Tổng số dòng của booking (dùng cho rowSpan cột A..D).
      const N = groups.reduce((s, g) => s + g.rowSpan, 0)
      const route = buildRouteStr(b.segments)

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

      // Body CHỈ của booking này — không có header row.
      const bookingBody = []

      let firstRowOfBooking = true
      for (const group of groups) {
        let firstRowOfGroup = true
        for (const t of group.tickets) {
          const n = ticketNumbers(t, b)
          const sellWithoutFees = n.base + n.coll + n.hnh + n.iss
          const sellVnd = toVnd(sellWithoutFees, b)
          sumSellVnd += sellVnd

          // ── Dòng vé ──
          const ticketRow = []
          // A..D rowSpan cả booking ở dòng đầu tiên của booking
          if (firstRowOfBooking) {
            ticketRow.push(cellL([
              { text: b.saleDate ? fmtDateShort(b.saleDate) : '—', fontSize: 8 },
              { text: KIND_LABEL[b.kind] || b.kind || '—', fontSize: 7, bold: true, color: '#475569' },
            ], { rowSpan: N }))
            ticketRow.push(cellL({ text: b.airlineCode || '—', fontSize: 8 }, { rowSpan: N }))
            ticketRow.push(cellL({ text: b.bookingCode || '—', fontSize: 8, bold: true }, { rowSpan: N }))
            ticketRow.push(cellL({ text: route, fontSize: 8, bold: true, color: '#1e40af' }, { rowSpan: N }))
          } else {
            ticketRow.push({}, {}, {}, {})
          }
          // E Tên hành khách
          ticketRow.push(cellL({ text: (t.passengerName || '—').toUpperCase(), fontSize: 8 }))
          // F Số vé
          ticketRow.push(cellL({ text: t.ticketNumber || '—', fontSize: 8, color: t.ticketNumber ? '#111' : '#aaa' }))
          // G Giá bán (VNĐ)
          ticketRow.push(cellR({
            text: `${formatMoney(sellVnd, 'VND', { withUnit: false })} VNĐ`,
            fontSize: 8, bold: true, alignment: 'right',
          }))
          // H Ngày PH HĐ — rowSpan trong phạm vi NHÓM, dòng đầu nhóm.
          if (firstRowOfGroup) {
            if (group.issuedInfos.length === 0) {
              ticketRow.push(cellL({ text: '—', fontSize: 8, color: '#aaa' }, { rowSpan: group.rowSpan }))
            } else {
              ticketRow.push(cellL(
                group.issuedInfos.map(r => ({
                  text: r.issuedAt ? fmtDate(r.issuedAt) : '—',
                  fontSize: 8,
                  color: r.issuedAt ? '#0f172a' : '#aaa',
                })),
                { rowSpan: group.rowSpan }
              ))
            }
          } else {
            ticketRow.push({})
          }
          // I Số hoá đơn — rowSpan trong phạm vi NHÓM, dòng đầu nhóm.
          if (firstRowOfGroup) {
            if (group.issuedInfos.length === 0) {
              ticketRow.push(cellR({ text: '—', fontSize: 8, color: '#aaa' }, { rowSpan: group.rowSpan }))
            } else {
              ticketRow.push(cellR(
                group.issuedInfos.map(r => ({
                  text: r.number ? `#C26MCB${r.number}` : '—',
                  fontSize: 8, bold: true,
                  color: r.number ? '#0f172a' : '#aaa',
                  alignment: 'right',
                })),
                { rowSpan: group.rowSpan }
              ))
            }
          } else {
            ticketRow.push({})
          }
          bookingBody.push(ticketRow)
          firstRowOfBooking = false
          firstRowOfGroup = false

          // ── Các dòng phí của vé này (nằm trong rowSpan của nhóm) ──
          const fees = t.fees || []
          fees.forEach((f) => {
            const label = stripFeePrefix(f.feeTypeLabel || FEE_LABEL[f.feeType] || f.feeType || 'Phí')
            const feeAmt = parseAmount(f.amount) || 0
            const feeCur = (f.currency || b.currency || 'VND').toUpperCase()
            let feeVnd = 0
            if (feeCur === 'VND') feeVnd = feeAmt
            else if (feeCur === 'USD') {
              const r = parseAmount(b.exchangeRate) || 0
              feeVnd = r > 0 ? feeAmt * r : 0
            }
            sumFeeVnd += feeVnd

            const feeRow = [
              {}, {}, {}, {},                // A..D (đã rowSpan)
              cellL([
                { text: (t.passengerName || '—').toUpperCase(), fontSize: 7.5, color: '#64748b' },
                { text: `↳ Phí ${label.toLowerCase()}`, fontSize: 8, italics: true, color: '#0f766e' },
              ]),
              cellL({
                text: (f.ticketNumber || '').trim() || '—',
                fontSize: 7.5,
                color: (f.ticketNumber || '').trim() ? '#64748b' : '#cbd5e1',
              }),
              cellR({
                text: `${formatMoney(feeVnd, 'VND', { withUnit: false })} VNĐ`,
                fontSize: 8, color: '#0f766e', bold: true, alignment: 'right',
              }),
              {}, {},                          // H, I đã rowSpan (nhóm)
            ]
            bookingBody.push(feeRow)
          })
        }
      }

      // ── 2026-11-20 (fix 2): Mỗi booking = 1 mini-table unbreakable ──
      items.push({
        stack: [{
          table: { widths, body: bookingBody, dontBreakRows: true },
          layout: bookingLayout,
        }],
        unbreakable: true,
      })
    }

    // Subtotal row (nền indigo nhạt) — bảng riêng cuối section.
    const grand = sumSellVnd + sumFeeVnd
    const subRow = new Array(colCount).fill(null).map(() => ({ text: '', fillColor: '#eef2ff' }))
    subRow[0] = { text: 'Cộng', bold: true, fontSize: 8, fillColor: '#eef2ff', colSpan: 6, alignment: 'right' }
    for (let i = 1; i < 6; i++) subRow[i] = { text: '', fillColor: '#eef2ff' }
    subRow[6] = { text: `${formatMoney(grand, 'VND', { withUnit: false })} VNĐ`,
      bold: true, fontSize: 8, fillColor: '#eef2ff', alignment: 'right' }
    subRow[7] = { text: '', fillColor: '#eef2ff' }
    subRow[8] = { text: '', fillColor: '#eef2ff' }
    items.push({
      table: { widths, body: [subRow] },
      layout: bookingLayout,
    })

    return {
      items,
      sumSellVnd, sumFeeVnd, grand,
      invNumCount: (() => {
        const set = new Set()
        for (const b of section.bookings) {
          for (const r of collectIssuedInfo(b)) if (r.number) set.add(r.number)
        }
        return set.size
      })(),
    }
  }

  // Build nội dung: mỗi section = title + items (header-table + unbreakable booking tables + subtotal-table)
  const content = []
  let grandSell = 0
  let grandFee  = 0
  let grandInv  = 0
  sections.forEach((s, idx) => {
    const built = buildSectionContent(s)
    grandSell += built.sumSellVnd
    grandFee  += built.sumFeeVnd
    grandInv  += built.invNumCount
    content.push({
      text: s.companyName,
      fontSize: 10, bold: true, color: '#1e293b',
      margin: [0, idx === 0 ? 0 : 10, 0, 2],
    })
    content.push({
      text: built.invNumCount > 0
        ? `${built.invNumCount} hoá đơn`
        : `Chưa có hoá đơn`,
      fontSize: 8, color: '#64748b',
      margin: [0, 0, 0, 4],
    })
    for (const it of built.items) content.push(it)
  })

  // Grand total nếu > 1 section — khớp 9 cột, canh phải.
  if (sections.length > 1) {
    const grandAll = grandSell + grandFee
    const totalRow = new Array(widths.length).fill(null).map(() =>
      ({ text: '', fillColor: '#1e293b' }))
    totalRow[0] = { text: 'TỔNG CỘNG TẤT CẢ', bold: true, fontSize: 10,
      fillColor: '#1e293b', color: '#fff', colSpan: 6, alignment: 'right' }
    for (let i = 1; i < 6; i++) totalRow[i] = { text: '', fillColor: '#1e293b' }
    totalRow[6] = { text: `${formatMoney(grandAll, 'VND', { withUnit: false })} VNĐ`,
      bold: true, fontSize: 10, fillColor: '#1e293b', color: '#fff', alignment: 'right' }
    totalRow[7] = { text: '', fillColor: '#1e293b' }
    totalRow[8] = { text: '', fillColor: '#1e293b' }
    content.push({
      table: { widths, body: [totalRow] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0,
        paddingLeft: () => 3, paddingRight: () => 3,
        paddingTop: () => 4, paddingBottom: () => 4 },
      margin: [0, 8, 0, 0],
    })
  }

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

  const safeCode = (rootCode || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)
  const fn = `Cong_no_${safeCode || 'UNKNOWN'}.pdf`
  pdfMake.createPdf(docDefinition).download(fn)
}