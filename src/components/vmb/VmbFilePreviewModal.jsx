import Modal from '../common/Modal'
import ZoomablePreview from './ZoomablePreview'

/**
 * VmbFilePreviewModal — overlay xem file (ảnh/PDF) đã upload trong Vmb module.
 *
 * ⚠ KHÔNG dùng file này cho FilesBrowser (quản lý tệp chung); FilesBrowser có
 * `components/files/FilePreviewModal.jsx` riêng với đầy đủ hỗ trợ docx/sql/
 * code/sheet. Hai file độc lập, tên khác nhau để không nhầm.
 *
 * Dùng chung cho (chỉ cần ảnh / PDF preview + zoom):
 *   - Hóa đơn (InvoiceManagerModal, InvoiceUploadModal)
 *   - Chứng từ booking (BookingProofModal)
 *   - Mặt vé (PresentationModal)
 *
 * ── 2026-10-09 ─────────────────────────────────────────────
 * Trước: các chỗ trên dùng `window.open(url, '_blank')` → mở tab mới, mất
 * context, không có preview sắc nét. Giờ: 1 modal "huge" (96dvw × 96dvh)
 * bọc <ZoomablePreview embedded /> — iframe PDF native dùng toolbar của
 * trình duyệt (zoom thật, không nhòe), ảnh dùng zoom CSS của
 * ZoomablePreview.
 *
 * Props:
 *   open      — hiện / ẩn
 *   onClose   — close callback
 *   filePath  — path tương đối "/vmb-files/…" (BẮT BUỘC)
 *   fileName  — tên gốc để đoán loại (pdf/img) + hiển thị trong tiêu đề
 *   title     — tiêu đề modal, nếu bỏ qua lấy từ fileName
 */
export default function VmbFilePreviewModal({ open, onClose, filePath, fileName, title }) {
  if (!open || !filePath) return null
  const modalTitle = title || fileName || 'Xem file'
  return (
    <Modal open onClose={onClose} title={modalTitle} size="huge" closeOnBackdrop>
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
          <ZoomablePreview
            filePath={filePath}
            fileName={fileName}
            title={modalTitle}
            embedded
          />
        </div>
      </div>
    </Modal>
  )
}