import { useMemo, useRef, useState } from 'react'
import Modal from '../common/Modal'
import { uploadBookingProof, deleteBookingProof } from '../../services/vmbApi'
import { vmbFileUrl } from '../../services/api'

/**
 * Modal quản lý file BẰNG CHỨNG của booking.
 *
 * Khác Mặt vé (TicketFile) ở chỗ:
 *   - N file, không phải 1.
 *   - Mixed scope trong cùng 1 booking OK:
 *       Section "Chung cả booking"  → ticketId = null
 *       Section per hành khách       → ticketId = <ticketId>
 *   - KHÔNG bị chi phối bởi sharedTicketFace.
 *
 * Sau mỗi upload/delete, gọi onChanged() để parent reload booking (đơn giản
 * và chắc chắn hơn là patch state local).
 */
export default function BookingProofModal({ open, booking, onClose, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  // Chia file theo scope cho tiện render
  const { shared, perTicket } = useMemo(() => {
    const shared = []
    const perTicket = new Map() // ticketId → BookingProofIO[]
    for (const p of (booking?.bookingProofs || [])) {
      if (p.ticketId == null) shared.push(p)
      else {
        const arr = perTicket.get(p.ticketId) || []
        arr.push(p)
        perTicket.set(p.ticketId, arr)
      }
    }
    return { shared, perTicket }
  }, [booking])

  if (!open || !booking) return null

  const handleUpload = async (ticketId, file) => {
    if (!file) return
    setErr(''); setBusy(true)
    try {
      const res = await uploadBookingProof(booking.id, file, ticketId)
      if (res.data?.error) setErr(res.data.message || 'Upload thất bại')
      else onChanged && onChanged()
    } catch (e) {
      setErr(e.message || 'Upload thất bại')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (proofId) => {
    if (!confirm('Xóa file này?')) return
    setErr(''); setBusy(true)
    try {
      const res = await deleteBookingProof(proofId)
      if (res.data?.error) setErr(res.data.message || 'Xóa thất bại')
      else onChanged && onChanged()
    } catch (e) {
      setErr(e.message || 'Xóa thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Bằng chứng — ${booking.bookingCode || '(chưa có mã)'}`} size="lg">
      {err && (
        <div className="mb-3 p-2 rounded-md bg-rose-50 text-rose-700 text-xs border border-rose-200">
          {err}
        </div>
      )}

      <div className="space-y-4">
        {/* Section chung cả booking */}
        <Section
          title="Chung cả booking"
          hint="Upload file dùng chung cho mọi hành khách (VD: ảnh mail xác nhận đặt chỗ)."
          files={shared}
          onUpload={file => handleUpload(null, file)}
          onDelete={handleDelete}
          disabled={busy}
        />

        {/* Section per hành khách */}
        {(booking.tickets || []).map(t => (
          <Section
            key={t.id}
            title={`Riêng khách: ${t.passengerName || '(chưa có tên)'} ${t.ticketNumber ? `— ${t.ticketNumber}` : ''}`}
            hint="Chỉ áp dụng cho vé của khách này."
            files={perTicket.get(t.id) || []}
            onUpload={file => handleUpload(t.id, file)}
            onDelete={handleDelete}
            disabled={busy}
          />
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onClose}
          className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm font-semibold">
          Đóng
        </button>
      </div>
    </Modal>
  )
}

function Section({ title, hint, files, onUpload, onDelete, disabled }) {
  const inputRef = useRef(null)

  return (
    <div className="p-3 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-sm font-bold text-gray-800">{title}</div>
          <div className="text-[11px] text-gray-500">{hint}</div>
        </div>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onUpload(f)
            e.target.value = ''
          }} />
        <button type="button" onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
          + Tải file
        </button>
      </div>

      {files.length === 0 ? (
        <div className="text-[11px] text-gray-400 italic px-1">Chưa có file nào.</div>
      ) : (
        <ul className="space-y-1">
          {files.map(f => (
            <li key={f.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50">
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                {contentTypeIcon(f.contentType)}
              </span>
              <a href={vmbFileUrl(f.url)} target="_blank" rel="noopener noreferrer"
                className="flex-1 text-xs text-blue-700 hover:underline truncate">
                {f.originalName || f.url}
              </a>
              <span className="text-[10px] text-gray-400">{formatSize(f.sizeBytes)}</span>
              <button onClick={() => onDelete(f.id)} disabled={disabled}
                title="Xóa file này"
                className="w-6 h-6 rounded text-rose-600 hover:bg-rose-50 flex items-center justify-center">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function contentTypeIcon(ct) {
  if (!ct) return '📄'
  if (ct.startsWith('image/')) return '🖼️'
  if (ct === 'application/pdf') return '📕'
  return '📄'
}

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes/1024).toFixed(0)}KB`
  return `${(bytes/1024/1024).toFixed(1)}MB`
}