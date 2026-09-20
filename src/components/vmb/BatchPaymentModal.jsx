import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import { batchPay } from '../../services/vmbApi'
import { parseAmount, formatMoney, sumAmounts } from '../../lib/money'

/**
 * Thu batch nhiều booking.
 *
 * ── Quy tắc ─────────────────────────────────────────────
 * - Danh sách booking đã chọn hiển thị bảng: mã / khách / còn lại
 * - Tổng "cần thu" = Σ số còn lại của TẤT CẢ booking
 * - BE tự thu ĐỦ mỗi booking (số còn lại → mỗi booking); user không nhập số
 *   riêng cho từng cái (nếu muốn thì thu lẻ từng cái qua PaymentModal)
 * - Booking đã PAID sẽ bị BE skip, cảnh báo mờ trên UI
 * - Ảnh biên nhận optional nhưng khuyến khích — 1 ảnh dùng chung cho N record
 * - Chỉ hoạt động khi tất cả cùng currency (mixed VND+USD không cộng được)
 */
export default function BatchPaymentModal({ bookings, onClose, onSaved }) {
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef(null)

  // Tính info từng booking
  const rows = useMemo(() => bookings.map(b => {
    const total = sumAmounts(...(b.tickets || []).map(t =>
      sumAmounts(t.basePrice, t.collectionFee, t.serviceFee, t.issuanceFee)))
    const paid = parseAmount(b.paidAmount) || 0
    const remain = Math.max(0, total - paid)
    return {
      id: b.id, code: b.bookingCode || '—',
      passengerNames: (b.tickets || []).map(t => t.passengerName).filter(Boolean).slice(0, 2).join(', '),
      currency: b.currency,
      total, paid, remain,
      willPay: remain > 0,
    }
  }), [bookings])

  // Detect mixed currency
  const currencies = new Set(rows.map(r => r.currency))
  const mixedCurrency = currencies.size > 1

  // Group tổng theo currency (để hiển thị)
  const totalsByCurrency = useMemo(() => {
    const acc = new Map()
    for (const r of rows) {
      if (!r.willPay) continue
      const cur = acc.get(r.currency) || { willPay: 0, count: 0 }
      cur.willPay += r.remain
      cur.count += 1
      acc.set(r.currency, cur)
    }
    return acc
  }, [rows])

  const willPayCount = rows.filter(r => r.willPay).length
  const skippedCount = rows.length - willPayCount

  const submit = async (e) => {
    e.preventDefault()
    if (mixedCurrency) return toast.error('Không thể thu batch khi các booking khác đơn vị tiền.')
    if (willPayCount === 0) return toast.error('Tất cả booking đã thu đủ.')

    setBusy(true)
    try {
      const bookingIds = rows.filter(r => r.willPay).map(r => r.id)
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
            {willPayCount} booking sẽ thu · {skippedCount > 0 && <span className="text-amber-600">{skippedCount} bỏ qua</span>}
          </div>
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
          <button type="submit" form="batch-pay-form"
            disabled={busy || willPayCount === 0 || mixedCurrency}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
              hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang ghi…' : `Thu đủ ${willPayCount} booking`}
          </button>
        </div>
      }>

      {mixedCurrency && (
        <div className="mb-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
          ⚠ Các booking đã chọn dùng <b>khác đơn vị tiền</b> (VND + USD). Không thể thu batch —
          bỏ chọn để chỉ giữ 1 loại tiền, hoặc thu lẻ từng cái.
        </div>
      )}

      {/* Bảng tổng theo currency */}
      {!mixedCurrency && totalsByCurrency.size > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-2">
          {[...totalsByCurrency.entries()].map(([cur, sum]) => (
            <div key={cur} className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-baseline gap-2">
              <span className="text-xs font-bold text-blue-700 uppercase">Sẽ thu</span>
              <span className="font-mono tabular-nums text-lg font-bold text-blue-900">
                {formatMoney(sum.willPay, cur)}
              </span>
              <span className="text-[10px] text-blue-600">({sum.count} booking)</span>
            </div>
          ))}
        </div>
      )}

      {/* Danh sách booking */}
      <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600 text-[10px] uppercase">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Booking</th>
              <th className="text-left px-3 py-2 font-semibold">Khách</th>
              <th className="text-right px-3 py-2 font-semibold">Tổng</th>
              <th className="text-right px-3 py-2 font-semibold">Đã thu</th>
              <th className="text-right px-3 py-2 font-semibold">Sẽ thu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.id} className={r.willPay ? '' : 'opacity-40 bg-gray-50'}>
                <td className="px-3 py-2 font-mono font-bold">{r.code}</td>
                <td className="px-3 py-2 truncate max-w-[160px]">{r.passengerNames}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(r.total, r.currency, { withUnit: false })}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-green-700">{formatMoney(r.paid, r.currency, { withUnit: false })}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums font-bold">
                  {r.willPay
                    ? <span className="text-rose-700">{formatMoney(r.remain, r.currency, { withUnit: false })}</span>
                    : <span className="text-gray-400 italic text-[10px]">(đã đủ)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form id="batch-pay-form" onSubmit={submit} className="space-y-3">
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
