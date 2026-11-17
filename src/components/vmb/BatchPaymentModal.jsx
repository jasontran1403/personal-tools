import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import { recordInvoicePayment, ensureBookingInvoice, listFinanceAccounts } from '../../services/vmbApi'
import { parseAmount, formatMoney } from '../../lib/money'

/**
 * ── 2026-11-11 (rev3) ─────────────────────────────────────────
 * Thu batch — mỗi booking vẫn hiển thị riêng, mỗi hoá đơn CHƯA THU xuất hiện
 * dưới MỌI booking có vé của nó. Hai dòng cùng 1 hoá đơn logical dùng chung
 * một "key" trong state, nên tick/untick đồng bộ.
 *
 * Quy tắc:
 *   • Hoá đơn ĐÃ PAID không hiển thị.
 *   • Booking có ĐÚNG 1 hoá đơn → không có nút ×, không bỏ ra được (bỏ ra
 *     là booking trắng tay). Dòng vẫn tick mặc định.
 *   • Booking có ≥ 2 hoá đơn → mỗi hoá đơn có nút × để loại ra khỏi batch.
 *   • Khi hoá đơn áp cho vé của nhiều booking (mirror cũ / ticketIds
 *     cross-booking mới), có badge "📎 dùng chung với …" và tick/untick ở
 *     bất kỳ dòng nào cũng đồng bộ với các dòng khác cùng hoá đơn.
 */
export default function BatchPaymentModal({ bookings, onClose, onSaved }) {
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  // 2026-11-17: Tài khoản nhận tiền (Tiền mặt / HD / VCB) — áp CHUNG cho mọi
  //   hoá đơn trong batch; thiếu cái này thì tiền thu không vào tài khoản nào.
  const [accounts, setAccounts] = useState([])
  const [accountCode, setAccountCode] = useState('CASH')
  // key: `${ownerBookingId}::${fileNguồn || id}` — xem invoiceKey ở cuối file.
  const [excluded, setExcluded] = useState(() => new Set())
  const fileInputRef = useRef(null)

  // ── 2026-11-15: Hóa đơn nháp giờ lấy trực tiếp từ VinVoice → booking đã link
  //   nhưng chưa có bản ghi Invoice vẫn thu được. Khi mở modal, booking nào
  //   CHƯA có hoá đơn thì tự gọi BE tạo hoá đơn nháp mặc định (theo từng
  //   booking, số tiền = tổng booking đó) rồi mới dựng bảng. Nhờ vậy không còn
  //   "0 hoá đơn / không thấy số tiền cần thu".
  // Nạp danh sách tài khoản chi được (CASH/HD/VCB) để chọn nơi nhận tiền.
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

  const [workBookings, setWorkBookings] = useState(bookings)
  const [preparing, setPreparing] = useState(false)
  useEffect(() => {
    let cancel = false
    setPreparing(true)
    ;(async () => {
      // LUÔN gọi ensure cho mọi booking: BE tách hoá đơn theo link vé (vé chưa
      //   link = hoá đơn riêng, vé đã link = hoá đơn nhóm) và idempotent — nếu
      //   booking đã có hoá đơn người dùng tạo thì BE trả nguyên trạng.
      const out = []
      for (const b of bookings) {
        let invs = b.invoices || []
        try {
          const res = await ensureBookingInvoice(b.id)
          const list = res.data?.data                 // BE trả DANH SÁCH hoá đơn
          if (Array.isArray(list)) invs = list
        } catch (e) { /* giữ nguyên invs cũ */ }
        out.push({ ...b, invoices: invs })
      }
      if (!cancel) { setWorkBookings(out); setPreparing(false) }
    })()
    return () => { cancel = true }
  }, [bookings])

  // ── Build rows: mỗi booking → các hoá đơn áp cho vé của booking đó ────
  const rowsByBooking = useMemo(() => {
    // Trước tiên gom metadata chung của mỗi key: owner invoice id (để submit),
    // danh sách bookingCode của các booking có vé liên quan (để hiển thị badge).
    const meta = new Map() // key → { ownerInvoiceId, codes: Set, inv (owner preferred), tickets: Map<bookingId, Ticket[]> }
    for (const b of workBookings) {
      for (const inv of (b.invoices || [])) {
        if ((inv.paymentStatus || 'UNPAID') === 'PAID') continue
        const key = invoiceKey(inv, b)
        if (!meta.has(key)) {
          meta.set(key, {
            ownerInvoiceId: null,
            codes: new Set(),
            inv,                           // sẽ update sang owner nếu gặp
            ownerBookingCode: inv.sourceBookingCode || b.bookingCode,
          })
        }
        const rec = meta.get(key)
        rec.codes.add(b.bookingCode || `#${b.id}`)
        const isOwner = inv.sourceBookingId == null || inv.sourceBookingId === b.id
        if (isOwner) {
          rec.ownerInvoiceId = inv.id
          rec.inv = inv
        }
      }
    }
    // Fallback: nếu không gặp owner invoice (hiếm, chỉ khi không pass owner
    // booking vào modal), vẫn dùng id của bản mirror đầu tiên.
    for (const rec of meta.values()) {
      if (rec.ownerInvoiceId == null) rec.ownerInvoiceId = rec.inv.id
    }

    // Tạo list theo thứ tự booking input, mỗi booking 1 block.
    const groups = []
    for (const b of workBookings) {
      const rate = parseAmount(b.exchangeRate)
      const toVnd = (v) => {
        if (!Number.isFinite(v)) return 0
        if (b.currency === 'USD' && Number.isFinite(rate) && rate > 0) return v * rate
        return v
      }
      const invRows = []
      for (const inv of (b.invoices || [])) {
        if ((inv.paymentStatus || 'UNPAID') === 'PAID') continue
        const key = invoiceKey(inv, b)
        const rec = meta.get(key)
        const total  = parseAmount(inv.grandTotal) || 0
        const paid   = parseAmount(inv.paidAmount) || 0
        const remainOrig = Math.max(0, total - paid)
        if (remainOrig <= 0.5) continue

        // Vé mà hoá đơn áp cho trong booking NÀY.
        const ids = inv.ticketIds || []
        const tickets = ids.length > 0
          ? (b.tickets || []).filter(t => ids.includes(t.id))
          : (b.tickets || [])

        // Các booking KHÁC đang dính hoá đơn này (hiển thị badge).
        const myCode = b.bookingCode || `#${b.id}`
        const otherCodes = [...rec.codes].filter(c => c !== myCode)

        // ── 2026-11-15: "Thuộc nhóm" = vé bắt buộc thu cùng nhóm, KHÔNG bỏ ra ──
        //   • Booking chủ (isInvoiceGroupOwner): mọi vé của nó là nhóm.
        //   • Booking thành viên: hoá đơn mà MỌI vé đều đã link (linkedBookingId)
        //     → nhóm. Hoá đơn còn vé CHƯA link (vd KAGEYAMA) → vé riêng, cho
        //     tick/bỏ.
        const inGroup = !!b.isInvoiceGroupOwner
          || (tickets.length > 0 && tickets.every(t => t.linkedBookingId != null))

        invRows.push({
          key,
          ownerInvoiceId: rec.ownerInvoiceId,
          numbers: inv.invoiceNumbers || '',
          status: inv.status || 'DRAFT',
          remainOrig,
          remainVnd: toVnd(remainOrig),
          tickets,
          otherCodes,
          inGroup,
          currency: b.currency,
          bookingCode: myCode,
        })
      }
      groups.push({
        id: b.id,
        code: b.bookingCode || `#${b.id}`,
        currency: b.currency,
        exchangeRate: b.exchangeRate,
        invRows,
      })
    }
    return groups
  }, [workBookings])

  // Danh sách unique keys đang hiển thị — để tính tổng và submit.
  const allUniqueKeys = useMemo(() => {
    const s = new Map() // key → { ownerInvoiceId, remainOrig, remainVnd, currency }
    for (const g of rowsByBooking) {
      for (const r of g.invRows) {
        if (!s.has(r.key)) {
          s.set(r.key, {
            ownerInvoiceId: r.ownerInvoiceId,
            remainOrig: r.remainOrig,
            remainVnd: r.remainVnd,
            currency: r.currency,
          })
        }
      }
    }
    return s
  }, [rowsByBooking])

  const selectedKeys = useMemo(
    () => [...allUniqueKeys.keys()].filter(k => !excluded.has(k)),
    [allUniqueKeys, excluded]
  )

  // 2026-11-15: Mặc định CHỌN HẾT. Vé thuộc nhóm (đã link) bị khoá — luôn thu
  //   cùng nhóm, không bỏ ra. Vé riêng (chưa link) có checkbox — bỏ tick nếu
  //   không thu cùng.

  const grandTotalVnd = selectedKeys.reduce(
    (s, k) => s + (allUniqueKeys.get(k)?.remainVnd || 0), 0)
  const currencies = new Set([...allUniqueKeys.values()].map(v => v.currency))
  const mixedCurrency = currencies.size > 1

  // Booking không có hoá đơn áp cho vé của mình.
  const noInvoiceBookings = rowsByBooking.filter(g => g.invRows.length === 0)

  const toggle = (key) => {
    setExcluded(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    if (selectedKeys.length === 0) {
      return toast.error('Không có hoá đơn nào được chọn.')
    }
    if (!accountCode) {
      return toast.error('Chọn tài khoản nhận tiền.')
    }
    setBusy(true)
    let done = 0
    const errors = []
    try {
      for (const key of selectedKeys) {
        const meta = allUniqueKeys.get(key)
        const amount = formatMoney(meta.remainOrig, meta.currency, { withUnit: false })
        try {
          await recordInvoicePayment(meta.ownerInvoiceId, { amount, note, file, accountCode })
          done++
        } catch (err) {
          console.warn('[batch pay]', key, err)
          errors.push(key)
        }
      }
      if (errors.length === 0) {
        toast.success(`Đã thu ${done} hoá đơn`)
      } else {
        toast.error(`Thu ${done}/${selectedKeys.length} hoá đơn, ${errors.length} lỗi`)
      }
      onSaved?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}
      title={`Thu tiền hàng loạt — ${bookings.length} booking · ${selectedKeys.length} hoá đơn`}
      size="lg" closeOnBackdrop={!busy}
      footer={
        <div className="flex items-center gap-2">
          <div className="flex-1 text-[11px] text-gray-500">
            {selectedKeys.length}/{allUniqueKeys.size} hoá đơn sẽ thu
          </div>
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Huỷ
          </button>
          <button type="submit" form="batch-pay-form"
            disabled={busy || preparing || selectedKeys.length === 0}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
              hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang ghi…' : preparing ? 'Đang chuẩn bị…' : `Thu ${selectedKeys.length} hoá đơn`}
          </button>
        </div>
      }>

      <div className="flex flex-col gap-3" style={{ maxHeight: '80dvh' }}>
        {preparing && (
          <div className="shrink-0 p-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-900">
            ⏳ Đang chuẩn bị hoá đơn nháp cho các booking chưa có… vui lòng đợi.
          </div>
        )}
        {mixedCurrency && (
          <div className="shrink-0 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
            ℹ Các hoá đơn có <b>đơn vị tiền khác nhau</b>. BE thu đúng đơn vị của
            từng hoá đơn; cột bên dưới hiển thị QUY ĐỔI VND để bạn tổng hợp.
          </div>
        )}
        {noInvoiceBookings.length > 0 && (
          <div className="shrink-0 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-900">
            ⚠ <b>{noInvoiceBookings.length} booking</b> không có hoá đơn nào áp cho vé của mình
            — sẽ bị <b>BỎ QUA</b>: {noInvoiceBookings.map(b => b.code).join(', ')}.
            Hãy tạo (hoặc liên kết) hoá đơn trước rồi thu lại.
          </div>
        )}

        <div className="shrink-0 p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-baseline gap-2">
          <span className="text-xs font-bold text-blue-700 uppercase">Tổng cần thu (VND)</span>
          <span className="font-mono tabular-nums text-lg font-bold text-blue-900">
            {formatMoney(grandTotalVnd, 'VND')}
          </span>
          <span className="text-[10px] text-blue-600">
            ({selectedKeys.length}/{allUniqueKeys.size} hoá đơn)
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
                  <th className="text-right px-3 py-2 font-semibold">Còn phải thu</th>
                </tr>
              </thead>
              <tbody>
                {rowsByBooking.map(g => (
                  <BookingBlock key={g.id} booking={g} excluded={excluded} toggle={toggle} />
                ))}
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
        {/* 2026-11-17: Chọn tài khoản nhận tiền — áp chung cho cả batch. */}
        <div>
          <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
            Thanh toán vào tài khoản (chung cho mọi hoá đơn)
          </label>
          <div className="grid grid-cols-3 gap-2">
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
          💡 Mỗi hoá đơn được chọn sẽ được thu <b>đủ số còn thiếu</b>. Booking có
          nhiều hoá đơn: bỏ tick (hoặc bấm ×) để loại hoá đơn ra. Hoá đơn dùng
          chung ở nhiều booking: tick / untick đồng bộ với các dòng khác cùng
          hoá đơn.
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

function BookingBlock({ booking, excluded, toggle }) {
  const g = booking
  if (g.invRows.length === 0) return null
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
          {g.invRows.length} hoá đơn chưa thu
        </td>
        <td className="px-3 py-1.5"></td>
      </tr>
      {g.invRows.map(inv => {
        const isExcluded = excluded.has(inv.key)
        // 2026-11-15: Vé thuộc nhóm (đã link / booking chủ) → KHOÁ, bắt buộc thu
        //   cùng nhóm. Vé riêng (chưa link) → cho tick/bỏ.
        const toggleable = !inv.inGroup
        const stLabel = inv.status === 'ISSUED'   ? 'Đã PH'
                      : inv.status === 'ADJUSTED' ? 'Điều chỉnh'
                      : 'Nháp'
        const stCls   = inv.status === 'ISSUED'   ? 'bg-emerald-100 text-emerald-700'
                      : inv.status === 'ADJUSTED' ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
        return (
          <tr key={inv.key + '@' + g.id}
            className={`border-t border-gray-100 hover:bg-blue-50/40 ${isExcluded ? 'opacity-45' : ''}`}>
            <td className="px-3 py-1.5 text-center">
              <input type="checkbox" checked={!isExcluded}
                disabled={!toggleable}
                onChange={() => toggleable && toggle(inv.key)}
                title={toggleable ? 'Vé riêng — bỏ tick nếu không thu cùng' : 'Vé thuộc nhóm (đã link) — bắt buộc thu cùng nhóm'}
                className={`w-4 h-4 accent-blue-600 ${toggleable ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`} />
            </td>
            <td className="px-3 py-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${stCls}`}>
                  {stLabel}
                </span>
                {inv.numbers && (
                  <span className="font-mono text-[10px] text-gray-700">#{inv.numbers}</span>
                )}
                {inv.otherCodes.length > 0 && (
                  <span className="text-[9px] text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded font-semibold">
                    📎 dùng chung với {inv.otherCodes.join(', ')}
                  </span>
                )}
                {inv.inGroup ? (
                  <span className="text-[9px] text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded font-semibold"
                    title="Vé thuộc nhóm (đã link) — bắt buộc thu cùng nhóm">
                    thuộc nhóm
                  </span>
                ) : (
                  <span className="text-[9px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-semibold"
                    title="Vé riêng (chưa link vào nhóm) — bỏ tick nếu không thu cùng">
                    vé riêng
                  </span>
                )}
                {toggleable && (
                  <button type="button" onClick={() => toggle(inv.key)}
                    title={isExcluded ? 'Thêm vào lại batch' : 'Bỏ hoá đơn này khỏi batch'}
                    className={`ml-auto w-6 h-6 rounded-md text-xs ${
                      isExcluded
                        ? 'text-blue-700 hover:bg-blue-100'
                        : 'text-rose-600 hover:bg-rose-100'
                    }`}>
                    {isExcluded ? '＋' : '×'}
                  </button>
                )}
              </div>
            </td>
            <td className="px-3 py-1.5">
              <div className="text-[11px] text-gray-800 truncate">
                {inv.tickets.map(t => t.passengerName).filter(Boolean).join(' · ') || '—'}
              </div>
              {inv.tickets.length > 0 && inv.tickets.some(t => t.ticketNumber) && (
                <div className="font-mono text-[10px] text-gray-400 truncate">
                  {inv.tickets.map(t => t.ticketNumber).filter(Boolean).join(' · ')}
                </div>
              )}
            </td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs text-gray-700">
              {formatMoney(inv.remainVnd, 'VND', { withUnit: false })}
              {inv.currency === 'USD' && inv.remainOrig > 0 && (
                <div className="text-[10px] text-gray-400">
                  {formatMoney(inv.remainOrig, 'USD', { withUnit: false })} USD
                </div>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

/**
 * Key logical để dedupe hoá đơn khi 1 hoá đơn (owner) được copy sang các
 * booking member thành các bản mirror riêng (invoice.id khác nhau).
 *
 *   • Mapper BE gán `sourceBookingId` = id của BOOKING chủ cho cả owner và
 *     mirror. Nên key dùng `sourceBookingId` kết hợp với tên file nguồn
 *     (hoặc id hoá đơn nếu chưa upload file) là ổn định.
 */
function invoiceKey(inv, b) {
  const src = inv.sourceBookingId != null ? inv.sourceBookingId : b.id
  const file = inv.draftOriginal || inv.issuedOriginal || inv.adjustmentOriginal
  return `${src}::${file || `id_${inv.id}`}`
}