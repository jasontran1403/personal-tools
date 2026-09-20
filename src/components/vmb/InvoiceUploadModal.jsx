import { useMemo, useRef, useState } from 'react'
import Modal from '../common/Modal'
import { createInvoice, deleteInvoice } from '../../services/vmbApi'
import { vmbFileUrl } from '../../services/api'

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
 * Với ISSUED, sau khi tạo thành công vẫn tự xóa các DRAFT overlap (giữ
 * behavior cũ) — nhưng do đã ép nhóm theo draft, overlap giờ là "trọn vẹn".
 */
export default function InvoiceUploadModal({ open, booking, onClose, onChanged }) {
  const [kind, setKind] = useState('DRAFT')
  const [selectedGroupIds, setSelectedGroupIds] = useState(() => new Set())
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')
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
      if (selectedGroupIds.has(g.id)) out.push(...g.ticketIds)
    }
    return out
  }, [selectionModel, selectedGroupIds])

  const removeInvoice = async (invId) => {
    if (!confirm('Xóa hóa đơn này?')) return
    setBusy(true); setErr('')
    try {
      const res = await deleteInvoice(invId)
      if (res.data?.error) throw new Error(res.data.message || 'Xóa thất bại')
      if (onChanged) onChanged()
    } catch (e) {
      setErr(e.message || 'Xóa thất bại')
    } finally {
      setBusy(false)
    }
  }

  const removeAllOfKind = async () => {
    if (currentKindInvoices.length === 0) return
    const label = kind === 'DRAFT' ? 'nháp' : 'đã phát hành'
    if (!confirm(`Xóa toàn bộ ${currentKindInvoices.length} hóa đơn ${label} của booking này?`)) return
    setBusy(true); setErr('')
    try {
      for (const inv of currentKindInvoices) {
        try { await deleteInvoice(inv.id) } catch { /* keep going */ }
      }
      if (onChanged) onChanged()
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setErr('')
    if (flatSelectedTicketIds.length === 0) { setErr('Chọn ít nhất 1 khách hàng.'); return }
    if (!file)                              { setErr('Chưa chọn file.'); return }
    setBusy(true)
    try {
      const payload = { status: kind, note, ticketIds: flatSelectedTicketIds }
      if (kind === 'DRAFT')  payload.draftFile  = file
      if (kind === 'ISSUED') payload.issuedFile = file

      const res = await createInvoice(booking.id, payload)
      if (res.data?.error) throw new Error(res.data.message || 'Tạo hóa đơn thất bại')

      // ISSUED xóa các DRAFT overlap
      if (kind === 'ISSUED') {
        const selectedSet = new Set(flatSelectedTicketIds)
        const overlappedDrafts = draftInvoices.filter(inv => {
          const ids = inv.ticketIds || []
          if (ids.length === 0) return true // chung cả booking
          return ids.some(id => selectedSet.has(id))
        })
        for (const d of overlappedDrafts) {
          try { await deleteInvoice(d.id) } catch (e) { console.warn('Xóa draft thất bại', d.id, e) }
        }
      }

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
      />

      {/* ─ Áp cho khách hàng ──────────────────────────────────────── */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-semibold text-gray-600">
            Áp cho khách hàng ({flatSelectedTicketIds.length}/{booking.tickets?.length || 0})
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

          {/* Nhóm đã có (disabled) */}
          {selectionModel.claimedGroups.map(g => (
            <ClaimedRow key={g.id} group={g} booking={booking} />
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
            <SelectableRow key={g.id} group={g} booking={booking}
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
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════
//  SELECTION MODEL
// ══════════════════════════════════════════════════════════════
//
// group.id       : string duy nhất trong 1 model
// group.ticketIds: mảng ticket ID trong nhóm
// group.disabled : true → panel "đã có", không tick được
// group.reason   : nhãn hiển thị (Đã có nháp / Gộp theo nháp / …)

function computeSelectionModel(booking, kind, currentKindInvoices, draftInvoices) {
  const allTickets = booking?.tickets || []
  const claimedPaxIds = new Set()

  // Claimed = pax đã nằm trong 1 invoice cùng kind
  const claimedGroups = currentKindInvoices
    .filter(inv => (inv.ticketIds || []).length > 0)
    .map(inv => {
      const ids = inv.ticketIds || []
      ids.forEach(id => claimedPaxIds.add(id))
      return {
        id: `claimed-${inv.id}`,
        ticketIds: ids,
        disabled: true,
        reason: kind === 'DRAFT' ? 'Đã có nháp' : 'Đã có phát hành',
      }
    })

  // "Chung cả booking" (empty ticketIds) → coi như đã có cho tất cả
  for (const inv of currentKindInvoices) {
    if ((inv.ticketIds || []).length === 0) {
      // Tạo 1 claimedGroup ảo bao trọn booking
      const allIds = allTickets.map(t => t.id)
      allIds.forEach(id => claimedPaxIds.add(id))
      claimedGroups.push({
        id: `claimed-all-${inv.id}`,
        ticketIds: allIds,
        disabled: true,
        reason: kind === 'DRAFT' ? 'Đã có nháp (chung)' : 'Đã có phát hành (chung)',
      })
    }
  }

  // Selectable = pax chưa claimed
  const unclaimedTickets = allTickets.filter(t => !claimedPaxIds.has(t.id))

  let selectableGroups = []
  if (kind === 'DRAFT') {
    // DRAFT: mỗi pax chưa claimed 1 checkbox riêng
    selectableGroups = unclaimedTickets.map(t => ({
      id: `single-${t.id}`,
      ticketIds: [t.id],
      disabled: false,
    }))
  } else {
    // ISSUED: gộp theo DRAFT membership (nếu >1 pax chưa claimed trong 1 draft),
    //         còn lại thành single group.
    const usedInDraft = new Set()
    for (const d of draftInvoices) {
      const ids = (d.ticketIds || []).filter(id => !claimedPaxIds.has(id))
      if (ids.length === 0) continue
      selectableGroups.push({
        id: `draft-${d.id}`,
        ticketIds: ids,
        disabled: false,
        reason: 'Gộp theo nháp',
      })
      ids.forEach(id => usedInDraft.add(id))
    }
    for (const t of unclaimedTickets) {
      if (usedInDraft.has(t.id)) continue
      selectableGroups.push({
        id: `single-${t.id}`,
        ticketIds: [t.id],
        disabled: false,
      })
    }
  }

  return { claimedGroups, selectableGroups }
}

// ══════════════════════════════════════════════════════════════
//  ROWS
// ══════════════════════════════════════════════════════════════

function ClaimedRow({ group, booking }) {
  const names = group.ticketIds.map(id => {
    const t = (booking.tickets || []).find(t => t.id === id)
    return t?.passengerName || `#${id}`
  })
  return (
    <div className="flex items-center gap-2 text-xs p-1.5 rounded bg-white/40 border border-dashed border-gray-300 opacity-70">
      <input type="checkbox" checked readOnly disabled className="cursor-not-allowed" />
      <span className="flex-1 truncate text-gray-500">
        {names.join(', ')}
      </span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
        {group.reason}
      </span>
    </div>
  )
}

function SelectableRow({ group, booking, checked, onToggle }) {
  const tickets = group.ticketIds.map(id => (booking.tickets || []).find(t => t.id === id)).filter(Boolean)
  const isGroup = tickets.length > 1
  return (
    <label className={`flex items-start gap-2 text-xs p-1.5 rounded cursor-pointer ${
      isGroup
        ? 'bg-purple-50 border border-purple-200 hover:bg-purple-100'
        : 'hover:bg-white'
    }`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">
          {tickets.map(t => t.passengerName || `#${t.id}`).join(', ')}
        </div>
        {isGroup && (
          <div className="text-[10px] text-purple-700 mt-0.5">
            {group.reason} — {tickets.length} khách buộc phải chung
          </div>
        )}
        {!isGroup && tickets[0]?.ticketNumber && (
          <div className="text-gray-400 font-mono text-[10px]">· {tickets[0].ticketNumber}</div>
        )}
      </div>
    </label>
  )
}

// ══════════════════════════════════════════════════════════════
//  EXISTING INVOICES PANEL
// ══════════════════════════════════════════════════════════════

function ExistingInvoicesPanel({ invoices, kindLabel, booking, busy, onDelete, onDeleteAll }) {
  if (invoices.length === 0) {
    return (
      <div className="mb-3 p-2 rounded-md bg-gray-50 border border-gray-200 text-[11px] text-gray-500 italic">
        Chưa có hóa đơn {kindLabel.toLowerCase()} nào cho booking này.
      </div>
    )
  }

  return (
    <div className="mb-3 rounded-lg bg-blue-50/40 border border-blue-200">
      <div className="px-3 py-2 border-b border-blue-200 flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold text-blue-900 uppercase tracking-wide">
          Hóa đơn {kindLabel.toLowerCase()} đã có ({invoices.length})
        </div>
        <button type="button" onClick={onDeleteAll} disabled={busy}
          className="text-[10px] font-semibold px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 disabled:opacity-40">
          🗑 Xóa tất cả
        </button>
      </div>
      <div className="p-2 space-y-1.5">
        {invoices.map(inv => (
          <ExistingInvoiceRow key={inv.id} inv={inv} booking={booking}
            busy={busy} onDelete={() => onDelete(inv.id)} />
        ))}
      </div>
    </div>
  )
}

function ExistingInvoiceRow({ inv, booking, busy, onDelete }) {
  const ids = inv.ticketIds || []
  const isBookingWide = ids.length === 0
  const scopeLabel = isBookingWide
    ? `📦 Chung cả booking · ${booking.bookingCode || `#${booking.id}`}`
    : `🎫 ${ids.map(id => {
        const t = (booking.tickets || []).find(t => t.id === id)
        return t?.passengerName || `#${id}`
      }).join(', ')}`

  const files = [
    inv.draftUrl              && { url: inv.draftUrl,             label: '📝 Nháp',           color: 'bg-amber-100 text-amber-800 hover:bg-amber-200' },
    inv.issuedUrl             && { url: inv.issuedUrl,            label: '🧾 Đã phát hành',    color: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' },
    inv.adjustmentUrl         && { url: inv.adjustmentUrl,        label: '🛠 Điều chỉnh',      color: 'bg-purple-100 text-purple-800 hover:bg-purple-200' },
    inv.adjustmentRecordUrl   && { url: inv.adjustmentRecordUrl,  label: '📎 Biên bản đã ký',  color: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200' },
  ].filter(Boolean)

  return (
    <div className="p-2 rounded-md bg-white border border-blue-100">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-xs font-semibold text-gray-800 flex-1 min-w-0 break-words">
          {scopeLabel}
        </div>
        <div className="flex items-center flex-wrap gap-1">
          {files.length === 0 ? (
            <span className="text-[10px] italic text-gray-400 px-2 py-0.5">Chưa có file</span>
          ) : (
            files.map((f, i) => (
              <a key={i} href={vmbFileUrl(f.url)} target="_blank" rel="noopener noreferrer"
                title="Click để xem trước file"
                className={`text-[10px] font-bold px-2 py-0.5 rounded transition ${f.color}`}>
                {f.label}
              </a>
            ))
          )}
          <button type="button" onClick={onDelete} disabled={busy}
            title="Xóa hóa đơn này"
            className="text-[10px] font-bold w-6 h-6 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 disabled:opacity-40 flex items-center justify-center">
            🗑
          </button>
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
          const paxLabel = (d.ticketIds && d.ticketIds.length > 0)
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