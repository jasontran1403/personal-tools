import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ConfirmModal from '../common/ConfirmModal'
import BookingFormModal from './BookingFormModal'
import TicketFaceModal from './TicketFaceModal'
import InvoiceManagerModal from './InvoiceManagerModal'
import PresentationModal from './PresentationModal'
import UploadOptionsModal from './UploadOptionsModal'
import TicketNoteModal from './TicketNoteModal'
import BookingTotalsCard from './BookingTotalsCard'
import PaymentModal from './PaymentModal'
import BatchPaymentModal from './BatchPaymentModal'
import DateRangePicker from '../common/DateRangePicker'
import { listBookings, deleteBooking, totalsBookings } from '../../services/vmbApi'
import { parseAmount, formatMoney, sumAmounts, toVnd } from '../../lib/money'
import { primaryDeparture } from '../../lib/countdown'
import { formatDepart } from '../../lib/airportTz'

/**
 * ── 2026-09-15 ──────────────────────────────────────────────
 * - Click MÃ BOOKING → mở mặt vé chung (shared) hoặc chọn khách (per-ticket).
 * - Click SỐ VÉ → mở mặt vé riêng (per-ticket) hoặc face chung (shared).
 * - Nút action 📄 = "Xem chi tiết mặt vé".
 *
 * ── Cải tiến hiển thị (2026-09-15 chiều) ────────────────────
 * 1. Group tickets THEO CÔNG TY trong 1 booking. Vé cùng công ty đứng liền
 *    nhau; ô công ty MERGE (rowspan) qua các vé cùng công ty.
 *    Ví dụ booking có 4 vé Cty A/B/A/A → sắp lại A-A-A-B, ô Cty A rowspan=3.
 *    Thứ tự công ty giữ theo thứ tự xuất hiện đầu tiên trong booking gốc
 *    (không sort alphabet — để user thấy "cty đầu tiên đặt" ở trên).
 *
 * 2. Cột "Booking / số vé" → chỉ còn "Booking" (mã booking, rowspan cả booking).
 *    Số vé chuyển sang cột "Khách hàng":
 *        Dòng trên: tên khách
 *        Dòng dưới: số vé (font mono, click được để mở face)
 */
export default function TicketsTab() {
  const [rows, setRows]           = useState([])
  const [totals, setTotals]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [totalsLoading, setTotalsLoading] = useState(false)

  const [q, setQ]                 = useState('')
  const [fromSale, setFromSale]   = useState('')
  const [toSale, setToSale]       = useState('')
  const [page, setPage]           = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal]         = useState(0)

  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const [form, setForm]           = useState(null)
  const [face, setFace]           = useState(null)   // { booking, ticketId }
  const [invMgr, setInvMgr]       = useState(null)
  const [payFor, setPayFor]       = useState(null)
  const [batchPay, setBatchPay]   = useState(null)
  const [noteView, setNoteView]   = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  // ── 2026-09-19: Xuất trình + Upload ──
  const [presentation, setPresentation] = useState(null) // booking
  const [uploadFor, setUploadFor]       = useState(null) // booking
  const [exporting, setExporting]       = useState(false)

  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const filterParams = useMemo(() => {
    const p = {}
    if (q)        p.q = q
    if (fromSale) p.fromSale = new Date(fromSale + 'T00:00:00').getTime()
    if (toSale)   p.toSale   = new Date(toSale + 'T23:59:59').getTime()
    return p
  }, [q, fromSale, toSale])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listBookings({ ...filterParams, page, size: 50 })
      const d = res.data?.data
      setRows(d?.content || [])
      setTotalPages(d?.totalPages || 1)
      setTotal(d?.totalElements || 0)
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải được danh sách vé')
    } finally {
      setLoading(false)
    }
  }, [filterParams, page])

  const loadTotals = useCallback(async () => {
    setTotalsLoading(true)
    try {
      const res = await totalsBookings(filterParams)
      setTotals(res.data?.data || [])
    } catch { /* silent */ }
    finally { setTotalsLoading(false) }
  }, [filterParams])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTotals() }, [loadTotals])

  useEffect(() => {
    setSelectedIds(prev => {
      const valid = new Set(rows.map(r => r.id))
      const next = new Set()
      for (const id of prev) if (valid.has(id)) next.add(id)
      return next
    })
  }, [rows])

  const qTimer = useRef(null)
  const onSearch = (v) => {
    if (qTimer.current) clearTimeout(qTimer.current)
    qTimer.current = setTimeout(() => { setPage(0); setQ(v) }, 300)
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAllOnPage = () => {
    setSelectedIds(prev => {
      const allSelected = rows.length > 0 && rows.every(r => prev.has(r.id))
      const next = new Set(prev)
      if (allSelected) rows.forEach(r => next.delete(r.id))
      else            rows.forEach(r => next.add(r.id))
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  const selectedBookings = useMemo(
    () => rows.filter(r => selectedIds.has(r.id)),
    [rows, selectedIds]
  )

  const onBatchPay = () => {
    if (selectedBookings.length < 2) return toast.error('Chọn ít nhất 2 booking để thu batch.')
    setBatchPay(selectedBookings)
  }

  const onSavedRefresh = () => { load(); loadTotals() }

  // ── 2026-09-20: Xuất báo cáo PDF theo filter ──────────────
  const handleExportPdf = async () => {
    setExporting(true)
    const tid = toast.loading('Đang tải dữ liệu và tạo PDF…')
    try {
      const mod = await import('../../lib/bookingsPdfExport')
      await mod.exportBookingsReport(filterParams, {
        onProgress: (loaded, total) => {
          toast.loading(`Đã tải ${loaded}/${total || '?'} booking…`, { id: tid })
        },
      })
      toast.success('Đã tạo PDF', { id: tid })
    } catch (e) {
      console.error('[PDF export]', e)
      toast.error(e?.message || 'Xuất PDF thất bại', { id: tid })
    } finally {
      setExporting(false)
    }
  }

  // ── 2026-09-19: click Mã booking → Xuất trình modal. Upload nằm ở cột thao tác. ──
  const openBookingFace = (b) => setPresentation(b)
  const openTicketFace  = (b, ticketId) => setFace({ booking: b, ticketId })
  const openUpload      = (b) => setUploadFor(b)

  return (
    <div className="w-full">
      <div className="flex flex-col lg:flex-row gap-2 mb-3">
        <input
          defaultValue={q}
          onChange={e => onSearch(e.target.value)}
          placeholder="Tìm theo mã booking, số vé, tên khách, hành trình…"
          className="flex-1 min-w-0 px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-sm
            focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none" />

        <div className="flex gap-2 items-center shrink-0">
          <span className="text-xs text-gray-500 font-semibold hidden lg:inline">Ngày bán:</span>
          <div className="w-72">
            <DateRangePicker
              value={{ from: fromSale, to: toSale }}
              onChange={({ from, to }) => {
                setPage(0)
                setFromSale(from)
                setToSale(to)
              }}
              placeholder="Chọn khoảng ngày bán"
            />
          </div>
        </div>

        <button type="button" onClick={handleExportPdf} disabled={exporting}
          title="Xuất báo cáo PDF (landscape) — theo filter hiện tại; nếu chưa filter thì lấy toàn bộ"
          className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white
            text-sm font-semibold shadow-md shadow-emerald-500/20 shrink-0 disabled:opacity-50">
          {exporting ? '⏳ Đang xuất…' : '📄 Xuất PDF'}
        </button>

        <button type="button" onClick={() => setForm({ mode: 'create' })}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white
            text-sm font-semibold shadow-md shadow-blue-500/20 hover:from-blue-700 hover:to-indigo-700 shrink-0">
          + Thêm booking
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40
                        p-3 rounded-xl bg-amber-50 border border-amber-300 shadow-lg
                        flex items-center gap-3 flex-wrap min-w-[320px]">
          <span className="text-sm font-semibold text-amber-900">
            Đã chọn {selectedIds.size} booking
          </span>
          <div className="flex-1" />
          <button onClick={onBatchPay}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
            💰 Thu tiền hàng loạt
          </button>
          <button onClick={clearSelection}
            className="px-2 py-1.5 rounded-md text-xs text-gray-600 hover:bg-white/60">
            Bỏ chọn
          </button>
        </div>
      )}

      <BookingTotalsCard totals={totals} loading={totalsLoading} />

      {/* Desktop table */}
      <div className="hidden lg:block bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse table-fixed">
            <colgroup>
              <col style={{ width: 32 }} />
              <col style={{ width: 130 }} />  {/* Loại/Hãng */}
              <col style={{ width: 130 }} />  {/* Công ty — tăng từ 80 → 130 */}
              <col style={{ width: 210 }} />  {/* Khách hàng (name + số vé) */}
              <col style={{ width: 100 }} />  {/* Booking */}
              <col style={{ width: 130 }} />  {/* Hành trình */}
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-[10px]">
              <tr>
                <Th center>
                  <input type="checkbox"
                    checked={rows.length > 0 && rows.every(r => selectedIds.has(r.id))}
                    onChange={toggleAllOnPage}
                    className="rounded" />
                </Th>
                <Th>Loại / hãng</Th>
                <Th>Công ty</Th>
                <Th>Khách hàng</Th>
                <Th>Booking</Th>
                <Th>Hành trình / giờ đi</Th>
                <Th>Giá gốc</Th>
                <Th>Giá trên vé / phí</Th>
                <Th>Thành tiền</Th>
                <Th>Phí xuất vé</Th>
                <Th>Giá bán</Th>
                <Th>Tổng booking</Th>
                <Th>Quy đổi VND</Th>
                <Th center>Thanh toán</Th>
                <ThR>Thao tác</ThR>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} className="text-center py-10 text-gray-400">Đang tải…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={15} className="text-center py-14 text-gray-400">
                  {q || fromSale || toSale ? 'Không tìm thấy vé phù hợp' : 'Chưa có booking nào. Bấm "Thêm booking" để tạo.'}
                </td></tr>
              ) : (
                rows.map((b, bIdx) => renderBookingRows(b, bIdx, {
                  page, nowTick,
                  isSelected: selectedIds.has(b.id),
                  onToggleSelect: toggleSelect,
                  onOpenBookingFace: openBookingFace,
                  onOpenTicketFace: openTicketFace,
                  onPresent: setPresentation,
                  onUpload: openUpload,
                  onInvoice: (bookingId) => setInvMgr(bookingId),
                  onNote: setNoteView,
                  onPay: setPayFor,
                  onEdit: () => setForm({ mode: 'edit', bookingId: b.id }),
                  onDelete: () => setConfirmDel(b),
                }))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-2">
        {loading ? (
          <div className="text-center py-10 text-gray-400 text-sm">Đang tải…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-14 text-gray-400 text-sm">
            {q || fromSale || toSale ? 'Không tìm thấy vé phù hợp' : 'Chưa có booking nào.'}
          </div>
        ) : (
          rows.map(b => (
            <MobileBookingCard key={b.id} booking={b} nowTick={nowTick}
              isSelected={selectedIds.has(b.id)}
              onToggleSelect={toggleSelect}
              onOpenBookingFace={openBookingFace}
              onOpenTicketFace={openTicketFace}
              onPresent={setPresentation}
              onUpload={openUpload}
              onInvoice={(id) => setInvMgr(id)}
              onNote={setNoteView}
              onPay={setPayFor}
              onEdit={() => setForm({ mode: 'edit', bookingId: b.id })}
              onDelete={() => setConfirmDel(b)} />
          ))
        )}
        <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
      </div>

      {/* Modals */}
      {form && (
        <BookingFormModal
          mode={form.mode} bookingId={form.bookingId}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); onSavedRefresh() }}
        />
      )}
      {face && (
        <TicketFaceModal
          booking={{
            ...face.booking,
            _onPickTicket: (tid) => setFace({ booking: face.booking, ticketId: tid })
          }}
          ticketId={face.ticketId}
          onClose={() => setFace(null)}
          onDirty={onSavedRefresh}
        />
      )}
      {invMgr && (
        <InvoiceManagerModal bookingId={invMgr} onClose={() => setInvMgr(null)} onDirty={load} />
      )}
      {presentation && (
        <PresentationModal open={true} booking={presentation} onClose={() => setPresentation(null)} />
      )}
      {uploadFor && (
        <UploadOptionsModal
          open={true}
          booking={uploadFor}
          onClose={() => setUploadFor(null)}
          onChanged={async () => {
            // Sau upload, reload booking để lấy state mới nhất (dùng cho grouping/hiện file
            // trong modal con nếu vẫn mở).
            try {
              const res = await import('../../services/vmbApi').then(m => m.getBooking(uploadFor.id))
              const b = res.data?.data
              if (b) setUploadFor(b)
              onSavedRefresh()
            } catch { /* silent */ }
          }}
        />
      )}
      {payFor && (
        <PaymentModal booking={payFor}
          onClose={() => setPayFor(null)}
          onSaved={() => { setPayFor(null); onSavedRefresh() }} />
      )}
      {batchPay && (
        <BatchPaymentModal bookings={batchPay}
          onClose={() => setBatchPay(null)}
          onSaved={() => { setBatchPay(null); clearSelection(); onSavedRefresh() }} />
      )}
      {noteView && (
        <TicketNoteModal passengerName={noteView.passengerName} note={noteView.note}
          onClose={() => setNoteView(null)} />
      )}
      {confirmDel && (
        <ConfirmModal
          open title="Xóa booking"
          message={`Xóa booking "${confirmDel.bookingCode || '(chưa có mã)'}" cùng ${confirmDel.tickets?.length || 0} vé, tất cả mặt vé và hóa đơn đính kèm?`}
          confirmLabel="Xóa" danger
          onConfirm={async () => {
            try {
              await deleteBooking(confirmDel.id)
              toast.success('Đã xóa'); setConfirmDel(null); onSavedRefresh()
            } catch (e) {
              toast.error(e?.response?.data?.message || 'Xóa thất bại')
            }
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  HEADER CELLS
// ═══════════════════════════════════════════════════════════════

function Th({ children, center }) {
  return (
    <th className={`px-2 py-2 font-semibold align-middle ${center ? 'text-center' : 'text-left'}`}>
      {children}
    </th>
  )
}
function ThR({ children }) {
  return (
    <th className="px-2 py-2 font-semibold text-right align-middle">
      {children}
    </th>
  )
}

// ═══════════════════════════════════════════════════════════════
//  GROUP TICKETS THEO CÔNG TY
// ═══════════════════════════════════════════════════════════════

/**
 * Sắp xếp lại tickets: gom các vé cùng công ty lại với nhau. Thứ tự công ty
 * giữ theo thứ tự xuất hiện đầu tiên trong booking gốc (stable — không sort
 * alphabet, để user vẫn thấy công ty họ nhập đầu tiên ở trên đầu).
 *
 * Ví dụ input:  [Cty A khách1, Cty B khách2, Cty A khách3, Cty A khách4]
 * Output tickets: [khách1, khách3, khách4, khách2]
 * Output groups: [{key:A, size:3, tickets:[k1,k3,k4]}, {key:B, size:1, tickets:[k2]}]
 *
 * Key dùng cho công ty = companyId (null nếu khách lẻ) → 2 vé cùng "khách lẻ"
 * (null companyId) cũng merge.
 */
function groupTicketsByCompany(tickets) {
  const buckets = new Map()   // key → { key, keyLabel, tickets: [] }
  for (const t of tickets || []) {
    const key = t.companyId == null ? 'none' : `c${t.companyId}`
    if (!buckets.has(key)) buckets.set(key, { key, tickets: [] })
    buckets.get(key).tickets.push(t)
  }
  const groups = []
  const sortedTickets = []
  for (const b of buckets.values()) {
    groups.push({ key: b.key, size: b.tickets.length, firstIdxInSorted: sortedTickets.length })
    for (const t of b.tickets) sortedTickets.push(t)
  }
  return { sortedTickets, groups }
}

// ═══════════════════════════════════════════════════════════════
//  RENDER — DESKTOP TABLE
// ═══════════════════════════════════════════════════════════════

function renderBookingRows(b, bIdx, {
  page, nowTick, isSelected, onToggleSelect,
  onOpenBookingFace, onOpenTicketFace, onPresent, onUpload, onInvoice, onNote, onPay, onEdit, onDelete,
}) {
  const bookingTotal = sumAmounts(...(b.tickets || []).map(t =>
    sumAmounts(t.basePrice, t.collectionFee, sumTicketFees(t.fees), t.issuanceFee)))
  const totalVnd = toVnd(bookingTotal, b.currency, b.exchangeRate)
  const N = b.tickets?.length || 1
  const primary = primaryDeparture(b.segments, nowTick)
  const badgeCls =
      primary?.band === 'warn' ? 'bg-amber-500 text-white'
    : primary?.band === 'future' ? 'bg-blue-600 text-white'
    : ''

  // Sắp xếp tickets theo company (giữ order xuất hiện đầu tiên)
  const { sortedTickets, groups } = groupTicketsByCompany(b.tickets || [])
  // Map: sortedIdx → group info (chỉ render company cell ở dòng đầu của group)
  const groupStartAt = new Map()
  for (const g of groups) groupStartAt.set(g.firstIdxInSorted, g)

  return sortedTickets.map((t, tIdx) => {
    // ── 2026-09-20: tint bg theo currency để tách biệt VND/USD ──
    // - VND: nền trắng (mặc định).
    // - USD: xanh nhạt (sky) để nhìn phát biết ngay đây là booking USD.
    // - Selected: vàng nhạt (ưu tiên).
    const rowBg = isSelected
      ? 'bg-amber-50/60'
      : (b.currency === 'USD' ? 'bg-sky-50/50' : 'bg-white')
    const firstRow = tIdx === 0
    const lastRow  = tIdx === N - 1
    const cardBorder = `${firstRow ? 'border-t-2 border-t-gray-100' : ''} ${lastRow ? 'border-b-4 border-b-gray-100' : ''}`
    const withCollection = sumAmounts(t.basePrice, t.collectionFee)
    const feesTotal      = sumTicketFees(t.fees)
    const subTotal       = sumAmounts(withCollection, feesTotal)
    const sellPrice      = sumAmounts(subTotal, t.issuanceFee)
    const hasFace = faceStatus(b, t.id)
    const groupInfo = groupStartAt.get(tIdx)

    return (
      <tr key={t.id}
          className={`${rowBg} ${cardBorder} hover:bg-blue-50/40 transition-colors align-middle`}>
        {firstRow && (
          <td className="px-2 py-2 text-center align-middle" rowSpan={N}>
            <input type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(b.id)}
              className="rounded cursor-pointer" />
          </td>
        )}

        {firstRow && (
          <td className="px-2 py-2 align-middle relative" rowSpan={N}>
            {primary && badgeCls && (
              <span className={`inline-block mb-1 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${badgeCls}`}
                title={`Còn ${primary.text} đến chuyến bay`}>
                ⏱ {primary.text}
              </span>
            )}
            <div className="text-xs font-semibold text-gray-900 leading-tight">
              {kindLabel(b.kind)} · <span className="text-gray-600">{b.airlineCode || '—'}</span>
            </div>
            <div className="text-[10px] text-gray-500 tabular-nums mt-0.5">
              {formatDateTimeShort(b.saleDate)}
            </div>
          </td>
        )}

        {/* Công ty — chỉ render ở dòng đầu group, rowspan = group size */}
        {groupInfo && (
          <td className="px-2 py-2 align-middle truncate border-l border-gray-100"
              rowSpan={groupInfo.size}>
            <CompanyLabel short={t.companyShortName} full={t.companyName} />
          </td>
        )}

        {/* Khách hàng — 2 dòng: tên + số vé */}
        <td className="px-2 py-2 align-middle">
          <div className="font-medium text-gray-900 truncate leading-tight">
            {t.passengerName || '—'}
          </div>
          {/* ── 2026-09-20: click-to-copy số vé, không format ── */}
          <button type="button"
            onClick={() => {
              if (!t.ticketNumber) return
              navigator.clipboard.writeText(t.ticketNumber)
                .then(() => toast.success(`Đã copy: ${t.ticketNumber}`))
                .catch(() => toast.error('Không copy được'))
            }}
            disabled={!t.ticketNumber}
            title={t.ticketNumber
              ? (hasFace ? 'Vé đã có mặt vé — click để copy số vé' : 'Click để copy số vé')
              : 'Vé chưa có số'}
            className="font-mono text-[10px] text-gray-500 truncate leading-tight mt-0.5 block text-left w-full hover:text-blue-700 hover:underline cursor-copy disabled:cursor-default disabled:hover:no-underline">
            {t.ticketNumber || ''}
            {hasFace && t.ticketNumber && <span className="ml-1 text-emerald-600">📎</span>}
          </button>
        </td>

        {/* Booking — click để copy mã booking (không mở modal xuất trình nữa) */}
        {firstRow && (
          <td className="px-2 py-2 align-middle" rowSpan={N}>
            <button type="button"
              onClick={() => {
                if (!b.bookingCode) return
                navigator.clipboard.writeText(b.bookingCode)
                  .then(() => toast.success(`Đã copy: ${b.bookingCode}`))
                  .catch(() => toast.error('Không copy được'))
              }}
              disabled={!b.bookingCode}
              title={b.bookingCode ? 'Click để copy mã booking' : 'Chưa có mã'}
              className="block w-full text-left font-mono text-[11px] font-bold text-gray-900 hover:text-blue-700 hover:underline truncate cursor-copy disabled:cursor-default">
              {b.bookingCode || '—'}
              {b.sharedTicketFace && b.bookingFace && <span className="ml-1 text-emerald-600">📎</span>}
            </button>
          </td>
        )}

        {firstRow && (
          <td className="px-2 py-2 align-middle" rowSpan={N}>
            {(b.segments || []).length === 0 ? <span className="text-gray-400">—</span> : (() => {
              const concat = routeConcat(b.segments)
              const copyRoute = () => {
                if (!concat) return
                navigator.clipboard.writeText(concat)
                  .then(() => toast.success(`Đã copy: ${concat}`))
                  .catch(() => toast.error('Không copy được'))
              }
              return (
                <button type="button" onClick={copyRoute}
                  title={`Click để copy: ${concat}`}
                  className="block w-full text-left cursor-copy hover:bg-blue-50 rounded px-1 -mx-1">
                  {(b.segments || []).map((s, i) => (
                    <div key={i} className={`${i > 0 ? 'mt-1.5 pt-1.5 border-t border-dashed border-gray-200' : ''}`}>
                      <div className="text-xs font-bold text-gray-900 leading-tight">
                        {s.fromCode} <span className="text-gray-400">→</span> {s.toCode}
                      </div>
                      <div className="text-[11px] tabular-nums text-gray-500 leading-tight">
                        {formatDepart(s.departLocalMs, s.fromCode) || '—'}
                      </div>
                    </div>
                  ))}
                </button>
              )
            })()}
          </td>
        )}

        <TdMoneyPair value1={t.basePrice} value2={t.collectionFee} currency={b.currency} exchangeRate={b.exchangeRate} bold1 />
        <TdInvoiceAndFees withCollection={withCollection} fees={t.fees} currency={b.currency} exchangeRate={b.exchangeRate} />
        <TdMoney value={subTotal} currency={b.currency} exchangeRate={b.exchangeRate} bold />
        <TdMoney value={t.issuanceFee} currency={b.currency} exchangeRate={b.exchangeRate} muted />
        <TdMoney value={sellPrice} currency={b.currency} exchangeRate={b.exchangeRate} bold />

        {firstRow && (
          <td className="px-2 py-2 text-right align-middle border-l border-r border-gray-200"
              rowSpan={N}>
            <div className="font-mono tabular-nums text-sm font-bold text-blue-700">
              {formatMoney(bookingTotal, b.currency)}
            </div>
          </td>
        )}

        {firstRow && (
          <td className="px-2 py-2 text-right align-middle" rowSpan={N}>
            {b.currency === 'VND' ? (
              <span className="text-gray-400 text-[11px]">—</span>
            ) : (
              <>
                <div className="font-mono tabular-nums text-sm font-bold text-gray-900">
                  {formatMoney(totalVnd, 'VND')}
                </div>
                <div className="text-[10px] text-gray-500 tabular-nums">
                  1 USD = {b.exchangeRate ? formatMoney(b.exchangeRate, 'VND', { withUnit: false }) : '—'}
                </div>
              </>
            )}
          </td>
        )}

        {firstRow && (
          <td className="px-2 py-2 text-center align-middle" rowSpan={N}>
            <PaymentCell booking={b} bookingTotal={bookingTotal} onPay={onPay} />
          </td>
        )}

        {/* Thao tác — 2026-09-19: rút gọn còn 5 nút. Note ở mỗi ticket, các nút khác ở firstRow. */}
        {/* 2026-09-20: canh phải theo yêu cầu — icons dồn về bên phải */}
        <td className="px-2 py-2 align-middle">
          <div className="flex flex-wrap items-center justify-end gap-1">
            {t.note && (
              <button type="button"
                onClick={() => onNote({ passengerName: t.passengerName || '(vé)', note: t.note })}
                title={'Ghi chú: ' + (t.note.length > 60 ? t.note.slice(0, 60) + '…' : t.note)}
                className="w-7 h-7 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 inline-flex items-center justify-center">
                📝
              </button>
            )}
            {firstRow && (
              <>
                <button type="button" onClick={() => onPresent(b)}
                  title="Xuất trình (Thông tin booking / Mặt vé / Hóa đơn)"
                  className="w-7 h-7 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center">
                  📤
                </button>
                <button type="button" onClick={() => onUpload(b)}
                  title="Upload (Thông tin booking / Mặt vé / Hóa đơn)"
                  className="w-7 h-7 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  📥
                </button>
                <button type="button" onClick={onEdit}
                  title="Sửa booking"
                  className="w-7 h-7 rounded-md text-gray-600 hover:bg-gray-200 flex items-center justify-center">✎</button>
                <button type="button" onClick={onDelete}
                  title="Xóa booking"
                  className="w-7 h-7 rounded-md text-gray-600 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center">🗑</button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  })
}

// ── Sub-components ─────────────────────────────────────

function CompanyLabel({ short, full }) {
  if (!full && !short) {
    return <span className="text-[10px] text-gray-400 italic">Khách lẻ</span>
  }
  const label = short || autoShort(full)
  return (
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800"
      title={full}>
      {label}
    </span>
  )
}

function autoShort(name) {
  if (!name) return '—'
  const parts = name.split(/\s+/).filter(x => x && !/^(và|-|của)$/i.test(x))
  if (parts.length === 1) return parts[0].slice(0, 6).toUpperCase()
  return parts.slice(0, 3).map(p => p[0]?.toUpperCase() || '').join('')
}

function PaymentCell({ booking, bookingTotal, onPay }) {
  const st = booking.paymentStatus || 'UNPAID'
  const paid = parseAmount(booking.paidAmount) || 0
  const remain = Math.max(0, bookingTotal - paid)

  const badge =
      st === 'PAID'    ? { cls: 'bg-green-100 text-green-700', label: 'Đã thu' }
    : st === 'PARTIAL' ? { cls: 'bg-amber-100 text-amber-700', label: 'Thu 1 phần' }
    :                    { cls: 'bg-rose-100 text-rose-700',   label: 'Chưa thu' }

  return (
    <button type="button" onClick={() => onPay(booking)}
      className={`px-2 py-1 rounded-md ${badge.cls} hover:brightness-95 transition text-left w-full`}>
      <div className="text-[10px] font-bold">{badge.label}</div>
      {st !== 'UNPAID' && (
        <div className="text-[10px] font-mono tabular-nums mt-0.5 opacity-80">
          {formatMoney(remain, booking.currency, { withUnit: false })}
        </div>
      )}
    </button>
  )
}

/**
 * ── 2026-09-20: click-to-copy ─────────────────────────────────
 * Cell tiền là 1 button. Click → copy vào clipboard số nguyên (không format,
 * không unit). Nếu currency=USD → nhân với exchangeRate của booking để ra
 * VND rồi copy (đơn vị: đồng, làm tròn).
 *
 * Trường hợp cần chỉ copy raw (không đổi sang VND), truyền {@code rawCopy}.
 */
async function copyMoneyAsClipboard(numericValue, currency, exchangeRate, rawCopy) {
  if (!Number.isFinite(numericValue)) return
  let vnd = numericValue
  if (!rawCopy && currency === 'USD') {
    const rate = parseAmount(exchangeRate)
    if (Number.isFinite(rate) && rate > 0) {
      vnd = numericValue * rate
    }
  }
  const intVnd = Math.round(vnd)
  const text = String(intVnd)
  try {
    await navigator.clipboard.writeText(text)
    // Hiển thị theo format có dấu chấm cho user dễ đọc trong toast
    toast.success(`Đã copy: ${intVnd.toLocaleString('vi-VN')}`)
  } catch (e) {
    toast.error('Không copy được vào clipboard')
  }
}

function TdMoney({ value, currency, exchangeRate, bold, muted }) {
  const n = typeof value === 'number' ? value : parseAmount(value)
  const cls =
      !Number.isFinite(n) ? 'text-gray-300'
    : muted ? 'text-gray-500'
    : bold  ? 'text-gray-900 font-semibold'
    : 'text-gray-700'
  const isClickable = Number.isFinite(n) && n !== 0
  return (
    <td className="px-2 py-2 text-left font-mono tabular-nums align-middle">
      <button type="button"
        onClick={isClickable ? () => copyMoneyAsClipboard(n, currency, exchangeRate) : undefined}
        disabled={!isClickable}
        title={isClickable ? (currency === 'USD' ? 'Click để copy (quy đổi VND)' : 'Click để copy') : undefined}
        className={`${cls} text-left ${isClickable ? 'hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 cursor-copy' : ''}`}>
        {formatMoney(n, currency, { withUnit: false })}
      </button>
    </td>
  )
}

function TdMoneyPair({ value1, value2, currency, exchangeRate, bold1 }) {
  const n1 = typeof value1 === 'number' ? value1 : parseAmount(value1)
  const n2 = typeof value2 === 'number' ? value2 : parseAmount(value2)
  const cls1 =
      !Number.isFinite(n1) ? 'text-gray-300'
    : bold1 ? 'text-gray-900 font-semibold'
    : 'text-gray-700'
  const clickable1 = Number.isFinite(n1) && n1 !== 0
  const clickable2 = Number.isFinite(n2) && n2 !== 0
  return (
    <td className="px-2 py-2 text-left font-mono tabular-nums align-middle">
      <button type="button"
        onClick={clickable1 ? () => copyMoneyAsClipboard(n1, currency, exchangeRate) : undefined}
        disabled={!clickable1}
        title={clickable1 ? (currency === 'USD' ? 'Click để copy (quy đổi VND)' : 'Click để copy') : undefined}
        className={`${cls1} text-left block ${clickable1 ? 'hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 cursor-copy' : ''}`}>
        {formatMoney(n1, currency, { withUnit: false })}
      </button>
      <button type="button"
        onClick={clickable2 ? () => copyMoneyAsClipboard(n2, currency, exchangeRate) : undefined}
        disabled={!clickable2}
        title={clickable2 ? (currency === 'USD' ? 'Click để copy (quy đổi VND)' : 'Click để copy') : undefined}
        className={`text-[10px] text-gray-400 text-left block ${clickable2 ? 'hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 cursor-copy' : ''}`}>
        {Number.isFinite(n2) && n2 !== 0 ? formatMoney(n2, currency, { withUnit: false }) : '—'}
      </button>
    </td>
  )
}

/**
 * Cột "Giá trên vé / phí" — hiển thị withCollection ở trên, list phí phát sinh
 * bên dưới. Mỗi phí = label bên trái + số tiền bên phải (canh phải).
 * Click số tiền → copy (quy đổi VND nếu USD).
 *
 * ── 2026-09-20 rework ────────────────────────────────
 * Trước dùng TdMoneyPair value2={feesTotal} → chỉ hiển thị TỔNG phí ở dòng
 * phụ nhỏ xíu, user không biết vé đã có phí gì. Nay list chi tiết mỗi loại
 * phí trên 1 dòng, canh phải giá tiền để cột nhìn gọn.
 */
/**
 * "Phí trợ giúp đặc biệt" → "Phí Trợ Giúp Đặc Biệt".
 * Viết hoa chữ cái đầu MỖI từ. Unicode-aware (nhận đúng chữ tiếng Việt có
 * dấu như "đ", "ơ", "ư", các nguyên âm có dấu…).
 *
 * Không dùng String.prototype.toUpperCase() cho toàn bộ vì user chỉ muốn hoa
 * chữ đầu, giữ các chữ sau nguyên vẹn.
 */
function titleCaseVi(str) {
  if (!str) return ''
  return String(str)
    .split(/(\s+)/)                    // tách nhưng giữ khoảng trắng
    .map(part => {
      if (/^\s+$/.test(part)) return part
      // Lấy ký tự đầu (Unicode-aware qua Array.from để không tách bậy chữ có dấu)
      const chars = Array.from(part)
      if (chars.length === 0) return part
      chars[0] = chars[0].toLocaleUpperCase('vi-VN')
      return chars.join('')
    })
    .join('')
}

function TdInvoiceAndFees({ withCollection, fees, currency, exchangeRate }) {
  const n1 = typeof withCollection === 'number' ? withCollection : parseAmount(withCollection)
  const clickable1 = Number.isFinite(n1) && n1 !== 0
  const feesList = Array.isArray(fees) ? fees : []
  return (
    <td className="px-2 py-2 text-left font-mono tabular-nums align-middle">
      <button type="button"
        onClick={clickable1 ? () => copyMoneyAsClipboard(n1, currency, exchangeRate) : undefined}
        disabled={!clickable1}
        title={clickable1 ? (currency === 'USD' ? 'Click để copy (quy đổi VND)' : 'Click để copy') : undefined}
        className={`text-gray-900 font-semibold text-left block ${clickable1 ? 'hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 cursor-copy' : ''}`}>
        {formatMoney(n1, currency, { withUnit: false })}
      </button>
      {feesList.length === 0 ? (
        <div className="text-[10px] text-gray-400">—</div>
      ) : (
        <div className="mt-0.5 space-y-0.5">
          {feesList.map((f, i) => {
            const amt = parseAmount(f.amount)
            const canCopy = Number.isFinite(amt) && amt !== 0
            const label = f.feeTypeLabel || f.feeType
            const labelTitleCase = titleCaseVi(label)
            const copyLabel = () => {
              navigator.clipboard.writeText(labelTitleCase)
                .then(() => toast.success(`Đã copy: ${labelTitleCase}`))
                .catch(() => toast.error('Không copy được'))
            }
            return (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <button type="button"
                  onClick={copyLabel}
                  title={`Click để copy: "${labelTitleCase}"`}
                  className="text-gray-600 truncate text-left hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 cursor-copy">
                  {label}
                </button>
                <button type="button"
                  onClick={canCopy ? () => copyMoneyAsClipboard(amt, currency, exchangeRate) : undefined}
                  disabled={!canCopy}
                  title={canCopy ? (currency === 'USD' ? 'Click để copy (quy đổi VND)' : 'Click để copy') : undefined}
                  className={`font-mono tabular-nums text-gray-700 text-left ${canCopy ? 'hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 cursor-copy' : ''}`}>
                  {formatMoney(amt, currency, { withUnit: false })}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </td>
  )
}

// ═══════════════════════════════════════════════════════════════
//  RENDER — MOBILE CARD
// ═══════════════════════════════════════════════════════════════

function MobileBookingCard({ booking: b, nowTick, isSelected, onToggleSelect,
                             onOpenBookingFace, onOpenTicketFace,
                             onPresent, onUpload,
                             onInvoice, onNote, onPay, onEdit, onDelete }) {
  const bookingTotal = sumAmounts(...(b.tickets || []).map(t =>
    sumAmounts(t.basePrice, t.collectionFee, sumTicketFees(t.fees), t.issuanceFee)))
  const primary = primaryDeparture(b.segments, nowTick)
  const badgeCls =
      primary?.band === 'warn' ? 'bg-amber-500 text-white'
    : primary?.band === 'future' ? 'bg-blue-600 text-white'
    : ''
  const st = b.paymentStatus || 'UNPAID'
  const stCls =
      st === 'PAID'    ? 'bg-green-100 text-green-700'
    : st === 'PARTIAL' ? 'bg-amber-100 text-amber-700'
    :                    'bg-rose-100 text-rose-700'
  const stLabel =
      st === 'PAID'    ? 'Đã thu'
    : st === 'PARTIAL' ? 'Thu 1 phần'
    :                    'Chưa thu'

  // Mobile cũng group theo company cho nhất quán
  const { sortedTickets } = groupTicketsByCompany(b.tickets || [])

  return (
    <div className={`rounded-xl border shadow-sm p-3 relative ${
      isSelected
        ? 'bg-amber-50 border-amber-300'
        : (b.currency === 'USD' ? 'bg-sky-50/60 border-sky-200' : 'bg-white border-gray-200')
    }`}>
      <div className="flex items-start gap-2 mb-2">
        <input type="checkbox" checked={isSelected}
          onChange={() => onToggleSelect(b.id)}
          className="mt-1.5 rounded cursor-pointer" />
        <div className="flex-1">
          {primary && badgeCls && (
            <span className={`inline-block px-2 py-0.5 mb-1 rounded-md font-mono text-[10px] font-bold ${badgeCls}`}>
              ⏱ {primary.text}
            </span>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">
              {kindLabel(b.kind)} · {b.airlineCode || '?'}
            </span>
            <button type="button"
              onClick={() => {
                if (!b.bookingCode) return
                navigator.clipboard.writeText(b.bookingCode)
                  .then(() => toast.success(`Đã copy: ${b.bookingCode}`))
                  .catch(() => toast.error('Không copy được'))
              }}
              disabled={!b.bookingCode}
              title="Click để copy mã booking"
              className="font-mono text-xs font-bold text-gray-900 hover:text-blue-700 hover:underline cursor-copy disabled:cursor-default">
              {b.bookingCode || '—'}
              {b.sharedTicketFace && b.bookingFace && <span className="ml-1 text-emerald-600">📎</span>}
            </button>
          </div>
        </div>
        <button onClick={onEdit} className="text-gray-500 hover:text-gray-800 w-7 h-7 rounded-md hover:bg-gray-100">✎</button>
        <button onClick={onDelete} className="text-gray-500 hover:text-rose-600 w-7 h-7 rounded-md hover:bg-rose-50">🗑</button>
      </div>

      <div className="text-[10px] text-gray-400 tabular-nums mb-2">
        Bán: {formatDateTimeShort(b.saleDate)}
      </div>

      <div className="text-[11px] text-gray-700 mb-2 space-y-0.5">
        {(b.segments || []).map((s, i) => (
          <div key={i} className="px-1.5 py-0.5">
            <span className="font-bold">{s.fromCode} → {s.toCode}</span>
            <span className="text-gray-500 mx-1">·</span>
            <span className="tabular-nums">{formatDepart(s.departLocalMs, s.fromCode)}</span>
          </div>
        ))}
      </div>

      <div className="divide-y divide-gray-100 -mx-3">
        {sortedTickets.map(t => {
          const hasFace = faceStatus(b, t.id)
          return (
            <div key={t.id} className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <CompanyLabel short={t.companyShortName} full={t.companyName} />
                    <span className="text-sm font-semibold text-gray-900 truncate">{t.passengerName || '—'}</span>
                  </div>
                  <div className="font-mono text-[10px] text-gray-500 truncate"
                    title={hasFace ? 'Vé này đã có mặt vé' : 'Vé chưa có mặt vé'}>
                    {t.ticketNumber || 'chưa có số vé'}
                    {hasFace && <span className="ml-1 text-emerald-600">📎</span>}
                  </div>
                </div>
                <div className="font-mono tabular-nums text-sm font-bold text-gray-900">
                  {formatMoney(sumAmounts(t.basePrice, t.collectionFee, sumTicketFees(t.fees), t.issuanceFee), b.currency)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {t.note && (
                  <button type="button"
                    onClick={() => onNote({ passengerName: t.passengerName || '(vé)', note: t.note })}
                    className="h-7 w-7 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-700 flex items-center justify-center">
                    📝
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <button type="button" onClick={() => onPay(b)}
          className={`px-2 py-1 rounded-md ${stCls} text-[11px] font-bold`}>
          {stLabel}
        </button>
        <button type="button" onClick={() => onPresent(b)}
          className="text-[11px] px-2 py-1 rounded-md bg-blue-100 text-blue-700 font-semibold">
          📤 Xuất trình
        </button>
        <button type="button" onClick={() => onUpload(b)}
          className="text-[11px] px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 font-semibold">
          📥 Upload
        </button>
        <div className="flex-1" />
        <span className="font-mono tabular-nums font-bold text-blue-700 text-sm">
          {formatMoney(bookingTotal, b.currency)}
        </span>
      </div>
    </div>
  )
}

function Pagination({ page, totalPages, total, onPage }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs">
      <span className="text-gray-500">{total} vé · trang {page + 1}/{totalPages}</span>
      <div className="flex gap-1">
        <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}
          className="px-2.5 py-1 rounded-md bg-white border border-gray-200 disabled:opacity-40 hover:bg-gray-100">←</button>
        <button onClick={() => onPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
          className="px-2.5 py-1 rounded-md bg-white border border-gray-200 disabled:opacity-40 hover:bg-gray-100">→</button>
      </div>
    </div>
  )
}

// ── Utility ─────────────────────────────────────────────

function faceStatus(b, ticketId) {
  if (b.sharedTicketFace) return !!b.bookingFace
  const t = (b.tickets || []).find(x => x.id === ticketId)
  return !!t?.ticketFace
}

function kindLabel(k) {
  return { NEW: 'Mua mới', EXCHANGE: 'Đổi', REFUND: 'Hoàn', SERVICE: 'Dịch vụ' }[k] || k
}

/**
 * Tính tổng số tiền của list TicketFee của 1 vé.
 * Thay cho cột serviceFee cũ đã bỏ. Dùng parseAmount để tôn trọng format
 * user gõ (money.js xử lý dấu . và ,).
 */
function sumTicketFees(fees) {
  if (!fees || fees.length === 0) return 0
  return sumAmounts(...fees.map(f => f.amount || 0))
}

function formatDateTimeShort(ms) {
  if (!ms) return '—'
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(ms))
    const p = (t) => parts.find(x => x.type === t)?.value || ''
    return `${p('hour')}:${p('minute')} ${p('day')}/${p('month')}/${p('year')}`
  } catch { return '' }
}

/**
 * Ghép các mã sân bay trong segments thành 1 chuỗi liền, bỏ trùng lặp liền kề.
 * Dùng cho click-to-copy ô Hành trình.
 * VD: [{HAN,NRT}, {NRT,HAN}] → "HANNRTHAN"
 *     [{HAN,NRT}, {HKG,HAN}] → "HANNRTHKGHAN"  (route gãy — vẫn concat đủ mã)
 */
function routeConcat(segments) {
  if (!segments || segments.length === 0) return ''
  const codes = []
  for (const s of segments) {
    if (codes[codes.length - 1] !== s.fromCode) codes.push(s.fromCode)
    if (codes[codes.length - 1] !== s.toCode) codes.push(s.toCode)
  }
  return codes.join('')
}