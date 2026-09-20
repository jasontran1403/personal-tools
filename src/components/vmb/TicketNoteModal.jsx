import Modal from '../common/Modal'

/**
 * Modal chỉ để đọc ghi chú của 1 vé — mở khi user bấm icon note ở dòng vé.
 * Rất gọn: tiêu đề + block text preserve whitespace + nút đóng. Không cho
 * edit ở đây (edit qua form booking chính thức).
 */
export default function TicketNoteModal({ passengerName, note, onClose }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`Ghi chú — ${passengerName || 'vé'}`}
      size="sm"
      closeOnBackdrop
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300">
            Đóng
          </button>
        </div>
      }
    >
      {note ? (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-gray-800 whitespace-pre-wrap break-words">
          {note}
        </div>
      ) : (
        <div className="text-center text-sm text-gray-400 py-6">Vé này chưa có ghi chú.</div>
      )}
    </Modal>
  )
}
