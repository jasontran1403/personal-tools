import Modal from '../common/Modal'
import { formatMoney, parseAmount } from '../../lib/money'

/**
 * 2026-10-12: Khi 1 booking có >1 hóa đơn, user cần chọn hóa đơn nào để thu.
 * Modal này list các hóa đơn với trạng thái + số còn lại, click để chọn.
 *
 * Props:
 *   booking   — booking kèm invoices
 *   onPick(invoice) — chọn 1 hóa đơn
 *   onClose
 */
export default function InvoicePickerModal({ booking, onPick, onClose }) {
  const invoices = booking?.invoices || []

  return (
    <Modal open onClose={onClose}
      title={`Chọn hóa đơn — ${booking.bookingCode || 'booking'}`}
      size="md">
      <div className="text-xs text-gray-600 mb-3">
        Booking này có <b>{invoices.length}</b> hóa đơn. Chọn hóa đơn cần thu.
      </div>
      {invoices.length === 0 ? (
        <div className="py-10 text-center text-gray-400 text-sm">
          Chưa có hóa đơn nào.
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => {
            const total  = parseAmount(inv.grandTotal) || 0
            const paid   = parseAmount(inv.paidAmount) || 0
            const remain = Math.max(0, total - paid)
            const st = inv.paymentStatus || 'UNPAID'
            const stCls =
                st === 'PAID'    ? 'bg-green-100 text-green-700'
              : st === 'PARTIAL' ? 'bg-amber-100 text-amber-700'
              :                    'bg-rose-100 text-rose-700'
            const stLabel =
                st === 'PAID'    ? 'Đã thanh toán'
              : st === 'PARTIAL' ? 'Thu một phần'
              :                    'Chưa thanh toán'
            const scope = (inv.ticketIds && inv.ticketIds.length > 0)
              ? `Áp cho ${inv.ticketIds.length} vé`
              : `Chung cả booking (${(booking.tickets || []).length} vé)`
            const invKindBadge =
                inv.status === 'ISSUED'   ? { cls: 'bg-green-100 text-green-700',  label: 'Đã PH' }
              : inv.status === 'ADJUSTED' ? { cls: 'bg-purple-100 text-purple-700', label: 'Điều chỉnh' }
              :                             { cls: 'bg-blue-100 text-blue-700',    label: 'Nháp' }
            return (
              <button key={inv.id} type="button"
                onClick={() => onPick(inv)}
                disabled={st === 'PAID'}
                className={`w-full text-left p-3 rounded-xl border transition ${
                  st === 'PAID'
                    ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                    : 'border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50'
                }`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${invKindBadge.cls}`}>
                    {invKindBadge.label}
                  </span>
                  {inv.invoiceNumbers && (
                    <span className="font-mono text-[11px] text-gray-700">#{inv.invoiceNumbers}</span>
                  )}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${stCls}`}>
                    {stLabel}
                  </span>
                  <span className="text-[10px] text-gray-500">{scope}</span>
                </div>
                <div className="flex items-baseline gap-3 text-xs font-mono tabular-nums">
                  <div>
                    <span className="text-gray-500 text-[10px]">Tổng </span>
                    <b className="text-gray-900">{formatMoney(total, booking.currency, { withUnit: false })}</b>
                  </div>
                  <div>
                    <span className="text-gray-500 text-[10px]">Đã thu </span>
                    <b className="text-green-700">{formatMoney(paid, booking.currency, { withUnit: false })}</b>
                  </div>
                  <div>
                    <span className="text-gray-500 text-[10px]">Còn </span>
                    <b className={remain > 0 ? 'text-rose-700' : 'text-gray-400'}>
                      {formatMoney(remain, booking.currency, { withUnit: false })}
                    </b>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
