import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import { batchPay } from '../../services/vmbApi'
import { parseAmount, formatMoney, sumAmounts, toVnd } from '../../lib/money'

/**
 * ── 2026-10-10 rework ─────────────────────────────────────────
 * Thu batch nhiều booking.
 *
 * Modal luôn hiển thị giữa màn hình (Modal common). max-h = 80dvh, bảng
 * breakdown cuộn trong khung bảng.
 *
 * Bảng breakdown:
 *   - Mỗi booking expand ra các vé con, mỗi vé 1 dòng.
 *   - Số tiền hiển thị QUY ĐỔI VND (nếu booking là USD, nhân với exchangeRate
 *     của chính booking đó).
 *   - Cột: Booking | Khách / Vé | Số tiền (VND).
 *   - Bỏ cột "Đã thu / Sẽ thu".
 *   - Dòng cuối = tổng VND của mọi vé/booking đã chọn.
 *
 * Booking đã PAID không nằm trong list truyền vào (parent đã lọc).
 *
 * ── Quy tắc BE giữ nguyên ─────────────────────────────────
 * - BE thu ĐỦ số còn lại của mỗi booking.
 * - Mỗi booking vẫn phải cùng currency với chính nó (không gộp sang 1 PaymentIO).
 *   Nhưng vì FE giờ chỉ hiển thị VND quy đổi, user không cần quan tâm.
 * - Có cảnh báo nếu các booking khác currency (vì BE vẫn tạo payment theo
 *   currency của từng booking) — hiển thị warning mềm, vẫn cho submit.
 */
export default function BatchPaymentModal({ bookings, onClose, onSaved }) {
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef(null)

  const sumTicketFees = (fees) => (!fees || fees.length === 0)
    ? 0 : sumAmounts(...fees.map(f => f.amount || 0))

  // Build breakdown: mỗi booking → list dòng vé. Số tiền quy đổi VND.
  const rowsByBooking = useMemo(() => bookings.map(b => {
    const tickets = (b.tickets || []).map(t => {
      const amtOrig = sumAmounts(
        t.basePrice,
        t.collectionFee,
        sumTicketFees(t.fees),
        t.issuanceFee,
      )
      const amtVnd = toVnd(amtOrig, b.currency, b.exchangeRate)
      return {
        id: t.id,
        passengerName: t.passengerName || '(chưa có tên)',
        ticketNumber: t.ticketNumber || '',
        amtOrig,
        amtVnd: Number.isFinite(amtVnd) ? amtVnd : amtOrig, // fallback nếu rate thiếu
      }
    })
    const totalOrig = sumAmounts(...tickets.map(x => x.amtOrig))
    const totalVnd  = tickets.reduce((s, x) => s + (Number.isFinite(x.amtVnd) ? x.amtVnd : 0), 0)
    const paidNum   = parseAmount(b.paidAmount) || 0
    const remainOrig = Math.max(0, totalOrig - paidNum)
    return {
      id: b.id,
      code: b.bookingCode || '—',
      currency: b.currency,
      exchangeRate: b.exchangeRate,
      tickets,
      totalOrig,
      totalVnd,
      remainOrig,
      willPay: remainOrig > 0, // dù BE skip PAID, parent cũng không gửi vào nữa.
    }
  }), [bookings])

  // Tổng cộng VND (gộp cả USD đã quy đổi).
  const grandTotalVnd = useMemo(
    () => rowsByBooking.reduce((s, r) => s + r.totalVnd, 0),
    [rowsByBooking]
  )

  const currencies = new Set(rowsByBooking.map(r => r.currency))
  const mixedCurrency = currencies.size > 1

  const willPayCount = rowsByBooking.filter(r => r.willPay).length

  const submit = async (e) => {
    e.preventDefault()
    if (willPayCount === 0) return toast.error('Không có booking nào cần thu.')
    setBusy(true)
    try {
      const bookingIds = rowsByBooking.filter(r => r.willPay).map(r => r.id)
      await batchPay({ bookingIds, note, file })
      toast.success(`Đã ghi nhận cho ${bookingIds.length} booking`)
      onSaved?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Ghi nhận batch thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}
      title={`Thu tiền hàng loạt (${bookings.length} booking)`}
      size="lg" closeOnBackdrop={!busy}
      footer={
        <div className="flex items-center gap-2">
          <div className="flex-1 text-[11px] text-gray-500">
            {willPayCount} booking sẽ thu
          </div>
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
          <button type="submit" form="batch-pay-form"
            disabled={busy || willPayCount === 0}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
              hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang ghi…' : `Thu đủ ${willPayCount} booking`}
          </button>
        </div>
      }>

      {/* ── Khung breakdown — scroll trong bảng, max-h 80dvh (toàn modal) ── */}
      <div className="flex flex-col gap-3" style={{ maxHeight: '80dvh' }}>
        {mixedCurrency && (
          <div className="shrink-0 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
            ℹ Các booking có <b>đơn vị tiền khác nhau</b> (VND + USD). Mỗi booking vẫn
            thu theo đơn vị gốc; cột bên dưới hiển thị QUY ĐỔI VND để bạn tổng hợp.
          </div>
        )}

        <div className="shrink-0 p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-baseline gap-2">
          <span className="text-xs font-bold text-blue-700 uppercase">Tổng cần thu (VND)</span>
          <span className="font-mono tabular-nums text-lg font-bold text-blue-900">
            {formatMoney(grandTotalVnd, 'VND')}
          </span>
          <span className="text-[10px] text-blue-600">({willPayCount} booking)</span>
        </div>

        {/* Bảng — scroll RIÊNG trong khung này, header dính */}
        <div className="flex-1 min-h-0 border border-gray-200 rounded-xl overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 text-[10px] uppercase sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Booking</th>
                  <th className="text-left px-3 py-2 font-semibold">Khách / Vé</th>
                  <th className="text-right px-3 py-2 font-semibold">Số tiền (VND)</th>
                </tr>
              </thead>
              <tbody>
                {rowsByBooking.map(b => (
                  <BookingBlock key={b.id} booking={b} />
                ))}
              </tbody>
              {/* Dòng tổng dính dưới cùng — bg-blue-50 có override cho darkmode
                   (xem src/theme/darkmode.css), tránh dùng alpha /95 vì chưa có mapping. */}
              <tfoot className="sticky bottom-0 z-10 bg-blue-50 border-t-2 border-blue-300">
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-right text-[11px] font-bold text-blue-900 uppercase">
                    Tổng cộng
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-blue-900 text-sm">
                    {formatMoney(grandTotalVnd, 'VND')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <form id="batch-pay-form" onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
            Ghi chú (chung cho cả batch)
          </label>
          <input type="text" value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="VD: Chuyển khoản Vietcombank ngày 14/09"
            className="input" />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
            Ảnh biên nhận (dùng chung cho tất cả booking)
          </label>
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" hidden accept="image/*,application/pdf"
              onChange={e => setFile(e.target.files?.[0] || null)} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 border border-blue-200">
              📎 Chọn ảnh
            </button>
            {file && (
              <>
                <span className="text-xs text-gray-700 truncate flex-1">{file.name}</span>
                <button type="button" onClick={() => setFile(null)}
                  className="w-7 h-7 rounded-md hover:bg-rose-100 text-rose-600">×</button>
              </>
            )}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-snug">
          💡 Thu batch <b>bắt buộc thu ĐỦ</b> mỗi booking. Nếu muốn thu 1 phần
          của 1 booking, dùng chức năng "Thu tiền" riêng cho booking đó.
        </div>
      </form>

      <style>{`
        .input {
          width: 100%; padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #d1d5db; background: #fff;
          font-size: 0.875rem; outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        .input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
      `}</style>
    </Modal>
  )
}

/**
 * 1 booking + list vé con. Hiển thị:
 *   Dòng header booking (nền xám nhạt): mã, số tiền gốc (nếu USD → kèm quy đổi VND)
 *   Các dòng vé: indented, tên khách + số vé, số tiền VND
 */
function BookingBlock({ booking }) {
  const b = booking
  const isUsd = b.currency === 'USD'
  return (
    <>
      <tr className="bg-slate-100 border-t border-slate-200">
        <td className="px-3 py-1.5 font-mono font-bold text-gray-900">{b.code}</td>
        <td className="px-3 py-1.5 text-[10px] text-gray-500">
          {isUsd ? (
            <>USD · 1 USD = {formatMoney(parseAmount(b.exchangeRate) || 0, 'VND', { withUnit: false })}</>
          ) : 'VND'}
          <span className="mx-1">·</span>
          {b.tickets.length} vé
        </td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs font-bold text-gray-900">
          {formatMoney(b.totalVnd, 'VND')}
          {isUsd && (
            <div className="text-[10px] font-normal text-gray-500">
              = {formatMoney(b.totalOrig, 'USD')}
            </div>
          )}
        </td>
      </tr>
      {b.tickets.map(t => (
        <tr key={t.id} className="border-t border-gray-100 hover:bg-blue-50/40">
          <td className="px-3 py-1.5"></td>
          <td className="px-3 py-1.5">
            <div className="text-xs text-gray-800 truncate">{t.passengerName}</div>
            {t.ticketNumber && (
              <div className="font-mono text-[10px] text-gray-400 truncate">{t.ticketNumber}</div>
            )}
          </td>
          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs text-gray-700">
            {formatMoney(t.amtVnd, 'VND', { withUnit: false })}
            {isUsd && t.amtOrig > 0 && (
              <div className="text-[10px] text-gray-400">
                {formatMoney(t.amtOrig, 'USD', { withUnit: false })} USD
              </div>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}