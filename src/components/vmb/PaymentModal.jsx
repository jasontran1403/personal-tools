import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import ConfirmModal from '../common/ConfirmModal'
import ZoomablePreview from './ZoomablePreview'
import { recordPayment, listPayments, deletePayment } from '../../services/vmbApi'
import { parseAmount, formatMoney, sumAmounts } from '../../lib/money'

/**
 * Thu tiền 1 booking.
 *
 * ── Bố cục ─────────────────────────────────────────────
 * 1. Header: tổng booking, đã thu, còn lại
 * 2. Ô nhập số tiền + nút "Max" (điền = số còn lại)
 * 3. Ghi chú (tùy)
 * 4. Chọn ảnh biên nhận (tùy — chuyển khoản có thể không cần)
 * 5. Lịch sử thu (nếu có) — mỗi phiếu có nút xóa + preview ảnh biên nhận
 *
 * Sau khi ghi nhận, refresh danh sách + đóng modal + callback onSaved.
 *
 * ── 2026-09-15 ──────────────────────────────────────────
 * Nút 📎 mở ZoomablePreview full-screen (đồng bộ với mọi chỗ khác trong khu VMB)
 * thay vì window.open tab mới. Trải nghiệm nhất quán, không phải nhảy tab.
 */
export default function PaymentModal({ booking, onClose, onSaved }) {
  const total = sumAmounts(...(booking.tickets || []).map(t =>
    sumAmounts(t.basePrice, t.collectionFee, t.serviceFee, t.issuanceFee)))
  const paidNum = parseAmount(booking.paidAmount) || 0
  const remain = Math.max(0, total - paidNum)

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  const [history, setHistory] = useState([])
  const [loadingHist, setLoadingHist] = useState(true)
  const [confirmDel, setConfirmDel] = useState(null)
  // { url, name } — payment biên nhận đang preview; null = không hiển thị
  const [preview, setPreview] = useState(null)

  const fileInputRef = useRef(null)

  const loadHistory = useCallback(async () => {
    setLoadingHist(true)
    try {
      const res = await listPayments(booking.id)
      setHistory(res.data?.data || [])
    } catch (e) {
      // silent — nếu list lỗi thì cũng cho user thu tiếp
    } finally {
      setLoadingHist(false)
    }
  }, [booking.id])

  useEffect(() => { loadHistory() }, [loadHistory])

  const setMax = () => setAmount(formatMoney(remain, booking.currency, { withUnit: false }))

  const submit = async (e) => {
    e.preventDefault()
    const n = parseAmount(amount)
    if (!(n > 0)) return toast.error('Số tiền phải > 0')
    if (n > remain + 0.5 && remain > 0) {
      if (!window.confirm(`Số thu (${formatMoney(n, booking.currency)}) LỚN HƠN số còn lại (${formatMoney(remain, booking.currency)}). Tiếp tục?`)) return
    }

    setBusy(true)
    try {
      await recordPayment(booking.id, { amount, note, file })
      toast.success('Đã ghi nhận')
      onSaved?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Ghi nhận thất bại')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDel) return
    try {
      await deletePayment(confirmDel.id)
      toast.success('Đã xóa phiếu thu')
      setConfirmDel(null)
      loadHistory()
      onSaved?.()      // để parent recompute status
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Xóa thất bại')
    }
  }

  return (
    <>
      <Modal open onClose={busy ? undefined : onClose}
        title={`Thu tiền — ${booking.bookingCode || 'booking'}`}
        size="md" closeOnBackdrop={!busy}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
              Đóng
            </button>
            <button type="submit" form="payment-form" disabled={busy || remain <= 0}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
                hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Đang ghi…' : (remain <= 0 ? 'Đã thu đủ' : 'Thu tiền')}
            </button>
          </div>
        }>
        {/* Summary */}
        <div className="mb-3 p-3 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200">
          <div className="grid grid-cols-3 gap-2 text-center">
            <SumCol label="Tổng" value={formatMoney(total, booking.currency)}
              cls="text-gray-900" />
            <SumCol label="Đã thu" value={formatMoney(paidNum, booking.currency)}
              cls="text-green-700" />
            <SumCol label="Còn lại" value={formatMoney(remain, booking.currency)}
              cls={remain <= 0 ? 'text-gray-400' : 'text-rose-700 font-bold'} />
          </div>
        </div>

        <form id="payment-form" onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
              Số tiền thu ({booking.currency})
            </label>
            <div className="flex gap-2">
              <input type="text" value={amount}
                onChange={e => setAmount(e.target.value)}
                onBlur={e => {
                  const n = parseAmount(e.target.value)
                  if (Number.isFinite(n)) setAmount(formatMoney(n, booking.currency, { withUnit: false }))
                }}
                placeholder="VD: 500.000"
                className="input flex-1 font-mono tabular-nums text-lg" required />
              <button type="button" onClick={setMax}
                disabled={remain <= 0}
                title={`Điền = số còn lại (${formatMoney(remain, booking.currency)})`}
                className="px-3 py-2 rounded-lg bg-gray-800 text-white text-xs font-bold
                  hover:bg-gray-900 disabled:opacity-40 shrink-0">
                MAX
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
              Ghi chú (tùy)
            </label>
            <input type="text" value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="VD: Chuyển khoản Vietcombank, đợt 1"
              className="input" />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
              Ảnh biên nhận (tùy)
            </label>
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" hidden
                accept="image/*,application/pdf"
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
        </form>

        {/* Lịch sử thu */}
        <div className="mt-5 pt-4 border-t border-gray-200">
          <div className="text-xs font-bold text-gray-700 uppercase mb-2">
            Lịch sử thu {loadingHist && <span className="text-gray-400 normal-case">(đang tải…)</span>}
          </div>
          {history.length === 0 && !loadingHist ? (
            <div className="text-xs text-gray-400 italic">Chưa có phiếu thu nào.</div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {history.map(p => (
                <div key={p.id} className="p-2 rounded-lg bg-gray-50 border border-gray-100 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-sm font-bold text-green-700">
                        + {p.amount}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {new Date(p.createdAt).toLocaleString('vi-VN')}
                      </span>
                      {p.createdBy && (
                        <span className="text-[10px] text-gray-400">bởi {p.createdBy}</span>
                      )}
                    </div>
                    {p.note && (
                      <div className="text-xs text-gray-600 truncate">{p.note}</div>
                    )}
                  </div>
                  {p.fileUrl && (
                    <button type="button"
                      onClick={() => setPreview({ url: p.fileUrl, name: p.fileOriginal || 'Biên nhận' })}
                      title="Xem ảnh biên nhận"
                      className="text-blue-600 hover:text-blue-800 text-xs px-2 py-1 rounded-md hover:bg-blue-50">
                      📎
                    </button>
                  )}
                  <button type="button" onClick={() => setConfirmDel(p)}
                    title="Xóa phiếu thu"
                    className="text-rose-500 hover:text-rose-700 w-7 h-7 rounded-md hover:bg-rose-50 flex items-center justify-center">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

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

      {preview && (
        <ZoomablePreview
          filePath={preview.url}
          fileName={preview.name}
          title={`Biên nhận · ${preview.name}`}
          onClose={() => setPreview(null)}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          open title="Xóa phiếu thu"
          message={`Xóa phiếu thu ${confirmDel.amount}? Ảnh biên nhận (nếu có) cũng bị xóa nếu không booking khác dùng chung.`}
          confirmLabel="Xóa" danger
          onConfirm={doDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  )
}

function SumCol({ label, value, cls }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 uppercase">{label}</div>
      <div className={`text-sm font-mono tabular-nums ${cls}`}>{value}</div>
    </div>
  )
}