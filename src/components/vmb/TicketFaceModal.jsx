import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import ConfirmModal from '../common/ConfirmModal'
import ZoomablePreview from './ZoomablePreview'
import {
  uploadBookingFace, deleteBookingFace,
  uploadTicketFace,  deleteTicketFace,
} from '../../services/vmbApi'

/**
 * Modal xem / upload mặt vé.
 *
 * Props:
 *   booking     — full BookingIO (cần sharedTicketFace, bookingFace, tickets, bookingCode)
 *   ticketId    — nếu null → mở scope BOOKING (shared face); ngược lại mở scope TICKET
 *   onClose     — đóng modal
 *   onDirty     — gọi khi có thay đổi (upload/delete) để tab list refresh
 *
 * ── Cách resolve face để hiển thị ─────────────────────────
 * Nếu ticketId=null:
 *   - booking.sharedTicketFace=true  → hiển thị booking.bookingFace
 *   - booking.sharedTicketFace=false → không có face chung; hiển thị list ticket
 *                                      để chọn xem face nào
 * Nếu ticketId có:
 *   - booking.sharedTicketFace=true  → face chung (bookingFace) — 1 file duy nhất
 *   - booking.sharedTicketFace=false → face riêng của ticket đó (tìm trong
 *                                      booking.tickets → ticket.ticketFace)
 *
 * ── Khi chưa có face ─────────────────────────────────────
 * Hiển thị form upload — chọn file, gọi endpoint tương ứng scope. Sau khi
 * upload xong, onDirty() để tab list reload và modal đóng.
 */
export default function TicketFaceModal({ booking, ticketId, onClose, onDirty }) {
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const fileInputRef = useRef(null)

  const shared = !!booking?.sharedTicketFace
  const targetTicket = ticketId ? (booking?.tickets || []).find(t => t.id === ticketId) : null

  // ── Resolve face theo scope ──────────────────────────────
  let face = null
  let scope = 'booking'   // 'booking' | 'ticket'
  let scopeLabel = ''
  let uploadFn, deleteFn

  if (shared) {
    // Booking scope — dù click vào booking-code hay ticket-number, đều mở face chung
    face = booking?.bookingFace || null
    scope = 'booking'
    scopeLabel = `Mặt vé chung · ${booking?.bookingCode || 'booking'}`
    uploadFn = (f) => uploadBookingFace(booking.id, f)
    deleteFn = () => deleteBookingFace(booking.id)
  } else if (targetTicket) {
    // Ticket scope
    face = targetTicket.ticketFace || null
    scope = 'ticket'
    scopeLabel = `Mặt vé · ${targetTicket.passengerName || 'khách'} (${targetTicket.ticketNumber || 'chưa có số vé'})`
    uploadFn = (f) => uploadTicketFace(targetTicket.id, f)
    deleteFn = () => deleteTicketFace(targetTicket.id)
  } else {
    // Click booking-code khi shared=false → user cần chọn ticket
    return (
      <Modal open onClose={onClose} title="Chọn hành khách" size="md" closeOnBackdrop>
        <div className="text-sm text-gray-600 mb-3">
          Booking này ở chế độ <b>mặt vé riêng từng khách</b>. Chọn hành khách để xem mặt vé:
        </div>
        <div className="grid grid-cols-1 gap-2">
          {(booking?.tickets || []).map(t => (
            <button key={t.id} type="button"
              onClick={() => {
                onClose()
                // Cho parent biết muốn mở face của ticket t.id
                if (booking?._onPickTicket) booking._onPickTicket(t.id)
              }}
              className="flex items-center justify-between p-3 rounded-lg border border-gray-200
                hover:border-blue-400 hover:bg-blue-50/60 text-left">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{t.passengerName || '—'}</div>
                <div className="font-mono text-[11px] text-gray-500 truncate">
                  {t.ticketNumber || 'chưa có số vé'}
                </div>
              </div>
              <div className="text-xs shrink-0 ml-2">
                {t.ticketFace
                  ? <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">Có file</span>
                  : <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">Chưa có</span>}
              </div>
            </button>
          ))}
        </div>
      </Modal>
    )
  }

  const handlePickFile = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      await uploadFn(file)
      toast.success('Đã tải mặt vé')
      onDirty?.()
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Tải file thất bại')
    } finally {
      setBusy(false)
    }
  }

  const handleReplace = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      await uploadFn(file)
      toast.success('Đã thay file')
      onDirty?.()
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Thay file thất bại')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteFn()
      toast.success('Đã xóa mặt vé')
      onDirty?.()
      setConfirmDel(false)
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Xóa thất bại')
    } finally {
      setBusy(false)
    }
  }

  // ── Trường hợp có face → preview + toolbar Thay/Xóa ─────────
  if (face) {
    return (
      <>
        <Modal open onClose={busy ? undefined : onClose} title={scopeLabel} size="xl" closeOnBackdrop={!busy}
          footer={
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-500 truncate flex-1">
                {face.originalName || 'file'} · {formatSize(face.sizeBytes)}
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                ↻ Thay file
              </button>
              <button type="button" onClick={() => setConfirmDel(true)} disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                🗑 Xóa
              </button>
              <button type="button" onClick={onClose} disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-200 hover:bg-gray-300 disabled:opacity-50">
                Đóng
              </button>
              <input ref={fileInputRef} type="file" hidden accept="image/*,application/pdf"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleReplace(f); e.target.value = '' }} />
            </div>
          }
        >
          <div style={{ height: '65vh' }}>
            <ZoomablePreview
              filePath={face.url}
              fileName={face.originalName}
              title={scopeLabel}
              embedded
            />
          </div>
        </Modal>

        {confirmDel && (
          <ConfirmModal
            open title="Xóa mặt vé"
            message={`Xóa file "${face.originalName || 'mặt vé'}"?`}
            confirmLabel="Xóa" danger
            onConfirm={handleDelete}
            onCancel={() => setConfirmDel(false)}
          />
        )}
      </>
    )
  }

  // ── Trường hợp CHƯA có face → form upload ──────────────────
  return (
    <Modal open onClose={busy ? undefined : onClose} title={scopeLabel} size="md" closeOnBackdrop={!busy}>
      <div className="py-4">
        <div className="text-sm text-gray-600 mb-4">
          {scope === 'booking'
            ? 'Booking này ở chế độ mặt vé chung — chưa có file. Chọn 1 file PDF hoặc ảnh cho cả booking:'
            : 'Vé này chưa có mặt vé riêng. Chọn 1 file PDF hoặc ảnh:'}
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}
          className="w-full py-8 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/50
            text-blue-700 hover:bg-blue-50 hover:border-blue-500 disabled:opacity-50">
          <div className="text-4xl mb-2">📎</div>
          <div className="font-semibold text-sm">{busy ? 'Đang tải…' : 'Chọn file mặt vé'}</div>
          <div className="text-[11px] text-blue-500 mt-1">PDF hoặc ảnh (jpg, png…)</div>
        </button>
        <input ref={fileInputRef} type="file" hidden accept="image/*,application/pdf"
          onChange={e => { const f = e.target.files?.[0]; if (f) handlePickFile(f); e.target.value = '' }} />
      </div>
    </Modal>
  )
}

function formatSize(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}