import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

/**
 * ── DraftInvoiceModal ───────────────────────────────────────────────────
 * Drawer bên PHẢI màn hình, rộng 50dvw (full trên mobile).
 *   mode="PDF"     → bản thể hiện hóa đơn nháp (xem tạm từ VinVoice).
 *   mode="PENDING" → đã đẩy lên VinVoice nhưng kế toán CHƯA phát hành (vẫn nháp).
 *   mode="ISSUED"  → kế toán ĐÃ phát hành → bản thể hiện hóa đơn chính thức.
 *   mode="NONE"    → chưa từng đẩy nháp nào.
 *   mode="ERROR"   → lỗi gọi VinVoice.
 */
export default function DraftInvoiceModal({
  open, onClose, loading, mode, pdfBase64, error, pdfError,
  invoiceNo, issueDate, onCreatePending, creating, fileName,
}) {
  const pdfUrl = useMemo(() => {
    if (!pdfBase64) return null
    try {
      const bin = atob(pdfBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    } catch { return null }
  }, [pdfBase64])

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

  const issued = mode === 'ISSUED'
  const pending = mode === 'PENDING'

  const title = issued ? '✅ Hóa đơn đã phát hành'
    : pending ? '🧾 Hóa đơn chưa phát hành'
    : '🧾 Hóa đơn nháp'

  const issueDateText = issueDate ? new Date(issueDate).toLocaleDateString('vi-VN') : null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
      <div onMouseDown={(e) => e.stopPropagation()}
        className="relative h-full w-full sm:w-[50dvw] max-w-full bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <h2 className="text-sm sm:text-base font-semibold text-gray-900">{title}</h2>
          <div className="flex items-center gap-2">
            {pdfUrl && (
              <a href={pdfUrl} download={fileName || 'Invoice.pdf'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold
                  text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200"
                title={fileName || 'Invoice.pdf'}>
                <span>⬇</span> Tải PDF
              </a>
            )}
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

        {issued && (
          <div className="shrink-0 px-4 py-2.5 bg-emerald-50 border-b border-emerald-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <span className="font-semibold text-emerald-800">Đã phát hành</span>
            {invoiceNo && <span className="text-emerald-700">Số HĐ: <b>{invoiceNo}</b></span>}
            {issueDateText && <span className="text-emerald-700">Ngày: {issueDateText}</span>}
          </div>
        )}
        {pending && (
          <div className="shrink-0 px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-[13px] text-amber-800">
            <b>Chưa phát hành.</b> Kế toán chưa ký phát hành hóa đơn này trên VinVoice — đang hiển thị bản nháp.
          </div>
        )}

        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400">Đang kiểm tra trên VinVoice…</div>
          ) : pdfUrl ? (
            <iframe title="Hóa đơn VinVoice" src={`${pdfUrl}#zoom=70`} className="w-full h-full border-0" />
          ) : (
            <div className="h-full overflow-auto p-4 sm:p-6">
              <div className={`rounded-xl border p-4 sm:p-5 ${mode === 'NONE' ? 'border-sky-200 bg-sky-50' : 'border-rose-200 bg-rose-50'}`}>
                <div className={`flex items-center gap-2 font-semibold text-sm mb-2 ${mode === 'NONE' ? 'text-sky-700' : 'text-rose-700'}`}>
                  <span>{mode === 'NONE' ? 'ℹ' : '⚠'}</span>
                  {mode === 'NONE' ? 'Chưa có hóa đơn nháp' : 'Không lấy được hóa đơn'}
                </div>
                <div className={`text-[13px] whitespace-pre-wrap break-words leading-relaxed ${mode === 'NONE' ? 'text-sky-800' : 'text-rose-800'}`}>
                  {error || pdfError || 'Đã xảy ra lỗi khi gọi VinVoice.'}
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