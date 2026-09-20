import { useState } from 'react'
import Modal from '../common/Modal'
import BookingProofModal from './BookingProofModal'
import TicketFaceModal from './TicketFaceModal'
import InvoiceUploadModal from './InvoiceUploadModal'

/**
 * Modal "Upload" — 3 lựa chọn quyết định form/modal con sẽ mở:
 *   1) Thông tin booking → BookingProofModal
 *   2) Mặt vé           → TicketFaceModal (có sẵn — hỗ trợ cả 2 scope)
 *   3) Hóa đơn          → InvoiceUploadModal (mới, đơn giản)
 *
 * UX flow:
 *   Click nút "Upload" ở cột thao tác → mở modal này (3 nút to).
 *   Click 1 option → close self + mở modal con tương ứng.
 *   Close modal con → callback về TicketsTab để reload booking.
 *
 * State route qua {@code sub}:
 *   null       → hiện grid 3 lựa chọn
 *   'proof'    → BookingProofModal đang mở
 *   'face'     → TicketFaceModal đang mở
 *   'invoice'  → InvoiceUploadModal đang mở
 */
export default function UploadOptionsModal({ open, booking, onClose, onChanged }) {
  const [sub, setSub] = useState(null)
  // ── Fix 2026-09-20: nhớ ticketId đã pick trong TicketFaceModal ──
  // TicketFaceModal khi shared=false show picker "Chọn hành khách" và gọi
  // {booking._onPickTicket(id)}. Cũ: stub rỗng → click xong không upload
  // được. Nay: set state, TicketFaceModal render lại với ticketId đó và
  // hiện form upload cho khách đó.
  const [pickedTicketId, setPickedTicketId] = useState(null)

  if (!open || !booking) return null

  const closeAll = () => { setSub(null); setPickedTicketId(null); onClose() }
  const closeSub = () => { setSub(null); setPickedTicketId(null) }
  const handleChildChanged = () => { if (onChanged) onChanged() }

  // Nếu đang mở sub-modal → render nó thay cho grid
  if (sub === 'proof') {
    return (
      <BookingProofModal
        open={true}
        booking={booking}
        onClose={closeAll}
        onChanged={handleChildChanged}
      />
    )
  }
  if (sub === 'face') {
    // ── 2026-09-20 rewrite ────────────────────────────────────
    // Trước: pass {..booking, _onPickTicket} và để TicketFaceModal tự
    // render picker "Chọn hành khách". Bug: picker gọi onClose() TRƯỚC
    // _onPickTicket(), mà onClose ở đây = closeAll → unmount cả cây, state
    // setPickedTicketId gọi trên component đã dead → mất trắng. Modal bị
    // đóng ngang mà không mở form upload.
    //
    // Nay: TỰ render picker khi cần (shared=false + chưa có ticketId).
    // TicketFaceModal chỉ được mount khi đã biết đúng target — hoặc
    // booking-level (shared=true) hoặc 1 ticket cụ thể.

    if (booking.sharedTicketFace) {
      // Chế độ mặt vé chung → 1 file duy nhất, không cần picker
      return (
        <TicketFaceModal
          booking={booking}
          ticketId={null}
          onClose={closeAll}
          onDirty={handleChildChanged}
        />
      )
    }

    // Chế độ mặt vé riêng — chưa chọn khách → picker của mình
    if (pickedTicketId == null) {
      return (
        <PassengerPickerModal
          booking={booking}
          onPick={setPickedTicketId}
          onClose={closeAll}
        />
      )
    }

    // Đã chọn khách → mở TicketFaceModal đúng cho ticket đó.
    // Khi user close hoặc dirty (upload/xóa xong) → về picker để user có
    // thể chọn khách khác trong cùng session, thay vì đóng hết.
    return (
      <TicketFaceModal
        booking={booking}
        ticketId={pickedTicketId}
        onClose={() => setPickedTicketId(null)}
        onDirty={() => { handleChildChanged(); setPickedTicketId(null) }}
      />
    )
  }
  if (sub === 'invoice') {
    return (
      <InvoiceUploadModal
        open={true}
        booking={booking}
        onClose={closeAll}
        onChanged={handleChildChanged}
      />
    )
  }

  const opts = [
    {
      key: 'proof',
      icon: '📋',
      label: 'Thông tin booking',
      hint: 'Upload ảnh/PDF bằng chứng đặt chỗ (mail xác nhận, phiếu…)',
    },
    {
      key: 'face',
      icon: '🎫',
      label: 'Mặt vé',
      hint: booking.sharedTicketFace
        ? '1 file dùng chung cho cả booking'
        : 'Mỗi khách 1 mặt vé riêng',
    },
    {
      key: 'invoice',
      icon: '🧾',
      label: 'Hóa đơn',
      hint: 'Chọn nháp hay đã phát hành, sau đó chọn khách để áp',
    },
  ]

  return (
    <Modal open onClose={onClose}
      title={`Upload — ${booking.bookingCode || '(chưa có mã)'}`}
      size="lg">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {opts.map(o => (
          <button key={o.key} type="button"
            onClick={() => setSub(o.key)}
            className="text-left p-4 rounded-lg border border-gray-300 bg-white hover:border-blue-500 hover:shadow-md transition">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{o.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-bold text-gray-800">{o.label}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{o.hint}</div>
              </div>
            </div>
          </button>
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

// ══════════════════════════════════════════════════════════════
//  PASSENGER PICKER (khi mặt vé riêng)
// ══════════════════════════════════════════════════════════════
//
// Được UploadOptionsModal tự render (không phụ thuộc TicketFaceModal) để
// đảm bảo state pickedTicketId được set trên component còn sống, sau đó
// re-render sang TicketFaceModal đúng ticket.

function PassengerPickerModal({ booking, onPick, onClose }) {
  return (
    <Modal open onClose={onClose} title="Chọn hành khách" size="md" closeOnBackdrop>
      <div className="text-sm text-gray-600 mb-3">
        Booking này ở chế độ <b>mặt vé riêng từng khách</b>. Chọn hành khách để upload / xem mặt vé:
      </div>
      <div className="grid grid-cols-1 gap-2">
        {(booking?.tickets || []).map(t => (
          <button key={t.id} type="button"
            onClick={() => onPick(t.id)}
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