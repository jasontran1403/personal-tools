import { useState } from 'react'
import PdfEditor from './PdfEditor'
import ImageToPdfScanner from './ImageToPdfScanner'

/**
 * Tab Pdf — gom các tác vụ xử lý PDF ở client (không gọi BE).
 *
 * ── 2 chế độ ────────────────────────────────────────────────
 *   1. editor  — Upload file PDF, vẽ hộp trắng che thông tin, xoá bớt
 *                trang, xuất file PDF mới. Giống Sejda "White out".
 *   2. scanner — Upload ảnh chụp văn bản (có thể lệch góc, có đổ bóng).
 *                Người dùng kéo 4 góc theo mép giấy → warp phối cảnh về
 *                hình chữ nhật thẳng. Áp thuật toán "divide by blur" để
 *                triệt bóng. Xuất file PDF 1 trang (A4-ratio).
 *
 * ── Dependencies cần cài (nếu chưa có trong package.json) ──
 *   npm i pdf-lib pdfjs-dist
 *
 * Tất cả xử lý đều chạy client-side. BE không cần endpoint mới.
 */
export default function PdfTab() {
  const [mode, setMode] = useState('editor')  // 'editor' | 'scanner'

  return (
    <div className="w-full">
      {/* Switch 2 chế độ — segmented control */}
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex rounded-xl bg-gray-100 p-1">
          <SegBtn active={mode === 'editor'} onClick={() => setMode('editor')}>
            🖊️ Sửa PDF
          </SegBtn>
          <SegBtn active={mode === 'scanner'} onClick={() => setMode('scanner')}>
            📸 Scan ảnh → PDF
          </SegBtn>
        </div>
        <div className="text-[11px] text-gray-500 italic">
          Mọi xử lý chạy trong trình duyệt — file KHÔNG upload lên server.
        </div>
      </div>

      {mode === 'editor' ? <PdfEditor /> : <ImageToPdfScanner />}
    </div>
  )
}

function SegBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition
        ${active ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
      {children}
    </button>
  )
}
