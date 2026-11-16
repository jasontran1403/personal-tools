import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../common/Modal'
import ConfirmModal from '../common/ConfirmModal'
import VmbFilePreviewModal from './VmbFilePreviewModal'
import { createInvoice, deleteInvoice } from '../../services/vmbApi'

/**
 * Upload hóa đơn — flow đơn giản, chỉ 2 loại: DRAFT hoặc ISSUED.
 *
 * ── 2026-09-20 rework — nhóm khách thông minh ─────────────────
 *
 * **Panel "Hóa đơn đã có"** (top): chỉ liệt kê các invoice cùng loại
 * với {@code kind} đang chọn (DRAFT hoặc ISSUED/ADJUSTED), kèm nút 🗑 xóa
 * từng hóa đơn và nút "Xóa tất cả" ở header.
 *
 * **Panel "Áp cho khách hàng"**: xử lý theo {@code kind}:
 *
 *   DRAFT mode:
 *     - Khách nào đã có nháp → HIỂN THỊ nhóm gộp theo hóa đơn nháp đó,
 *       DISABLED (tick sẽ báo "đã có").
 *     - Khách chưa có nháp → mỗi khách 1 checkbox riêng.
 *
 *   ISSUED mode:
 *     - Khách nào đã có ISSUED/ADJUSTED → disabled, gộp theo invoice đó.
 *     - Khách chưa có ISSUED nhưng CÓ DRAFT chung → gộp theo draft (1 checkbox
 *       cho cả nhóm — pax chung nháp buộc phải cùng issued).
 *     - Khách chưa có nháp lẫn issued → mỗi khách 1 checkbox riêng.
 *
 * Selection state = Set<groupId> thay vì Set<ticketId> để ràng buộc "tick 1
 * nhóm = tick cả nhóm". Khi submit, flatten thành mảng ticketIds.
 *
 * Với ISSUED, bản nháp trùng vé được BACKEND gộp vào hóa đơn mới (chuyển
 * phiếu thu rồi xóa bản nháp) ngay trong createInvoice — xem
 * BookingService.absorbOverlappingDrafts. FE không tự xóa nữa.
 */
export default function InvoiceUploadModal({ open, booking, onClose, onChanged }) {
  const [kind, setKind] = useState('DRAFT')
  const [selectedGroupIds, setSelectedGroupIds] = useState(() => new Set())
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  // 2026-10-10: Số hóa đơn (bắt buộc khi upload ISSUED)
  const [invoiceNumbers, setInvoiceNumbers] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')
  // 2026-10-09: preview inline bằng ZoomablePreview thay vì mở tab mới
  const [previewFile, setPreviewFile] = useState(null)   // { url, name }
  // 2026-11-12: Hộp xác nhận xóa (thay confirm() trình duyệt).
  //   { title, message, confirmLabel, run: async () => {} }
  const [confirmAction, setConfirmAction] = useState(null)
  const fileRef = useRef(null)

  // Đổi kind → reset selection (semantic khác nhau giữa 2 mode)
  const changeKind = (k) => {
    setKind(k)
    setSelectedGroupIds(new Set())
    setErr('')
  }

  // ─ Hóa đơn của KIND hiện tại (để hiện panel + tính grouping) ────────
  const currentKindInvoices = useMemo(() => {
    const all = booking?.invoices || []
    if (kind === 'DRAFT') return all.filter(i => i.status === 'DRAFT')
    return all.filter(i => i.status === 'ISSUED' || i.status === 'ADJUSTED')
  }, [booking, kind])

  const draftInvoices = useMemo(
    () => (booking?.invoices || []).filter(i => i.status === 'DRAFT'),
    [booking]
  )

  const selectionModel = useMemo(
    () => computeSelectionModel(booking, kind, currentKindInvoices, draftInvoices),
    [booking, kind, currentKindInvoices, draftInvoices]
  )

  // ── 2026-11-12: Booking chủ → mặc định CHỌN TẤT CẢ vé có thể chọn ──
  //   Chủ thường xuất 1 hóa đơn cho cả nhóm (vé của mình + vé member link về),
  //   nên pre-check sẵn cho đỡ thao tác. Đổi loại hóa đơn (DRAFT/ISSUED) sẽ
  //   tính lại nhóm nên cũng chọn lại tất cả. Booking thường vẫn để user tự tick.
  useEffect(() => {
    if (!open || !booking) return
    if (booking.isInvoiceGroupOwner) {
      setSelectedGroupIds(new Set(selectionModel.selectableGroups.map(g => g.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id, kind, selectionModel])

  if (!open || !booking) return null

  const toggleGroup = (gid) => {
    setSelectedGroupIds(prev => {
      const next = new Set(prev)
      next.has(gid) ? next.delete(gid) : next.add(gid)
      return next
    })
  }

  const flatSelectedTicketIds = useMemo(() => {
    const out = []
    for (const g of selectionModel.selectableGroups) {
      if (selectedGroupIds.has(g.id)) out.push(...g.members.map(m => m.id))
    }
    return out
  }, [selectionModel, selectedGroupIds])

  // ── 2026-10-13 FIX ──────────────────────────────────────────
  // BE trả ApiResponse { success, code, message, data }. Lỗi 400/500 có
  // code >= 400 chứ KHÔNG có field `error`. Check cũ `res.data?.error` luôn
  // falsy → user tưởng xóa thành công nhưng BE báo lỗi và không xóa.
  // Giờ check đúng: code >= 400 hoặc success === false → throw.
  const unwrapOrThrow = (res, fallback) => {
    const d = res?.data
    if (!d) throw new Error(fallback)
    if (d.success === false || (typeof d.code === 'number' && d.code >= 400)) {
      throw new Error(d.message || fallback)
    }
    return d
  }

  // ── Xóa 1 hóa đơn (mở popup xác nhận) ──────────────────────────────
  const removeInvoice = (invId) => {
    setConfirmAction({
      title: 'Xóa hóa đơn này?',
      message: 'Hành động này không thể hoàn tác. Nếu đây là hóa đơn ở booking chủ, các vé link đến nó cũng sẽ mất hóa đơn tương ứng.',
      confirmLabel: 'Xóa',
      run: async () => {
        setBusy(true); setErr('')
        try {
          const res = await deleteInvoice(invId)
          unwrapOrThrow(res, 'Xóa thất bại')
          if (onChanged) await onChanged()
        } catch (e) {
          console.error('[InvoiceUpload.deleteInvoice]', e)
          setErr(e?.response?.data?.message || e.message || 'Xóa thất bại')
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const removeAllOfKind = () => {
    // 2026-11-12: Chỉ xóa hóa đơn của CHÍNH booking này — hóa đơn ké từ booking
    //   chủ (sourceBookingId khác) do chủ quản lý, không xóa ở đây. Nếu đây LÀ
    //   booking chủ, xóa hóa đơn nhóm sẽ tự gỡ cho mọi vé link đến (BE cascade).
    const deletable = currentKindInvoices.filter(
      inv => !(inv.sourceBookingId && booking?.id && inv.sourceBookingId !== booking.id)
    )
    if (deletable.length === 0) return
    const label = kind === 'DRAFT' ? 'nháp' : 'đã phát hành'
    setConfirmAction({
      title: `Xóa toàn bộ ${deletable.length} hóa đơn ${label}?`,
      message: `Chỉ xóa ${deletable.length} hóa đơn ${label} thuộc về booking này (hóa đơn ké từ booking chủ không bị xóa ở đây). Hành động không thể hoàn tác.`,
      confirmLabel: 'Xóa tất cả',
      run: async () => {
        setBusy(true); setErr('')
        let failCount = 0
        try {
          for (const inv of deletable) {
            try {
              const res = await deleteInvoice(inv.id)
              unwrapOrThrow(res, 'Xóa thất bại')
            } catch (e) {
              console.error('[InvoiceUpload.deleteAll] inv', inv.id, e)
              failCount++
            }
          }
          if (failCount > 0) setErr(`Xóa thất bại ${failCount}/${deletable.length} hóa đơn. Mở DevTools xem chi tiết.`)
          if (onChanged) await onChanged()
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const submit = async () => {
    setErr('')
    if (flatSelectedTicketIds.length === 0) { setErr('Chọn ít nhất 1 khách hàng.'); return }
    if (!file)                              { setErr('Chưa chọn file.'); return }
    if (kind === 'ISSUED' && !invoiceNumbers.trim()) {
      setErr('Hóa đơn đã phát hành bắt buộc nhập số hóa đơn.')
      return
    }
    setBusy(true)
    try {
      const payload = { status: kind, note, ticketIds: flatSelectedTicketIds }
      if (invoiceNumbers.trim()) payload.invoiceNumbers = invoiceNumbers.trim()
      if (kind === 'DRAFT')  payload.draftFile  = file
      if (kind === 'ISSUED') payload.issuedFile = file

      const res = await createInvoice(booking.id, payload)
      if (res.data?.error) throw new Error(res.data.message || 'Tạo hóa đơn thất bại')

      // ── 2026-11-11: BE tự gộp bản nháp trùng vé ────────────────────────
      //   Trước đây FE tự gọi deleteInvoice cho từng bản nháp overlap, nhưng
      //   bản nháp nào đã có phiếu thu thì DB chặn (khóa ngoại), lỗi lại bị
      //   nuốt bằng console.warn → booking còn 2 hóa đơn cho cùng tập vé,
      //   tổng phải thu nhân đôi và không bao giờ đủ tiền.
      //   Nay createInvoice ở BE chuyển phiếu thu sang hóa đơn mới rồi xóa
      //   bản nháp trong cùng một transaction, nên FE không xóa tay nữa.

      if (onChanged) onChanged()
      onClose()
    } catch (e) {
      setErr(e.message || 'Tạo hóa đơn thất bại')
    } finally {
      setBusy(false)
    }
  }

  const currentKindLabelShort = kind === 'DRAFT' ? 'Nháp' : 'Đã phát hành'

  return (
    <Modal open onClose={onClose}
      title={`Upload hóa đơn — ${booking.bookingCode || '(chưa có mã)'}`}
      size="lg">
      {err && (
        <div className="mb-3 p-2 rounded-md bg-rose-50 text-rose-700 text-xs border border-rose-200">
          {err}
        </div>
      )}

      {/* ─ Chọn loại hóa đơn ──────────────────────────────────────── */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold text-gray-600 mb-1">Loại hóa đơn</div>
        <div className="grid grid-cols-2 gap-2">
          <label className={`p-2.5 rounded-lg border-2 cursor-pointer text-xs transition ${
            kind === 'DRAFT' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white hover:bg-gray-50'
          }`}>
            <input type="radio" name="invkind" checked={kind === 'DRAFT'}
              onChange={() => changeKind('DRAFT')} className="mr-1.5" />
            <b>📝 Nháp</b>
            <div className="text-[10px] text-gray-500 mt-0.5">Chưa phát hành chính thức</div>
          </label>
          <label className={`p-2.5 rounded-lg border-2 cursor-pointer text-xs transition ${
            kind === 'ISSUED' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'
          }`}>
            <input type="radio" name="invkind" checked={kind === 'ISSUED'}
              onChange={() => changeKind('ISSUED')} className="mr-1.5" />
            <b>🧾 Đã phát hành</b>
            <div className="text-[10px] text-gray-500 mt-0.5">Cuối cùng — sẽ xóa các nháp overlap</div>
          </label>
        </div>
      </div>

      {/* ─ Panel hóa đơn đã có (theo kind hiện tại) ────────────────── */}
      <ExistingInvoicesPanel
        invoices={currentKindInvoices}
        kindLabel={currentKindLabelShort}
        booking={booking}
        busy={busy}
        onDelete={removeInvoice}
        onDeleteAll={removeAllOfKind}
        onPreview={setPreviewFile}
      />

      {/* ─ Áp cho khách hàng ──────────────────────────────────────── */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-semibold text-gray-600">
            Áp cho khách hàng ({flatSelectedTicketIds.length}/{selectionModel.totalApplicable || 0})
          </div>
          {kind === 'ISSUED' && draftInvoices.some(d => (d.ticketIds || []).length > 1) && (
            <div className="text-[10px] text-purple-700 font-semibold">
              Khách chung nháp → chung phát hành
            </div>
          )}
        </div>
        <div className="p-2 rounded-lg border border-gray-200 bg-gray-50 max-h-72 overflow-y-auto space-y-1">
          {selectionModel.claimedGroups.length === 0 && selectionModel.selectableGroups.length === 0 && (
            <div className="text-[11px] text-gray-400 italic px-2 py-1">Booking chưa có vé nào.</div>
          )}

          {/* Nhóm đã có + đã link (disabled) */}
          {selectionModel.claimedGroups.map(g => (
            <ClaimedRow key={g.id} group={g} />
          ))}

          {/* Nhóm có thể chọn */}
          {selectionModel.selectableGroups.length > 1 && (
            <label className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-white cursor-pointer font-semibold border-b border-gray-200 mb-1 mt-1">
              <input type="checkbox"
                checked={selectionModel.selectableGroups.every(g => selectedGroupIds.has(g.id)) && selectionModel.selectableGroups.length > 0}
                onChange={() => {
                  if (selectionModel.selectableGroups.every(g => selectedGroupIds.has(g.id))) {
                    setSelectedGroupIds(new Set())
                  } else {
                    setSelectedGroupIds(new Set(selectionModel.selectableGroups.map(g => g.id)))
                  }
                }} />
              <span>Chọn tất cả</span>
            </label>
          )}
          {selectionModel.selectableGroups.map(g => (
            <SelectableRow key={g.id} group={g}
              checked={selectedGroupIds.has(g.id)}
              onToggle={() => toggleGroup(g.id)} />
          ))}
        </div>
      </div>

      {/* ─ File input ─────────────────────────────────────────────── */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold text-gray-600 mb-1">File hóa đơn</div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={e => setFile(e.target.files?.[0] || null)} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className="w-full px-3 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
          {file ? `📎 ${file.name}` : '+ Chọn file'}
        </button>
      </div>

      {/* ─ Số hóa đơn (bắt buộc khi ISSUED) ────────────────────────── */}
      {kind === 'ISSUED' && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-gray-600 mb-1">
            Số hóa đơn <span className="text-rose-600">*</span>
            <span className="text-[10px] text-gray-400 font-normal ml-1">
              (nhiều số phân cách bằng dấu phẩy, VD: 142, 143, 144)
            </span>
          </div>
          <input type="text" value={invoiceNumbers}
            onChange={e => setInvoiceNumbers(e.target.value)}
            placeholder="VD: 142 hoặc 142, 143, 144"
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 bg-white text-sm outline-none focus:border-blue-500" />
        </div>
      )}

      {/* ─ Note ───────────────────────────────────────────────────── */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold text-gray-600 mb-1">Ghi chú (tùy chọn)</div>
        <input type="text" value={note} onChange={e => setNote(e.target.value)}
          placeholder="VD: Xuất theo yêu cầu khách"
          className="w-full px-2 py-1.5 rounded-md border border-gray-300 bg-white text-sm outline-none focus:border-blue-500" />
      </div>

      {/* ─ Warning cho ISSUED — nháp overlap sẽ bị xóa ────────────── */}
      {kind === 'ISSUED' && draftInvoices.length > 0 && flatSelectedTicketIds.length > 0 && (
        <IssuedWarning drafts={draftInvoices} selectedTicketIds={flatSelectedTicketIds} booking={booking} />
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy}
          className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm font-semibold disabled:opacity-40">
          Hủy
        </button>
        <button onClick={submit} disabled={busy || flatSelectedTicketIds.length === 0 || !file}
          className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-40">
          {busy ? 'Đang tải…' : '📥 Upload'}
        </button>
      </div>

      <VmbFilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        filePath={previewFile?.url}
        fileName={previewFile?.name}
        title={previewFile?.name}
      />

      {/* 2026-11-12: Popup xác nhận xóa (thay confirm() trình duyệt) */}
      <ConfirmModal
        open={!!confirmAction}
        title={confirmAction?.title}
        message={confirmAction?.message}
        confirmLabel={confirmAction?.confirmLabel || 'Xóa'}
        danger
        busy={busy}
        onConfirm={async () => {
          const act = confirmAction
          setConfirmAction(null)
          if (act?.run) await act.run()
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════
//  SELECTION MODEL
// ══════════════════════════════════════════════════════════════
//
// group.id       : string duy nhất trong 1 model
// group.members  : [{ id, name, ticketNumber, bookingCode, foreign }] — đã
//                  resolve tên, dùng được cho cả vé ngoài booking.
// group.disabled : true → panel "đã có / đã link", không tick được
// group.linked   : true → vé của booking này đã link sang chủ khác (khóa)
// group.foreign  : true → hóa đơn/vé thuộc booking chủ (ké về)
// group.reason   : nhãn hiển thị (Đã có nháp / Gộp theo nháp / Đã link → … / …)

/**
 * ── 2026-11-12: Bảng tra cứu thông tin vé ─────────────────────────────
 * Gom vé từ 3 nguồn để resolve được tên cho cả vé NGOÀI booking:
 *   1. booking.tickets          — vé của chính booking.
 *   2. booking.linkedForeignTickets — vé của member đã link về (khi b là chủ).
 *   3. invoice.ticketPreviews   — fallback cho mọi vé đã nằm trên hóa đơn.
 *
 * Mỗi record: { id, name, ticketNumber, bookingCode, foreign, linkedOut,
 *               linkedBookingCode }
 *   foreign   = vé thuộc booking khác (member link về chủ đang xem).
 *   linkedOut = vé của chính booking NHƯNG đã link sang chủ khác → không
 *               được tự upload ở đây (phải upload ở chủ).
 */
function buildTicketInfoMap(booking) {
  const map = new Map()
  const bid = booking?.id
  for (const t of (booking?.tickets || [])) {
    map.set(t.id, {
      id: t.id,
      name: t.passengerName || `#${t.id}`,
      ticketNumber: t.ticketNumber || '',
      bookingCode: booking?.bookingCode || '',
      foreign: false,
      linkedOut: !!(t.linkedBookingId && t.linkedBookingId !== bid),
      linkedBookingCode: t.linkedBookingCode || null,
    })
  }
  for (const ft of (booking?.linkedForeignTickets || [])) {
    if (map.has(ft.id)) continue
    map.set(ft.id, {
      id: ft.id,
      name: ft.passengerName || `#${ft.id}`,
      ticketNumber: ft.ticketNumber || '',
      bookingCode: ft.bookingCode || '',
      foreign: true,
      linkedOut: false,
      linkedBookingCode: null,
    })
  }
  for (const inv of (booking?.invoices || [])) {
    for (const p of (inv.ticketPreviews || [])) {
      if (map.has(p.id)) continue
      map.set(p.id, {
        id: p.id,
        name: p.passengerName || `#${p.id}`,
        ticketNumber: p.ticketNumber || '',
        bookingCode: p.bookingCode || '',
        foreign: !!(p.bookingId && bid && p.bookingId !== bid),
        linkedOut: false,
        linkedBookingCode: null,
      })
    }
  }
  return map
}

function membersOf(ids, infoMap) {
  return ids.map(id => infoMap.get(id) || {
    id, name: `#${id}`, ticketNumber: '', bookingCode: '', foreign: false,
  })
}

/**
 * ── 2026-11-12 rework — cross-booking cấp vé ──────────────────────────
 *
 * Mỗi group giờ mang {@code members} (đã resolve tên) thay vì chỉ ticketIds,
 * để render được vé ngoài booking.
 *
 * Phân loại vé:
 *   · claimedGroups  — vé đã nằm trên hóa đơn cùng kind (của mình HOẶC ké từ
 *                       booking chủ). disabled.
 *   · linkedGroups   — vé của booking này đã LINK sang chủ khác → chủ xuất hóa
 *                       đơn, ở đây KHÓA chọn (không chủ động up). disabled.
 *   · selectableGroups — vé chưa group: vé của mình chưa link + (nếu b là chủ)
 *                       vé member link về. Chọn để upload nháp/phát hành (tách
 *                       hóa đơn). DRAFT mỗi vé 1 ô; ISSUED gộp theo nháp.
 */
function computeSelectionModel(booking, kind, currentKindInvoices, draftInvoices) {
  const infoMap = buildTicketInfoMap(booking)
  const bid = booking?.id
  const isOwner = !!booking?.isInvoiceGroupOwner
  const allTickets = booking?.tickets || []
  const foreignTickets = isOwner ? (booking?.linkedForeignTickets || []) : []

  const claimedPaxIds = new Set()
  const claimedGroups = []

  // 1) Đã có hóa đơn cùng kind (của mình HOẶC ở booking chủ ké về)
  for (const inv of currentKindInvoices) {
    const ids = inv.ticketIds || []
    const foreignInv = !!(inv.sourceBookingId && bid && inv.sourceBookingId !== bid)
    if (ids.length === 0) {
      // Chung cả booking (chỉ xảy ra với hóa đơn của chính booking này)
      const allIds = allTickets.map(t => t.id)
      allIds.forEach(id => claimedPaxIds.add(id))
      claimedGroups.push({
        id: `claimed-all-${inv.id}`,
        members: membersOf(allIds, infoMap),
        disabled: true,
        reason: kind === 'DRAFT' ? 'Đã có nháp (chung)' : 'Đã có phát hành (chung)',
      })
    } else {
      ids.forEach(id => claimedPaxIds.add(id))
      claimedGroups.push({
        id: `claimed-${inv.id}`,
        members: membersOf(ids, infoMap),
        disabled: true,
        foreign: foreignInv,
        reason: foreignInv
          ? (kind === 'DRAFT' ? `Nháp ở chủ ${inv.sourceBookingCode || ''}` : `Đã phát hành ở chủ ${inv.sourceBookingCode || ''}`)
          : (kind === 'DRAFT' ? 'Đã có nháp' : 'Đã có phát hành'),
      })
    }
  }

  // 2) Vé của booking này đã LINK sang chủ khác → khóa, phải up ở chủ.
  const linkedGroups = []
  for (const t of allTickets) {
    const info = infoMap.get(t.id)
    if (info?.linkedOut && !claimedPaxIds.has(t.id)) {
      claimedPaxIds.add(t.id)
      linkedGroups.push({
        id: `linked-${t.id}`,
        members: membersOf([t.id], infoMap),
        disabled: true,
        linked: true,
        reason: `Đã link → ${info.linkedBookingCode || 'chủ'}`,
      })
    }
  }

  // 3) Vé có thể chọn: vé của mình chưa claimed & chưa link + (nếu là chủ) vé
  //    member link về chưa claimed.
  const selectableIds = []
  for (const t of allTickets) {
    const info = infoMap.get(t.id)
    if (claimedPaxIds.has(t.id)) continue
    if (info?.linkedOut) continue
    selectableIds.push(t.id)
  }
  for (const ft of foreignTickets) {
    if (claimedPaxIds.has(ft.id)) continue
    selectableIds.push(ft.id)
  }

  let selectableGroups = []
  if (kind === 'DRAFT') {
    selectableGroups = selectableIds.map(id => ({
      id: `single-${id}`,
      members: membersOf([id], infoMap),
      disabled: false,
    }))
  } else {
    // ISSUED: gộp theo nháp (own + ké) nếu >1 vé selectable chung 1 nháp;
    //         vé đã link ra ngoài đã bị loại khỏi selectableIds ở trên nên
    //         nháp của booking chủ không kéo vé member vào đây.
    const selSet = new Set(selectableIds)
    const used = new Set()
    for (const d of draftInvoices) {
      const ids = (d.ticketIds || []).filter(id => selSet.has(id) && !used.has(id))
      if (ids.length === 0) continue
      selectableGroups.push({
        id: `draft-${d.id}`,
        members: membersOf(ids, infoMap),
        disabled: false,
        reason: 'Gộp theo nháp',
      })
      ids.forEach(id => used.add(id))
    }
    for (const id of selectableIds) {
      if (used.has(id)) continue
      selectableGroups.push({
        id: `single-${id}`,
        members: membersOf([id], infoMap),
        disabled: false,
      })
    }
  }

  // Tổng số vé "liên quan" (để hiển thị X/Y) — union của mọi nhóm.
  const applicable = new Set()
  for (const g of [...claimedGroups, ...linkedGroups, ...selectableGroups]) {
    for (const m of g.members) applicable.add(m.id)
  }

  return {
    claimedGroups: [...claimedGroups, ...linkedGroups],
    selectableGroups,
    totalApplicable: applicable.size,
  }
}

// ══════════════════════════════════════════════════════════════
//  ROWS
// ══════════════════════════════════════════════════════════════

function ClaimedRow({ group }) {
  const foreignCodes = [...new Set(
    group.members.filter(m => m.foreign).map(m => m.bookingCode).filter(Boolean)
  )]
  return (
    <div className="flex items-center gap-2 text-xs p-1.5 rounded bg-white/40 border border-dashed border-gray-300 opacity-80">
      <input type="checkbox" checked readOnly disabled className="cursor-not-allowed" />
      <span className="flex-1 truncate text-gray-500">
        {group.members.map(m => m.name).join(', ')}
        {foreignCodes.length > 0 && (
          <span className="ml-1 text-[10px] text-indigo-500">· {foreignCodes.join(', ')}</span>
        )}
      </span>
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
        group.linked
          ? 'bg-amber-100 text-amber-700'
          : group.foreign
            ? 'bg-indigo-100 text-indigo-700'
            : 'bg-gray-200 text-gray-600'
      }`}>
        {group.linked ? '🔒 ' : ''}{group.reason}
      </span>
    </div>
  )
}

function SelectableRow({ group, checked, onToggle }) {
  const members = group.members
  const isGroup = members.length > 1
  const hasForeign = members.some(m => m.foreign)
  return (
    <label className={`flex items-start gap-2 text-xs p-1.5 rounded cursor-pointer ${
      isGroup
        ? 'bg-purple-50 border border-purple-200 hover:bg-purple-100'
        : hasForeign
          ? 'bg-indigo-50 border border-indigo-200 hover:bg-indigo-100'
          : 'hover:bg-white'
    }`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">
          {members.map(m => m.name).join(', ')}
        </div>
        {isGroup && (
          <div className="text-[10px] text-purple-700 mt-0.5">
            {group.reason} — {members.length} khách buộc phải chung
          </div>
        )}
        {!isGroup && hasForeign && (
          <div className="text-[10px] text-indigo-600 mt-0.5">
            Vé link từ {members[0].bookingCode || 'booking khác'}
          </div>
        )}
        {!isGroup && !hasForeign && members[0]?.ticketNumber && (
          <div className="text-gray-400 font-mono text-[10px]">· {members[0].ticketNumber}</div>
        )}
      </div>
    </label>
  )
}

// ══════════════════════════════════════════════════════════════
//  EXISTING INVOICES PANEL
// ══════════════════════════════════════════════════════════════

function ExistingInvoicesPanel({ invoices, kindLabel, booking, busy, onDelete, onDeleteAll, onPreview }) {
  if (invoices.length === 0) {
    return (
      <div className="mb-3 p-2 rounded-md bg-gray-50 border border-gray-200 text-[11px] text-gray-500 italic">
        Chưa có hóa đơn {kindLabel.toLowerCase()} nào cho booking này.
      </div>
    )
  }

  // 2026-11-12: Chỉ hóa đơn của chính booking mới xóa được (ké từ chủ → khóa).
  const deletableCount = invoices.filter(
    inv => !(inv.sourceBookingId && booking?.id && inv.sourceBookingId !== booking.id)
  ).length

  return (
    <div className="mb-3 rounded-lg bg-blue-50/40 border border-blue-200">
      <div className="px-3 py-2 border-b border-blue-200 flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold text-blue-900 uppercase tracking-wide">
          Hóa đơn {kindLabel.toLowerCase()} đã có ({invoices.length})
        </div>
        {deletableCount > 0 && (
          <button type="button" onClick={onDeleteAll} disabled={busy}
            className="text-[10px] font-semibold px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 disabled:opacity-40">
            🗑 Xóa tất cả
          </button>
        )}
      </div>
      <div className="p-2 space-y-1.5">
        {invoices.map(inv => (
          <ExistingInvoiceRow key={inv.id} inv={inv} booking={booking}
            busy={busy} onDelete={() => onDelete(inv.id)} onPreview={onPreview} />
        ))}
      </div>
    </div>
  )
}

function ExistingInvoiceRow({ inv, booking, busy, onDelete, onPreview }) {
  const ids = inv.ticketIds || []
  const previews = inv.ticketPreviews || []
  const isBookingWide = ids.length === 0
  // 2026-11-12: Hóa đơn "ké" — thuộc booking chủ, hiển thị ở member nhưng KHÓA
  //   xóa/sửa (phải thao tác ở booking chủ).
  const isForeign = !!(inv.sourceBookingId && booking?.id && inv.sourceBookingId !== booking.id)
  const names = previews.length
    ? previews.map(p => p.passengerName || `#${p.id}`)
    : ids.map(id => {
        const t = (booking.tickets || []).find(t => t.id === id)
        return t?.passengerName || `#${id}`
      })
  const scopeLabel = isBookingWide
    ? `📦 Chung cả booking · ${booking.bookingCode || `#${booking.id}`}`
    : `🎫 ${names.join(', ')}`

  const files = [
    inv.draftUrl              && { url: inv.draftUrl,             label: '📝 Nháp',           color: 'bg-amber-100 text-amber-800 hover:bg-amber-200' },
    inv.issuedUrl             && { url: inv.issuedUrl,            label: '🧾 Đã phát hành',    color: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' },
    inv.adjustmentUrl         && { url: inv.adjustmentUrl,        label: '🛠 Điều chỉnh',      color: 'bg-purple-100 text-purple-800 hover:bg-purple-200' },
    inv.adjustmentRecordUrl   && { url: inv.adjustmentRecordUrl,  label: '📎 Biên bản đã ký',  color: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200' },
  ].filter(Boolean)

  return (
    <div className={`p-2 rounded-md bg-white border ${isForeign ? 'border-indigo-200' : 'border-blue-100'}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-xs font-semibold text-gray-800 flex-1 min-w-0 break-words">
          {scopeLabel}
          {isForeign && (
            <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700"
              title="Hóa đơn do booking chủ quản lý — xóa/sửa ở booking chủ">
              🔒 Chủ {inv.sourceBookingCode || ''}
            </span>
          )}
        </div>
        <div className="flex items-center flex-wrap gap-1">
          {files.length === 0 ? (
            <span className="text-[10px] italic text-gray-400 px-2 py-0.5">Chưa có file</span>
          ) : (
            files.map((f, i) => (
              <button key={i} type="button"
                onClick={() => onPreview?.({ url: f.url, name: f.name || f.label })}
                title="Click để xem trước file"
                className={`text-[10px] font-bold px-2 py-0.5 rounded transition ${f.color}`}>
                {f.label}
              </button>
            ))
          )}
          {/* Hóa đơn ké → không cho xóa ở member; chỉ owner xóa. */}
          {!isForeign && (
            <button type="button" onClick={onDelete} disabled={busy}
              title="Xóa hóa đơn này"
              className="text-[10px] font-bold w-6 h-6 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 disabled:opacity-40 flex items-center justify-center">
              🗑
            </button>
          )}
        </div>
      </div>
      {inv.note && (
        <div className="text-[10px] text-gray-500 mt-1 italic">{inv.note}</div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  WARNING BOX (ISSUED)
// ══════════════════════════════════════════════════════════════

function IssuedWarning({ drafts, selectedTicketIds, booking }) {
  const selectedSet = new Set(selectedTicketIds)
  const affected = drafts.filter(inv => {
    const ids = inv.ticketIds || []
    if (ids.length === 0) return true
    return ids.some(id => selectedSet.has(id))
  })
  if (affected.length === 0) return null
  return (
    <div className="mb-3 p-2 rounded-md bg-amber-50 border border-amber-300 text-[11px] text-amber-800">
      ⚠ Sẽ xóa <b>{affected.length}</b> hóa đơn nháp overlap sau khi phát hành:
      <ul className="mt-1 list-disc list-inside">
        {affected.map(d => {
          const paxLabel = (d.ticketPreviews && d.ticketPreviews.length > 0)
            ? d.ticketPreviews.map(p => p.passengerName || `#${p.id}`).join(', ')
            : (d.ticketIds && d.ticketIds.length > 0)
              ? d.ticketIds.map(id => {
                  const t = booking.tickets?.find(t => t.id === id)
                  return t?.passengerName || `#${id}`
                }).join(', ')
              : 'Chung cả booking'
          return (
            <li key={d.id}>
              {d.draftOriginal || `hóa đơn #${d.id}`} <span className="text-amber-600">({paxLabel})</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}