import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import Badge from '../common/Badge'
import ConfirmModal from '../common/ConfirmModal'
import {
  getBooking, createInvoice, updateInvoice, deleteInvoice,
  replaceInvoiceFile, deleteInvoiceFile,
} from '../../services/vmbApi'

/**
 * Quản lý hóa đơn của 1 booking.
 *
 * ── 2026-09-19 refactor ─────────────────────────────────────
 * Invoice ↔ Ticket giờ là MANY-TO-MANY linh hoạt:
 *   "Chung cả booking"     → ticketIds = []       (gộp tổng các vé)
 *   "Áp cho các vé cụ thể" → ticketIds = [1,2]    (subset)
 *
 * Cho phép:
 *   - 1 booking 4 vé = 1 hóa đơn gộp
 *   - 1 booking 4 vé = 4 hóa đơn riêng
 *   - 1 booking 4 vé = 1 hóa đơn 3 vé + 1 hóa đơn 1 vé
 *   - 1 booking 4 vé = 2 hóa đơn 2+2
 *   - 1 ticket có thể ở NHIỀU invoice cùng lúc (không exclusivity)
 *
 * User chọn scope qua CHECKBOX list vé — bỏ trống hết = "chung cả booking".
 * Có thể ĐỔI scope khi sửa hóa đơn (khác bản cũ).
 */
export default function InvoiceManagerModal({ bookingId, onClose, onDirty }) {
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getBooking(bookingId)
      const b = res.data?.data
      if (!b) throw new Error('Không tìm thấy booking')
      setBooking(b)
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.message || 'Không tải được booking')
      onClose()
    } finally {
      setLoading(false)
    }
  }, [bookingId, onClose])

  useEffect(() => { load() }, [load])

  const doDelete = async () => {
    if (!confirmDel) return
    try {
      await deleteInvoice(confirmDel.id)
      toast.success('Đã xóa hóa đơn')
      setConfirmDel(null)
      await load()
      onDirty?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Xóa thất bại')
    }
  }

  const invoices = booking?.invoices || []
  const tickets  = booking?.tickets || []

  return (
    <>
      <Modal open onClose={busy ? undefined : onClose}
        title={`Hóa đơn — ${booking?.bookingCode || 'booking'}`}
        size="xl" closeOnBackdrop={!busy}>
        {loading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Đang tải…</div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex-1 text-xs text-gray-600">
                {tickets.length} vé · {invoices.length} hóa đơn
              </div>
              {!showForm && !editing && (
                <button type="button"
                  onClick={() => setShowForm(true)}
                  className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
                  + Tạo hóa đơn mới
                </button>
              )}
            </div>

            {showForm && (
              <div className="mb-4 p-3 rounded-xl bg-blue-50/40 border border-blue-200">
                <InvoiceForm
                  initial={null} tickets={tickets} busy={busy}
                  onSave={async (body) => {
                    setBusy(true)
                    try {
                      await createInvoice(bookingId, body)
                      toast.success('Đã tạo hóa đơn')
                      setShowForm(false)
                      await load()
                      onDirty?.()
                    } catch (e) {
                      toast.error(e?.response?.data?.message || 'Tạo thất bại')
                    } finally { setBusy(false) }
                  }}
                  onCancel={() => setShowForm(false)}
                />
              </div>
            )}

            {editing && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50/40 border border-amber-200">
                <InvoiceForm
                  initial={editing} tickets={tickets} busy={busy}
                  onSave={async (body) => {
                    setBusy(true)
                    try {
                      await updateInvoice(editing.id, body)
                      toast.success('Đã cập nhật')
                      setEditing(null)
                      await load()
                      onDirty?.()
                    } catch (e) {
                      toast.error(e?.response?.data?.message || 'Cập nhật thất bại')
                    } finally { setBusy(false) }
                  }}
                  onCancel={() => setEditing(null)}
                />
              </div>
            )}

            {invoices.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">
                Chưa có hóa đơn nào. Bấm "+ Tạo hóa đơn mới" ở trên.
              </div>
            ) : (
              <div className="space-y-2">
                {invoices.map(inv => (
                  <InvoiceCard key={inv.id} inv={inv}
                    ticketLookup={tickets}
                    onEdit={() => setEditing(inv)}
                    onDelete={() => setConfirmDel(inv)}
                    onPreview={(p) => window.open(p.url, '_blank')}
                    onFileReplace={async (slot, file) => {
                      setBusy(true)
                      try {
                        await replaceInvoiceFile(inv.id, slot, file)
                        toast.success('Đã thay file')
                        await load(); onDirty?.()
                      } catch (e) {
                        toast.error(e?.response?.data?.message || 'Thay file thất bại')
                      } finally { setBusy(false) }
                    }}
                    onFileDelete={async (slot, label) => {
                      if (!window.confirm(`Xóa file "${label}"?`)) return
                      setBusy(true)
                      try {
                        await deleteInvoiceFile(inv.id, slot)
                        toast.success('Đã xóa file')
                        await load(); onDirty?.()
                      } catch (e) {
                        toast.error(e?.response?.data?.message || 'Xóa file thất bại')
                      } finally { setBusy(false) }
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Modal>

      {confirmDel && (
        <ConfirmModal
          open title="Xóa hóa đơn"
          message="Xóa hóa đơn này? Tất cả file đính kèm (nháp, đã PH, điều chỉnh, biên bản) cũng bị xóa."
          confirmLabel="Xóa" danger
          onConfirm={doDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────

function InvoiceCard({ inv, ticketLookup, onEdit, onDelete, onPreview, onFileReplace, onFileDelete }) {
  const files = [
    inv.draftUrl              && { slot: 'draft',      label: 'Nháp',              url: inv.draftUrl,              name: inv.draftOriginal },
    inv.issuedUrl             && { slot: 'issued',     label: 'Đã phát hành',      url: inv.issuedUrl,             name: inv.issuedOriginal },
    inv.adjustmentUrl         && { slot: 'adjustment', label: 'Điều chỉnh',        url: inv.adjustmentUrl,         name: inv.adjustmentOriginal },
    inv.adjustmentRecordUrl   && { slot: 'record',     label: 'Biên bản đã ký',    url: inv.adjustmentRecordUrl,   name: inv.adjustmentRecordOriginal },
  ].filter(Boolean)

  const badge = statusBadge(inv.status)
  // ── 2026-09-19: inv.ticketIds thay cho ticketId. Empty = chung cả booking. ──
  const scopeIds = inv.ticketIds || []
  const scopeTickets = scopeIds.map(id => ticketLookup.find(t => t.id === id)).filter(Boolean)
  const isBookingWide = scopeTickets.length === 0

  return (
    <div className="p-3 rounded-xl bg-white border border-gray-200">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Badge color={badge.color} dot>{badge.label}</Badge>
        {isBookingWide ? (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
            📦 Chung booking
          </span>
        ) : (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700"
            title={`Áp cho ${scopeTickets.length} vé`}>
            🎫 {scopeTickets.map(t => t.passengerName || `#${t.id}`).join(', ')}
          </span>
        )}
        {inv.note && <span className="text-xs text-gray-600 truncate">{inv.note}</span>}
        <div className="flex-1" />
        <button onClick={onEdit} className="text-xs font-semibold text-blue-600 hover:text-blue-800">Sửa</button>
        <button onClick={onDelete} className="text-xs font-semibold text-rose-600 hover:text-rose-800">Xóa hóa đơn</button>
      </div>
      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {files.map((f, i) => (
            <InvoiceFileSlot key={i}
              file={f}
              onPreview={() => onPreview({ url: fileUrl(f.url), name: f.name })}
              onReplace={(newFile) => onFileReplace(f.slot, newFile)}
              onDelete={() => onFileDelete(f.slot, f.label)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function InvoiceFileSlot({ file: f, onPreview, onReplace, onDelete }) {
  const inputRef = useRef(null)
  return (
    <div className="relative group p-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-white hover:border-blue-300 transition">
      <button type="button" onClick={onPreview} className="w-full text-left">
        <div className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">{f.label}</div>
        <div className="text-xs text-gray-900 truncate pr-10">📄 {f.name || 'file'}</div>
      </button>
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
        <button type="button" onClick={() => inputRef.current?.click()}
          title="Thay file mới"
          className="w-6 h-6 rounded-md bg-white text-blue-600 hover:bg-blue-100 flex items-center justify-center text-xs shadow-sm border border-gray-200">↻</button>
        <button type="button" onClick={onDelete}
          title="Xóa file"
          className="w-6 h-6 rounded-md bg-white text-rose-600 hover:bg-rose-100 flex items-center justify-center text-sm shadow-sm border border-gray-200">×</button>
      </div>
      <input ref={inputRef} type="file" hidden accept="image/*,application/pdf"
        onChange={e => {
          const nf = e.target.files?.[0]
          if (nf) onReplace(nf)
          e.target.value = ''
        }} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────

function InvoiceForm({ initial, tickets, onSave, onCancel, busy }) {
  const isEdit = !!initial
  const [status, setStatus] = useState(initial?.status || 'DRAFT')
  const [note, setNote] = useState(initial?.note || '')

  // ── 2026-09-19: many-to-many, đổi scope được cả khi sửa ──
  // selectedIds là Set<number>. Empty set = chung cả booking.
  const initialIds = (initial?.ticketIds && initial.ticketIds.length > 0) ? initial.ticketIds : []
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialIds))
  const isBookingWide = selectedIds.size === 0

  const toggleTicket = (tid) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(tid) ? next.delete(tid) : next.add(tid)
      return next
    })
  }
  const setBookingWide = () => setSelectedIds(new Set())

  const [files, setFiles] = useState({
    draftFile: null, issuedFile: null,
    adjustmentFile: null, adjustmentRecordFile: null,
  })

  const submit = (e) => {
    e.preventDefault()
    const ticketIds = [...selectedIds]

    // Gửi lên BE:
    //   - Create: luôn gửi ticketIds (empty [] = chung cả booking)
    //   - Update:
    //       * Nếu empty và ban đầu KHÔNG empty → cần gửi clearTicketIds=true
    //       * Nếu non-empty → gửi ticketIds
    //       * Nếu empty và ban đầu cũng empty → không cần gửi gì
    const payload = { status, note, ...files }
    if (isEdit) {
      const initiallyEmpty = !initial.ticketIds || initial.ticketIds.length === 0
      if (ticketIds.length === 0) {
        if (!initiallyEmpty) payload.clearTicketIds = true
      } else {
        payload.ticketIds = ticketIds
      }
    } else {
      payload.ticketIds = ticketIds
    }
    onSave(payload)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-xs font-bold text-gray-700 uppercase">
        {isEdit ? 'Sửa hóa đơn' : 'Tạo hóa đơn mới'}
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Phạm vi hóa đơn</label>

        {/* Radio "Chung cả booking" */}
        <label className={`p-2.5 rounded-lg border-2 cursor-pointer text-xs transition flex items-start gap-2 mb-2 ${
          isBookingWide ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'
        }`}>
          <input type="radio" name="scope" checked={isBookingWide}
            onChange={setBookingWide} className="mt-0.5" />
          <div>
            <b>📦 Chung cả booking</b>
            <div className="text-[10px] text-gray-500">Gộp tổng của {tickets.length} vé — không tick vé nào ở dưới</div>
          </div>
        </label>

        {/* Radio "Áp cho các vé cụ thể" + checkbox list */}
        <div className={`p-2.5 rounded-lg border-2 transition ${
          !isBookingWide ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'
        }`}>
          <label className="flex items-start gap-2 mb-2 cursor-pointer">
            <input type="radio" name="scope" checked={!isBookingWide}
              onChange={() => { if (isBookingWide) setSelectedIds(new Set([tickets[0]?.id].filter(Boolean))) }}
              className="mt-0.5" />
            <div>
              <b>🎫 Áp cho các vé cụ thể</b>
              <div className="text-[10px] text-gray-500">
                Chọn 1..N vé. Có thể trùng với hóa đơn khác (1 vé có thể ở nhiều hóa đơn).
              </div>
            </div>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pl-6">
            {tickets.map(t => (
              <label key={t.id} className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-white cursor-pointer">
                <input type="checkbox" checked={selectedIds.has(t.id)}
                  onChange={() => toggleTicket(t.id)} />
                <span className="flex-1 truncate">
                  {t.passengerName || `vé #${t.id}`}
                  {t.ticketNumber && <span className="text-gray-400 ml-1 font-mono text-[10px]">· {t.ticketNumber}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>

        {isEdit && (
          <div className="text-[10px] text-gray-500 mt-1 italic">
            💡 Có thể đổi phạm vi khi sửa (many-to-many linh hoạt).
          </div>
        )}
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Trạng thái</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: 'DRAFT',    l: 'Nháp' },
            { v: 'ISSUED',   l: 'Đã PH' },
            { v: 'ADJUSTED', l: 'Điều chỉnh' },
          ].map(s => (
            <label key={s.v} className={`p-2 rounded-md border-2 text-center text-xs cursor-pointer ${
              status === s.v ? 'border-blue-400 bg-blue-50 font-bold' : 'border-gray-200 hover:bg-gray-50'
            }`}>
              <input type="radio" name="status" checked={status === s.v}
                onChange={() => setStatus(s.v)} hidden />
              {s.l}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Ghi chú</label>
        <input type="text" value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="VD: Xuất theo yêu cầu khách 15/09"
          className="input" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FilePicker label="File nháp"
          current={initial?.draftOriginal} value={files.draftFile}
          onChange={f => setFiles(x => ({ ...x, draftFile: f }))} />
        <FilePicker label="File đã phát hành"
          current={initial?.issuedOriginal} value={files.issuedFile}
          onChange={f => setFiles(x => ({ ...x, issuedFile: f }))} />
        {(status === 'ADJUSTED' || initial?.adjustmentFile) && (
          <>
            <FilePicker label="File điều chỉnh"
              current={initial?.adjustmentOriginal} value={files.adjustmentFile}
              onChange={f => setFiles(x => ({ ...x, adjustmentFile: f }))} />
            <FilePicker label="Biên bản đã ký"
              current={initial?.adjustmentRecordOriginal} value={files.adjustmentRecordFile}
              onChange={f => setFiles(x => ({ ...x, adjustmentRecordFile: f }))} />
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} disabled={busy}
          className="px-3 py-1.5 text-xs rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-50">Hủy</button>
        <button type="submit" disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white
            hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Đang lưu…' : (isEdit ? 'Lưu' : 'Tạo')}
        </button>
      </div>

      <style>{`
        .input {
          width: 100%; padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid #d1d5db; background: #fff;
          font-size: 0.875rem; outline: none;
        }
        .input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
      `}</style>
    </form>
  )
}

function FilePicker({ label, current, value, onChange }) {
  const ref = useRef(null)
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-500 mb-1 block uppercase">{label}</label>
      <input ref={ref} type="file" hidden accept="image/*,application/pdf"
        onChange={e => onChange(e.target.files?.[0] || null)} />
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => ref.current?.click()}
          className="flex-1 px-2 py-1.5 text-xs rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-left truncate">
          {value ? `📎 ${value.name}` : current ? `(giữ) ${current}` : '+ Chọn file'}
        </button>
        {value && (
          <button type="button" onClick={() => onChange(null)}
            className="w-6 h-6 rounded-md hover:bg-rose-100 text-rose-500 text-sm">×</button>
        )}
      </div>
    </div>
  )
}

function statusBadge(s) {
  if (s === 'ISSUED')   return { color: 'green',  label: 'Đã phát hành' }
  if (s === 'ADJUSTED') return { color: 'purple', label: 'Điều chỉnh' }
  return { color: 'blue', label: 'Nháp' }
}

function fileUrl(u) {
  if (!u) return u
  if (u.startsWith('http')) return u
  return (import.meta.env.VITE_API_BASE || '') + u
}