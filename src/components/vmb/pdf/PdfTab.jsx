import { useState } from 'react'
import PdfEditor from './PdfEditor'
import ImageToPdfScanner from './ImageToPdfScanner'
import ImageEditor from './ImageEditor'

/**
 * Tab Pdf — gom các tác vụ xử lý ảnh / PDF ở client (không gọi BE).
 *
 * ── 3 chế độ ────────────────────────────────────────────────
 *   1. editor  — Sửa PDF. Vẽ hộp trắng che thông tin, xoá bớt trang,
 *                xuất file PDF mới. Giống Sejda "White out".
 *   2. scanner — Scan ảnh → PDF. Warp phối cảnh + xoá bóng + làm phẳng.
 *   3. image   — Sửa ảnh. Hiện tại: tách nền (remove background) bằng
 *                @imgly/background-removal (ONNX Runtime chạy WASM
 *                trong browser). Xuất PNG trong suốt.
 *
 * ── Dependencies cần cài ───────────────────────────────────
 *   npm i pdf-lib pdfjs-dist @imgly/background-removal
 *
 * Tất cả xử lý chạy client-side. BE không cần endpoint mới.
 */
export default function PdfTab() {
  const [mode, setMode] = useState('editor')  // 'editor' | 'scanner' | 'image'

  return (
    <div className="w-full">
      {/* Switch chế độ — segmented control */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="inline-flex rounded-xl bg-gray-100 p-1">
          <SegBtn active={mode === 'editor'} onClick={() => setMode('editor')}>
            🖊️ Sửa PDF
          </SegBtn>
          <SegBtn active={mode === 'scanner'} onClick={() => setMode('scanner')}>
            📸 Scan ảnh → PDF
          </SegBtn>
          <SegBtn active={mode === 'image'} onClick={() => setMode('image')}>
            🎨 Sửa ảnh
          </SegBtn>
        </div>
        <div className="text-[11px] text-gray-500 italic">
          Mọi xử lý chạy trong trình duyệt — file KHÔNG upload lên server.
        </div>
      </div>

      {mode === 'editor'  && <PdfEditor />}
      {mode === 'scanner' && <ImageToPdfScanner />}
      {mode === 'image'   && <ImageEditor />}
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