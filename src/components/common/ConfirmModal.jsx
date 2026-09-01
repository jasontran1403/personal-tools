/**
 * Hộp thoại xác nhận dùng chung (xóa, thao tác nguy hiểm...).
 *
 * <ConfirmModal
 *    open={...}
 *    title="Xóa 12 mục?"
 *    message="Hành động này không thể hoàn tác."
 *    confirmLabel="Xóa"
 *    danger
 *    busy={deleting}
 *    onConfirm={...}
 *    onCancel={...}
 * />
 */
export default function ConfirmModal({
  open,
  title = 'Xác nhận',
  message = '',
  confirmLabel = 'Đồng ý',
  cancelLabel = 'Hủy',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      onClick={busy ? undefined : onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-lg
              ${danger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
              {danger ? '🗑' : '❓'}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900">{title}</h3>
              {message && <p className="mt-1 text-sm text-gray-500 leading-relaxed">{message}</p>}
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-4 pt-0">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 h-11 rounded-xl border border-gray-200 bg-white text-sm font-semibold
              text-gray-600 hover:bg-gray-50 active:scale-95 transition disabled:opacity-50">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={busy}
            className={`flex-1 h-11 rounded-xl text-sm font-semibold text-white active:scale-95 transition
              disabled:opacity-60 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}>
            {busy ? 'Đang xử lý...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
