import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

/**
 * ── DraftInvoiceModal ───────────────────────────────────────────────────
 * Drawer bên PHẢI màn hình, rộng 50dvw (full trên mobile), xem hóa đơn nháp
 * lấy trực tiếp từ VinVoice.
 *   mode="PDF"   → iframe PDF (zoom mặc định ~70%).
 *   mode="ERROR" → hiển thị lỗi (không dựng bản tạm).
 *
 * Tự portal ra body + tự khóa scroll + Esc để đóng (không dùng Modal chung
 * vì cần canh phải + bề rộng riêng).
 */
export default function DraftInvoiceModal({ open, onClose, loading, mode, pdfBase64, error, onCreatePending, creating }) {
  const pdfUrl = useMemo(() => {
    if (mode !== 'PDF' || !pdfBase64) return null
    try {
      const bin = atob(pdfBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    } catch { return null }
  }, [mode, pdfBase64])

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
      <div onMouseDown={(e) => e.stopPropagation()}
        className="relative h-full w-full sm:w-[50dvw] max-w-full bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <h2 className="text-sm sm:text-base font-semibold text-gray-900">🧾 Hóa đơn nháp</h2>
          <div className="flex items-center gap-2">
            {/*
              2026-11-22: Đổi từ "Phát hành hóa đơn" → "Tạo hóa đơn chưa phát hành".
              Hành động giờ chỉ đẩy hóa đơn lên tab "Hóa đơn chưa phát hành" trên
              vinvoice.viettel.vn — KHÔNG ký USB token, KHÔNG có hiệu lực pháp lý.
              Kế toán vào web vinvoice để ký + phát hành thủ công hoặc xóa.
            */}
            {mode === 'PDF' && onCreatePending && (
              <button type="button" onClick={onCreatePending} disabled={creating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold
                  text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed
                  shadow-sm shadow-indigo-500/20">
                <span>📤</span> {creating ? 'Đang đẩy...' : 'Tạo hóa đơn chưa phát hành'}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Đóng"
              className="w-9 h-9 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex items-center justify-center">
            <svg viewBox="0 0 20 20" className="w-5 h-5" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400">Đang lấy hóa đơn nháp từ VinVoice…</div>
          ) : mode === 'PDF' && pdfUrl ? (
            <iframe title="Hóa đơn nháp VinVoice" src={`${pdfUrl}#zoom=70`} className="w-full h-full border-0" />
          ) : (
            <div className="h-full overflow-auto p-4 sm:p-6">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 sm:p-5">
                <div className="flex items-center gap-2 text-rose-700 font-semibold text-sm mb-2">
                  <span>⚠</span> Không lấy được hóa đơn nháp
                </div>
                <div className="text-[13px] text-rose-800 whitespace-pre-wrap break-words leading-relaxed">
                  {error || 'Đã xảy ra lỗi khi gọi VinVoice.'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}