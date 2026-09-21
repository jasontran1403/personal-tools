import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import RouteInput from './RouteInput'
import PriceInput from './PriceInput'
import { getBooking, createBooking, updateBooking, listCompanies, listFeeTypes } from '../../services/vmbApi'
import { parseAmount, formatMoney } from '../../lib/money'
import TicketFeesEditor from './TicketFeesEditor'

/**
 * Form thêm/sửa BOOKING (kèm segments + N tickets).
 *
 * ── 2026-09-15 refactor ────────────────────────────────────
 * - Thêm cờ {@code sharedTicketFace}.
 * - Bỏ quản lý file mặt vé trong form này — chuyển sang {@code TicketFaceModal}.
 *
 * ── 2026-09-15 chiều ────────────────────────────────────────
 * - Cty là {@code CompanySearchSelect} (searchable dropdown thay vì {@code <select>}).
 * - Nút "+ Thêm vé" sao chép các field DÙNG CHUNG từ vé TRƯỚC ĐÓ.
 *
 * ── 2026-09-19 refactor ────────────────────────────────────
 * - BỎ trường serviceFee đơn. Thay bằng list {@code fees} chi tiết với 10
 *   loại phí. UI dùng {@link TicketFeesEditor}.
 * - "+ Thêm vé" KHÔNG copy fees (mỗi khách có phí phát sinh khác nhau).
 *
 * ── 2026-09-21 gross-tracking cho Giá gốc + Phí thu hộ ────
 * User workflow:
 *   1. Paste "tổng tiền vé từ vendor" (VD 4.124.362) vào Giá gốc.
 *   2. Paste liên tục các phí thu hộ (sumOnPaste) → cộng dồn.
 *   3. Giá gốc TỰ ĐỘNG = tổng - phí thu hộ, giữ invariant
 *      "gross = basePrice + collectionFee" constant.
 *   4. Xóa phí → giá gốc quay về gross ban đầu.
 *
 * Cách track: ticket có field ẨN {@code _originalTotal} (Number) = gross.
 * - {@link setBasePrice}: user commit basePrice → cập nhật _originalTotal =
 *   basePrice + collectionFee hiện tại (baseline mới).
 * - {@link setCollectionFee}: user commit collectionFee → nếu _originalTotal
 *   đã set → basePrice = _originalTotal - collectionFee mới.
 *
 * _originalTotal KHÔNG bao giờ được gửi lên BE (bị strip trong submit).
 */
export default function BookingFormModal({ mode = 'create', bookingId, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const [loading, setLoading] = useState(isEdit)
  const [busy, setBusy] = useState(false)
  const [companies, setCompanies] = useState([])
  const [feeTypes, setFeeTypes] = useState([])

  useEffect(() => {
    listCompanies()
      .then(res => setCompanies(res.data?.data || []))
      .catch(() => { })
    listFeeTypes()
      .then(res => setFeeTypes(res.data?.data || []))
      .catch(() => { })
  }, [])

  const [form, setForm] = useState(() => ({
    kind: 'NEW',
    airlineCode: '',
    bookingCode: '',
    routeStr: '',
    currency: 'VND',
    exchangeRate: '',
    note: '',
    sharedTicketFace: false,
    segments: [],
    tickets: [newTicket()],
  }))

  useEffect(() => {
    if (!isEdit) return
    ;(async () => {
      try {
        const res = await getBooking(bookingId)
        const b = res.data?.data
        if (!b) throw new Error('Không tìm thấy')
        setForm({
          kind: b.kind || 'NEW',
          airlineCode: b.airlineCode || '',
          bookingCode: b.bookingCode || '',
          routeStr: b.routeStr || '',
          currency: b.currency || 'VND',
          exchangeRate: b.exchangeRate || '',
          note: b.note || '',
          sharedTicketFace: !!b.sharedTicketFace,
          segments: (b.segments || []).map(s => ({
            fromCode: s.fromCode, toCode: s.toCode,
            departLocalMs: s.departLocalMs, segOrder: s.segOrder,
          })),
          tickets: (b.tickets || []).map(t => ({
            id: t.id,
            passengerName: t.passengerName || '',
            companyId: t.companyId || null,
            ticketNumber: t.ticketNumber || '',
            basePrice: t.basePrice || '',
            collectionFee: t.collectionFee || '',
            issuanceFee: t.issuanceFee || '',
            paidStatus: t.paidStatus || 'PENDING',
            note: t.note || '',
            fees: (t.fees || []).map(f => ({
              id: f.id,
              feeType: f.feeType,
              feeTypeLabel: f.feeTypeLabel,
              amount: f.amount || '',
              note: f.note || '',
              orderIdx: f.orderIdx ?? 0,
            })),
            // Load lên với _originalTotal = null → chưa track. User paste
            // basePrice mới thì mới bắt đầu track (baseline mới).
            _originalTotal: null,
          })),
        })
      } catch (e) {
        toast.error(e?.response?.data?.message || 'Không tải được booking')
        onClose()
      } finally {
        setLoading(false)
      }
    })()
  }, [isEdit, bookingId, onClose])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setTicket = (i, patch) => setForm(f => ({
    ...f, tickets: f.tickets.map((t, idx) => idx === i ? { ...t, ...patch } : t),
  }))

  /**
   * Set basePrice + đồng thời reset gross baseline.
   * Sau mỗi lần user commit basePrice (paste hoặc blur):
   *   _originalTotal = basePrice + collectionFee (current)
   * → gross invariant reset về mốc mới. Fee thay đổi tiếp theo sẽ shift base.
   */
  const setBasePrice = (i, val) => setForm(f => ({
    ...f,
    tickets: f.tickets.map((t, idx) => {
      if (idx !== i) return t
      const newBaseNum = parseAmount(val)
      const currFeeNum = parseAmount(t.collectionFee)
      const gross = (Number.isFinite(newBaseNum) ? newBaseNum : 0)
                  + (Number.isFinite(currFeeNum) ? currFeeNum : 0)
      return { ...t, basePrice: val, _originalTotal: gross }
    }),
  }))

  /**
   * Set collectionFee + đồng thời recompute basePrice từ gross.
   *   Nếu _originalTotal chưa set → chỉ set collectionFee bình thường.
   *   Nếu set rồi → basePrice = _originalTotal - collectionFee (clamp ≥ 0).
   */
  const setCollectionFee = (i, val) => setForm(f => ({
    ...f,
    tickets: f.tickets.map((t, idx) => {
      if (idx !== i) return t
      const patched = { ...t, collectionFee: val }
      if (t._originalTotal != null) {
        const newFeeNum = parseAmount(val)
        const newBase = Math.max(0, t._originalTotal - (Number.isFinite(newFeeNum) ? newFeeNum : 0))
        patched.basePrice = formatMoney(newBase, f.currency, { withUnit: false })
      }
      return patched
    }),
  }))

  const MAX_TICKETS = 9

  const addTicket = () => setForm(f => {
    if (f.tickets.length >= MAX_TICKETS) {
      toast.error(`Mỗi booking tối đa ${MAX_TICKETS} vé`)
      return f
    }
    const first = f.tickets[0] || newTicket()
    return {
      ...f,
      tickets: [{
        ...newTicket(),
        companyId: first.companyId ?? null,
        basePrice: first.basePrice || '',
        collectionFee: first.collectionFee || '',
        issuanceFee: first.issuanceFee || '',
        // Copy gross tracking từ vé đầu tiên — vé mới cũng ăn theo cùng gross.
        // Nếu user muốn khác, họ tự paste giá gốc mới → baseline reset.
        _originalTotal: first._originalTotal ?? null,
      }, ...f.tickets],
    }
  })

  const removeTicket = (i) => setForm(f => ({
    ...f,
    tickets: f.tickets.length <= 1 ? f.tickets : f.tickets.filter((_, idx) => idx !== i),
  }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.tickets[0]?.passengerName?.trim()) {
      return toast.error('Vé đầu tiên cần có tên khách hàng')
    }
    if (form.currency === 'USD' && !form.exchangeRate) {
      return toast.error('Vé USD cần nhập tỷ giá')
    }
    if (form.tickets.length > 9) {
      return toast.error('Mỗi booking tối đa 9 vé')
    }

    setBusy(true)
    try {
      // ── Strip _originalTotal (chỉ dùng ở client) trước khi gửi BE ──
      const body = {
        ...form,
        segments: (form.segments || []).map((s, i) => ({ ...s, segOrder: i })),
        tickets: form.tickets.map(t => {
          const { _originalTotal, ...cleanT } = t
          return cleanT
        }),
      }
      if (isEdit) {
        await updateBooking(bookingId, body)
        toast.success('Đã cập nhật')
      } else {
        await createBooking(body)
        toast.success('Đã tạo booking')
      }
      onSaved()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Lưu thất bại')
    } finally {
      setBusy(false)
    }
  }

  const flatCompanies = useMemo(() => companyOptions(companies), [companies])

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={isEdit ? 'Sửa booking' : 'Thêm booking mới'}
      size="xl"
      closeOnBackdrop={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
          <button type="submit" form="bf-form" disabled={busy || loading}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
                       hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : (isEdit ? 'Lưu thay đổi' : 'Tạo booking')}
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="py-10 text-center text-gray-400 text-sm">Đang tải…</div>
      ) : (
        <form id="bf-form" onSubmit={submit} className="space-y-4">
          <Section title="Thông tin chung">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Loại giao dịch" span={2}>
                <select value={form.kind} onChange={e => setField('kind', e.target.value)}
                  className="input">
                  <option value="NEW">Mua mới</option>
                  <option value="EXCHANGE">Đổi vé</option>
                  <option value="REFUND">Hoàn vé</option>
                  <option value="SERVICE">Dịch vụ</option>
                </select>
              </Field>
              <Field label="Hãng bay">
                <input type="text" value={form.airlineCode}
                  onChange={e => setField('airlineCode', e.target.value.toUpperCase().slice(0, 3))}
                  placeholder="VJ, VN…" className="input font-mono uppercase" />
              </Field>
              <Field label="Mã booking">
                <input type="text" value={form.bookingCode}
                  onChange={e => setField('bookingCode', e.target.value.toUpperCase())}
                  placeholder="ABC123" className="input font-mono uppercase" />
              </Field>
            </div>

            <div className="mt-3">
              <RouteInput
                routeStr={form.routeStr}
                segments={form.segments}
                onChange={({ routeStr, segments }) => setForm(f => ({ ...f, routeStr, segments }))}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <Field label="Đồng tiền">
                <select value={form.currency}
                  onChange={e => setField('currency', e.target.value)}
                  className="input">
                  <option value="VND">VND</option>
                  <option value="USD">USD</option>
                </select>
              </Field>
              {form.currency === 'USD' && (
                <Field label="Tỷ giá (1 USD = ? VND)" span={3}>
                  <input type="text" value={form.exchangeRate}
                    onChange={e => setField('exchangeRate', e.target.value)}
                    placeholder="24500" className="input tabular-nums font-mono" />
                </Field>
              )}
            </div>

            <div className="mt-3 p-3 rounded-xl bg-amber-50/50 border border-amber-200">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form.sharedTicketFace}
                  onChange={e => setField('sharedTicketFace', e.target.checked)}
                  className="mt-1 rounded" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">
                    Mặt vé CHUNG cho cả booking
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    {form.sharedTicketFace
                      ? '✓ Cả booking dùng chung 1 file mặt vé (VD Vietjet, VNA nội địa).'
                      : 'Mỗi hành khách trong booking có mặt vé riêng (VD VNA quốc tế). Đây là mặc định.'}
                  </div>
                  {isEdit && (
                    <div className="text-[10px] text-amber-700 mt-1">
                      ⚠ Đổi cờ này khi sửa sẽ XÓA các file mặt vé thuộc scope cũ.
                      Upload lại sau khi lưu.
                    </div>
                  )}
                </div>
              </label>
            </div>

            <Field label="Ghi chú chung (booking)">
              <textarea rows={2} value={form.note}
                onChange={e => setField('note', e.target.value)}
                className="input resize-none" placeholder="Ghi chú tùy chọn cho cả booking" />
            </Field>
          </Section>

          <Section title={`Vé (${form.tickets.length})`}
            action={<button type="button" onClick={addTicket}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800">
              + Thêm vé (copy từ vé cuối)
            </button>}
          >
            <div className="text-[11px] text-gray-500 mb-2">
              💡 Sau khi lưu, click mã booking / số vé ở bảng để tải mặt vé lên.
              Vé thêm mới tự copy công ty + các giá / phí từ vé cuối để nhập nhanh.
            </div>
            <div className="text-[11px] text-blue-700 mb-2 bg-blue-50 border border-blue-200 rounded-md p-2">
              💰 <b>Mẹo nhập nhanh</b>: paste tổng tiền vé vào <b>Giá gốc</b> trước, sau đó paste
              các phí thu hộ (chuỗi kiểu <code>"79000AX"</code>, <code>"36362C4"</code>…) → hệ
              thống tự cộng dồn Phí thu hộ và giảm Giá gốc tương ứng. Xóa phí → Giá gốc quay lại.
            </div>
            <div className="space-y-3">
              {form.tickets.map((t, i) => {
                return (
                  <div key={i} className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-bold text-gray-700">Vé #{i + 1}</div>
                      {form.tickets.length > 1 && (
                        <button type="button" onClick={() => removeTicket(i)}
                          className="text-xs text-rose-600 hover:text-rose-800 font-semibold">
                          × Bỏ vé này
                        </button>
                      )}
                    </div>

                    <Field label="Công ty">
                      <CompanySearchSelect
                        value={t.companyId}
                        options={flatCompanies}
                        onChange={(id) => setTicket(i, { companyId: id })}
                        placeholder="— Khách lẻ —"
                      />
                    </Field>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                      <Field label="Tên khách hàng">
                        <input type="text" value={t.passengerName}
                          onChange={e => setTicket(i, { passengerName: e.target.value })}
                          className="input" placeholder="NGUYEN VAN A" />
                      </Field>
                      <Field label="Số vé">
                        <input type="text" value={t.ticketNumber}
                          onChange={e => {
                            const raw = e.target.value || ''
                            const normalized = raw.replace(/[\s-]/g, '')
                            setTicket(i, { ticketNumber: normalized })
                          }}
                          className="input font-mono" placeholder="738-1234567890 (có thể để trống)" />
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                      <Field label="Giá gốc (chưa thu hộ)">
                        <PriceInput value={t.basePrice} currency={form.currency}
                          onChange={v => setBasePrice(i, v)} />
                      </Field>
                      <Field label="Phí thu hộ">
                        <PriceInput value={t.collectionFee} currency={form.currency}
                          onChange={v => setCollectionFee(i, v)}
                          sumOnPaste />
                      </Field>
                      <Field label="Phí xuất vé">
                        <PriceInput value={t.issuanceFee} currency={form.currency}
                          onChange={v => setTicket(i, { issuanceFee: v })} />
                      </Field>
                    </div>

                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-gray-600 mb-1">Các loại phí phát sinh</div>
                      <TicketFeesEditor
                        value={t.fees || []}
                        onChange={fees => setTicket(i, { fees })}
                        currency={form.currency}
                        feeTypes={feeTypes}
                      />
                    </div>

                    <Field label="Ghi chú vé">
                      <input type="text" value={t.note}
                        onChange={e => setTicket(i, { note: e.target.value })}
                        className="input" placeholder="Ghi chú tùy chọn" />
                    </Field>
                  </div>
                )
              })}
            </div>
          </Section>

          <style>{`
            .input {
              width: 100%;
              padding: 0.5rem 0.75rem;
              border-radius: 0.5rem;
              border: 1px solid #d1d5db;
              background: #fff;
              font-size: 0.875rem;
              outline: none;
              transition: border-color .15s, box-shadow .15s;
            }
            .input:focus {
              border-color: #3b82f6;
              box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
            }
          `}</style>
        </form>
      )}
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════
//  CompanySearchSelect — combobox typeahead cho công ty
// ═══════════════════════════════════════════════════════════════

function CompanySearchSelect({ value, options, onChange, placeholder = '— Khách lẻ —' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [query, options])

  useEffect(() => { setActiveIdx(0) }, [open, query])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  const selected = useMemo(
    () => options.find(o => o.id === value) || null,
    [options, value]
  )

  const pick = (opt) => {
    onChange(opt ? opt.id : null)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(filtered.length, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIdx === 0) pick(null)
      else pick(filtered[activeIdx - 1])
    }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQuery('') }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button type="button"
        onClick={() => setOpen(o => !o)}
        className="input flex items-center justify-between text-left w-full"
        aria-haspopup="listbox" aria-expanded={open}>
        <span className={`truncate ${selected ? 'text-gray-900' : 'text-gray-400 italic'}`}>
          {selected ? selected.label.replace(/^\s+↳\s/, '↳ ') : placeholder}
        </span>
        <span className="text-gray-400 text-xs ml-2 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg bg-white shadow-lg border border-gray-200 overflow-hidden">
          <div className="p-1.5 border-b border-gray-100 bg-gray-50">
            <input ref={inputRef}
              type="text" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Tìm công ty…"
              className="w-full px-2 py-1.5 rounded-md border border-gray-200 bg-white text-sm
                focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none" />
          </div>

          <div ref={listRef} className="max-h-56 overflow-y-auto py-0.5">
            <OptionRow
              idx={0} activeIdx={activeIdx} setActiveIdx={setActiveIdx}
              onPick={() => pick(null)}
              isSelected={value == null}
              label="— Khách lẻ —" italic
            />

            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 italic text-center">
                Không tìm thấy công ty phù hợp
              </div>
            ) : filtered.map((o, i) => (
              <OptionRow
                key={o.id}
                idx={i + 1} activeIdx={activeIdx} setActiveIdx={setActiveIdx}
                onPick={() => pick(o)}
                isSelected={o.id === value}
                label={o.label}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OptionRow({ idx, activeIdx, setActiveIdx, onPick, isSelected, label, italic }) {
  const isActive = idx === activeIdx
  return (
    <button type="button"
      data-idx={idx}
      onMouseEnter={() => setActiveIdx(idx)}
      onClick={onPick}
      className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition
        ${isActive ? 'bg-blue-50 text-blue-900' : 'text-gray-800 hover:bg-gray-50'}
        ${italic ? 'italic text-gray-500' : ''}`}>
      <span className="flex-1 truncate whitespace-pre">{label}</span>
      {isSelected && <span className="text-blue-600 text-xs">✓</span>}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function newTicket() {
  return {
    passengerName: '', companyId: null, ticketNumber: '',
    basePrice: '', collectionFee: '', issuanceFee: '',
    paidStatus: 'PENDING', note: '',
    fees: [],
    // Client-only: theo dõi "tổng tiền gốc từ vendor" để đồng bộ basePrice
    // với collectionFee. Bị strip trong submit.
    _originalTotal: null,
  }
}

function Section({ title, action, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function Field({ label, span, children }) {
  const spanClass = span === 2 ? 'sm:col-span-2' : span === 3 ? 'sm:col-span-3' : span === 4 ? 'sm:col-span-4' : ''
  return (
    <label className={`block ${spanClass}`}>
      <div className="text-[11px] font-semibold text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  )
}

function companyOptions(companies) {
  const roots = companies.filter(c => !c.parentId).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const byParent = new Map()
  for (const c of companies) {
    if (c.parentId) {
      if (!byParent.has(c.parentId)) byParent.set(c.parentId, [])
      byParent.get(c.parentId).push(c)
    }
  }
  const out = []
  for (const r of roots) {
    out.push({ id: r.id, label: r.name, isBranch: false })
    const branches = (byParent.get(r.id) || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    for (const b of branches) {
      out.push({ id: b.id, label: `  ↳ ${b.name}`, isBranch: true })
    }
  }
  return out
}