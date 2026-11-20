import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import { collectPreview, collectBatch, listFinanceAccounts } from '../../services/vmbApi'
import { parseAmount, formatMoney } from '../../lib/money'

/**
 * ── 2026-11-20 (rev4) ─────────────────────────────────────────
 * Thu tiền hàng loạt THEO TỪNG BOOKING. Mỗi booking (kể cả booking link vào
 * nhóm) là 1 dòng riêng, số tiền = PHẦN VÉ CỦA RIÊNG booking đó — KHÔNG gộp
 * tiền của booking/vé khác, dù dùng chung 1 hóa đơn nhóm với booking chủ.
 *
 * BE (previewBatchCollect) trả sẵn từng dòng: bookingId, invoiceId (hóa đơn sẽ
 * ghi phiếu thu, có thể là hóa đơn nhóm ở booking chủ), remain (phần riêng còn
 * phải thu), remainVnd (quy đổi). Khi submit → collectBatch ghi 1 phiếu thu cho
 * MỖI dòng, gắn đúng booking → cả booking chủ lẫn booking link đều chuyển ĐÃ THU.
 */
export default function BatchPaymentModal({ bookings, onClose, onSaved }) {
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [accountCode, setAccountCode] = useState('CASH')
  const [rows, setRows] = useState([])
  const [preparing, setPreparing] = useState(true)
  // key mỗi dòng = `${bookingId}::${invoiceId}` — để tick/bỏ từng dòng.
  const [excluded, setExcluded] = useState(() => new Set())
  const fileInputRef = useRef(null)

  const rowKey = (r) => `${r.bookingId}::${r.invoiceId}`

  useEffect(() => {
    listFinanceAccounts().then(res => {
      const list = (res.data?.data || []).filter(a => !a.isVirtual)
      setAccounts(list)
      if (list.length && !list.some(a => a.code === accountCode)) {
        setAccountCode(list[0].code)
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Nạp các dòng cần thu (phần riêng từng booking) từ BE.
  useEffect(() => {
    let cancel = false
    setPreparing(true)
    const ids = (bookings || []).map(b => b.id)
    collectPreview(ids)
      .then(res => { if (!cancel) setRows(res.data?.data || []) })
      .catch(() => { if (!cancel) setRows([]) })
      .finally(() => { if (!cancel) setPreparing(false) })
    return () => { cancel = true }
  }, [bookings])

  // Gom dòng theo booking, giữ thứ tự booking người dùng chọn.
  const groups = useMemo(() => {
    const order = (bookings || []).map(b => b.id)
    const byBooking = new Map()
    for (const r of rows) {
      if (!byBooking.has(r.bookingId)) byBooking.set(r.bookingId, [])
      byBooking.get(r.bookingId).push(r)
    }
    const out = []
    for (const id of order) {
      const list = byBooking.get(id)
      if (!list || list.length === 0) continue
      out.push({ bookingId: id, code: list[0].bookingCode, currency: list[0].currency,
        exchangeRate: list[0].exchangeRate, rows: list })
    }
    return out
  }, [rows, bookings])

  const selectedRows = useMemo(
    () => rows.filter(r => !excluded.has(rowKey(r))),
    [rows, excluded]
  )

  const grandTotalVnd = selectedRows.reduce((s, r) => s + (r.remainVnd || 0), 0)
  const currencies = new Set(rows.map(r => r.currency || 'VND'))
  const mixedCurrency = currencies.size > 1

  // Booking được chọn nhưng không có dòng nào cần thu (đã thu đủ phần của mình).
  const emptyBookings = useMemo(() => {
    const withRows = new Set(rows.map(r => r.bookingId))
    return (bookings || []).filter(b => !withRows.has(b.id))
  }, [rows, bookings])

  const toggle = (key) => {
    setExcluded(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    if (selectedRows.length === 0) return toast.error('Không có dòng nào được chọn.')
    if (!accountCode) return toast.error('Chọn tài khoản nhận tiền.')
    setBusy(true)
    try {
      const res = await collectBatch({ rows: selectedRows, note, file, accountCode })
      const ok = res.data?.code === 900   // StatusCode.SUCCESS = 900
      const done = (res.data?.data || []).length
      if (ok) { toast.success(`Đã thu ${done} hoá đơn`); onSaved?.() }
      else toast.error(res.data?.message || 'Thu không thành công.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Ghi nhận thu hàng loạt thất bại.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}
      title={`Thu tiền hàng loạt — ${bookings.length} booking · ${selectedRows.length} hoá đơn`}
      size="lg" closeOnBackdrop={!busy}
      footer={
        <div className="flex items-center gap-2">
          <div className="flex-1 text-[11px] text-gray-500">
            {selectedRows.length}/{rows.length} dòng sẽ thu
          </div>
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Huỷ
          </button>
          <button type="submit" form="batch-pay-form"
            disabled={busy || preparing || selectedRows.length === 0}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
              hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang ghi…' : preparing ? 'Đang chuẩn bị…' : `Thu ${selectedRows.length} hoá đơn`}
          </button>
        </div>
      }>

      <div className="flex flex-col gap-3" style={{ maxHeight: '80dvh' }}>
        {preparing && (
          <div className="shrink-0 p-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-900">
            ⏳ Đang tính phần cần thu của từng booking… vui lòng đợi.
          </div>
        )}
        {mixedCurrency && (
          <div className="shrink-0 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
            ℹ Các dòng có <b>đơn vị tiền khác nhau</b>. BE thu đúng đơn vị của từng
            booking; cột bên dưới hiển thị QUY ĐỔI VND để bạn tổng hợp.
          </div>
        )}
        {!preparing && emptyBookings.length > 0 && (
          <div className="shrink-0 p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-[11px] text-gray-600">
            ✓ <b>{emptyBookings.length} booking</b> đã thu đủ phần của mình — không còn gì để thu:{' '}
            {emptyBookings.map(b => b.bookingCode || `#${b.id}`).join(', ')}.
          </div>
        )}

        <div className="shrink-0 p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-baseline gap-2">
          <span className="text-xs font-bold text-blue-700 uppercase">Tổng cần thu (VND)</span>
          <span className="font-mono tabular-nums text-lg font-bold text-blue-900">
            {formatMoney(grandTotalVnd, 'VND')}
          </span>
          <span className="text-[10px] text-blue-600">
            ({selectedRows.length}/{rows.length} hoá đơn)
          </span>
        </div>

        <div className="flex-1 min-h-0 border border-gray-200 rounded-xl overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 text-[10px] uppercase sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold w-10"></th>
                  <th className="text-left px-3 py-2 font-semibold">Booking · Hoá đơn</th>
                  <th className="text-left px-3 py-2 font-semibold">Vé</th>
                  <th className="text-right px-3 py-2 font-semibold">Phần cần thu</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <BookingBlock key={g.bookingId} group={g} excluded={excluded}
                    toggle={toggle} rowKey={rowKey} />
                ))}
                {!preparing && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-gray-400 text-[12px]">
                      Không có dòng nào cần thu.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="sticky bottom-0 z-10 bg-blue-50 border-t-2 border-blue-300">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right text-[11px] font-bold text-blue-900 uppercase">
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
            Thanh toán vào tài khoản (chung cho mọi hoá đơn)
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {accounts.map(a => (
              <button key={a.id} type="button"
                onClick={() => setAccountCode(a.code)}
                className={`px-2 py-2 rounded-lg text-xs font-semibold border transition
                  ${accountCode === a.code
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-emerald-300'}`}>
                {a.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
            Ghi chú (chung cho mọi hoá đơn vừa chọn)
          </label>
          <input type="text" value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="VD: Chuyển khoản Vietcombank ngày 14/09"
            className="input" />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
            Ảnh biên nhận (dùng chung)
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
          💡 Mỗi dòng là <b>phần riêng của từng booking</b> (chỉ vé của chính nó),
          không gộp tiền booking khác dù dùng chung 1 hoá đơn nhóm. Bỏ tick 1 dòng
          để không thu booking đó lần này.
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

function BookingBlock({ group: g, excluded, toggle, rowKey }) {
  return (
    <>
      <tr className="bg-slate-100 border-t border-slate-200">
        <td className="px-3 py-1.5"></td>
        <td className="px-3 py-1.5 font-mono font-bold text-gray-900">{g.code}</td>
        <td className="px-3 py-1.5 text-[10px] text-gray-500">
          {g.currency === 'USD'
            ? <>USD · 1 USD = {formatMoney(parseAmount(g.exchangeRate) || 0, 'VND', { withUnit: false })}</>
            : 'VND'}
          <span className="mx-1">·</span>
          {g.rows.length} hoá đơn chưa thu
        </td>
        <td className="px-3 py-1.5"></td>
      </tr>
      {g.rows.map(r => {
        const key = rowKey(r)
        const isExcluded = excluded.has(key)
        const stLabel = r.status === 'ISSUED'   ? 'Đã PH'
                      : r.status === 'ADJUSTED' ? 'Điều chỉnh'
                      : 'Nháp'
        const stCls   = r.status === 'ISSUED'   ? 'bg-emerald-100 text-emerald-700'
                      : r.status === 'ADJUSTED' ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
        return (
          <tr key={key}
            className={`border-t border-gray-100 hover:bg-blue-50/40 ${isExcluded ? 'opacity-45' : ''}`}>
            <td className="px-3 py-1.5 text-center">
              <input type="checkbox" checked={!isExcluded}
                onChange={() => toggle(key)}
                className="w-4 h-4 accent-blue-600 cursor-pointer" />
            </td>
            <td className="px-3 py-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${stCls}`}>
                  {stLabel}
                </span>
                {r.invoiceNumbers && (
                  <span className="font-mono text-[10px] text-gray-700">#{r.invoiceNumbers}</span>
                )}
                {r.otherBookingCodes && r.otherBookingCodes.length > 0 && (
                  <span className="text-[9px] text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded font-semibold">
                    📎 dùng chung với {r.otherBookingCodes.join(', ')}
                  </span>
                )}
                {r.shared && (
                  <span className="text-[9px] text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded font-semibold"
                    title="Hoá đơn nhóm — mỗi booking thu phần riêng của mình">
                    thuộc nhóm
                  </span>
                )}
                <button type="button" onClick={() => toggle(key)}
                  title={isExcluded ? 'Thêm vào lại batch' : 'Bỏ dòng này khỏi batch'}
                  className={`ml-auto w-6 h-6 rounded-md text-xs ${
                    isExcluded ? 'text-blue-700 hover:bg-blue-100' : 'text-rose-600 hover:bg-rose-100'
                  }`}>
                  {isExcluded ? '＋' : '×'}
                </button>
              </div>
            </td>
            <td className="px-3 py-1.5">
              <div className="text-[11px] text-gray-800 truncate">
                {r.passengerNames || '—'}
              </div>
            </td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs text-gray-700">
              {formatMoney(r.remainVnd || 0, 'VND', { withUnit: false })}
              {r.currency === 'USD' && (
                <div className="text-[10px] text-gray-400">
                  {formatMoney(parseAmount(r.remain) || 0, 'USD', { withUnit: false })} USD
                </div>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}