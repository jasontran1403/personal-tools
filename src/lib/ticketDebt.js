/**
 * ── ticketDebt — 2026-11-11 ─────────────────────────────────
 * Công nợ tính theo TỪNG VÉ (không còn theo cả booking).
 *
 * Lý do: 1 booking có thể gồm khách của nhiều công ty, mỗi công ty 1 hoá đơn
 * tách riêng và thanh toán riêng (công ty A đã trả, công ty B còn nợ). Nếu
 * dựa vào booking.paymentStatus thì:
 *   - Báo cáo công nợ của công ty A kéo theo cả vé của công ty B, C.
 *   - Công ty A đã trả xong vẫn bị tính nợ vì booking còn PARTIAL.
 *
 * Quy tắc xác định hoá đơn của 1 vé:
 *   1. Các hoá đơn TÁCH có ticketIds chứa vé đó.
 *   2. Không có → các hoá đơn CHUNG cả booking (ticketIds rỗng).
 *   3. Không có hoá đơn nào → dùng trạng thái của booking.
 *
 * Vé còn nợ khi có ít nhất 1 hoá đơn của vé chưa PAID.
 */
import { parseAmount } from './money'

/** Tổng giá bán của 1 vé theo ĐƠN VỊ TIỀN của booking (chưa quy đổi). */
export function ticketSellRaw(t) {
  const n = (v) => parseAmount(v) || 0
  const fees = (t.fees || []).reduce((s, f) => s + n(f.amount), 0)
  return n(t.basePrice) + n(t.collectionFee) + n(t.issuanceFee) + n(t.hnhFee) + fees
}

/** Các hoá đơn áp cho 1 vé (xem quy tắc ở đầu file). */
export function invoicesOfTicket(b, ticketId) {
  const invs = b?.invoices || []
  const split = invs.filter(i => (i.ticketIds || []).includes(ticketId))
  if (split.length) return split
  return invs.filter(i => !i.ticketIds || i.ticketIds.length === 0)
}

/** Vé này còn nợ (chưa thu đủ) hay không. */
export function isTicketUnpaid(b, t) {
  if ((b?.paymentStatus || 'UNPAID') === 'PAID') return false
  if (ticketSellRaw(t) <= 0.5) return false          // vé 0đ → không có nợ
  const invs = invoicesOfTicket(b, t.id)
  if (invs.length === 0) return true                  // chưa có hoá đơn → còn nợ
  return invs.some(i => (i.paymentStatus || 'UNPAID') !== 'PAID')
}

/** Các vé còn nợ của booking; `match(t)` để lọc thêm (vd theo công ty). */
export function unpaidTicketsOf(b, match) {
  return (b?.tickets || []).filter(t => (!match || match(t)) && isTicketUnpaid(b, t))
}

/**
 * Bản sao booking chỉ giữ các vé trong `tickets` và các hoá đơn CHƯA THU ĐỦ
 * liên quan tới các vé đó. Hoá đơn chung (ticketIds rỗng) được gán ticketIds
 * = các vé được giữ, để mọi phép cộng tiền phía sau chỉ tính trên phần vé này.
 */
export function narrowBooking(b, tickets) {
  const keep = new Set(tickets.map(t => t.id))
  const invoices = []
  for (const inv of (b.invoices || [])) {
    if ((inv.paymentStatus || 'UNPAID') === 'PAID') continue
    const ids = inv.ticketIds || []
    if (ids.length === 0) {
      // Hoá đơn chung chỉ áp cho những vé KHÔNG có hoá đơn tách riêng.
      const own = tickets.filter(t =>
        !(b.invoices || []).some(i => (i.ticketIds || []).includes(t.id)))
      if (own.length) invoices.push({ ...inv, ticketIds: own.map(t => t.id) })
    } else {
      const hit = ids.filter(id => keep.has(id))
      if (hit.length) invoices.push({ ...inv, ticketIds: hit })
    }
  }
  return { ...b, tickets, invoices }
}

/** Số hoá đơn (đã dedupe, sort tăng dần) của danh sách hoá đơn. */
export function invoiceNumbersOf(invoices) {
  const set = new Set()
  for (const inv of (invoices || [])) {
    if (!inv.invoiceNumbers) continue
    inv.invoiceNumbers.split(',').forEach(n => {
      const s = n.trim()
      if (s) set.add(s)
    })
  }
  return [...set].sort((a, c) => {
    const na = Number(a), nc = Number(c)
    if (Number.isFinite(na) && Number.isFinite(nc)) return na - nc
    return a.localeCompare(c)
  })
}