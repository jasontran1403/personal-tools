import { useEffect, useRef } from 'react'

/**
 * ── 2026-10-09: Fix "trang bị kẹt không scroll được" ──────────
 * Trước đây mỗi Modal tự lưu `document.body.style.overflow` cũ rồi set
 * 'hidden', khi unmount thì khôi phục. Khi 2 modal lồng nhau (ví dụ
 * UploadOptionsModal mở ConfirmModal con), modal thứ hai lưu nhầm giá trị
 * đang là 'hidden' làm "giá trị cũ" → đóng xong body kẹt 'hidden' vĩnh viễn,
 * phải F5 mới hết. Chuyển sang reference-count toàn cục: chỉ khóa khi modal
 * đầu tiên mở, chỉ mở khóa khi modal cuối cùng đóng.
 */
let __modalLockCount = 0
let __prevBodyOverflow = ''
function acquireBodyScrollLock() {
  if (__modalLockCount === 0) {
    __prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  __modalLockCount++
}
function releaseBodyScrollLock() {
  __modalLockCount = Math.max(0, __modalLockCount - 1)
  if (__modalLockCount === 0) {
    document.body.style.overflow = __prevBodyOverflow
  }
}

/**
 * Modal chung — panel trắng ở giữa, backdrop tối mờ ở sau.
 *
 * Dùng cho: form user, form vé, thẻ thành viên, xem preview file... — bất cứ
 * chỗ nào cần lớp phủ toàn màn hình. Không nhét sẵn footer/header — bạn tự
 * dựng bên trong `children` để tự do bố cục.
 *
 * Props:
 *   open       — hiện/ẩn (component vẫn giữ trong cây, chỉ style hidden)
 *   onClose    — bấm backdrop hoặc phím Esc gọi hàm này (nếu closeOnBackdrop)
 *   title      — tiêu đề trên cùng, optional
 *   size       — 'sm' | 'md' | 'lg' | 'xl' | 'full'
 *   closeOnBackdrop — mặc định true; đặt false khi form đang dirty
 *   footer     — nội dung sát dưới, cách nội dung 1 đường mảnh
 *   children   — thân modal
 *
 * Body scroll bị khóa khi có modal mở — tránh cuộn ở dưới trong khi đang xem
 * modal (đặc biệt trên mobile).
 */
const SIZE = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-2xl',
  xl:   'max-w-4xl',
  huge: 'max-w-[96dvw]',
  full: 'max-w-[96vw]',
}

export default function Modal({
  open,
  onClose,
  title,
  size = 'md',
  closeOnBackdrop = true,
  footer,
  children,
}) {
  const panelRef = useRef(null)
  // Lưu callback mới nhất vào ref để effect KHÔNG phụ thuộc vào identity
  // của onClose / closeOnBackdrop (chúng đổi mỗi lần parent re-render,
  // khiến effect bị unmount–remount liên tục → hở khe khóa body overflow).
  const onCloseRef = useRef(onClose)
  const closeOnBackdropRef = useRef(closeOnBackdrop)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { closeOnBackdropRef.current = closeOnBackdrop }, [closeOnBackdrop])

  // Esc để đóng, khoá scroll trang khi mở (chỉ chạy khi `open` đổi)
  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (e.key === 'Escape' && closeOnBackdropRef.current) onCloseRef.current?.()
    }
    document.addEventListener('keydown', onKey)
    acquireBodyScrollLock()
    return () => {
      document.removeEventListener('keydown', onKey)
      releaseBodyScrollLock()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      onMouseDown={e => {
        // Chỉ đóng khi click NGOÀI panel — click trong panel rồi thả ra ngoài không tính
        if (closeOnBackdrop && !panelRef.current?.contains(e.target)) onClose?.()
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />

      {/* Panel. Size huge mở rộng cả max-h để tận dụng viewport. */}
      <div
        ref={panelRef}
        className={`relative w-full ${SIZE[size] || SIZE.md} bg-white rounded-2xl shadow-2xl
                    ${size === 'huge' ? 'max-h-[96dvh] h-[96dvh]' : 'max-h-[92vh]'}
                    flex flex-col overflow-hidden`}
        onMouseDown={e => e.stopPropagation()}
      >
        {(title || onClose) && (
          <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-4 border-b border-gray-100">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate">{title}</h2>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng"
                className="shrink-0 w-9 h-9 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700
                           flex items-center justify-center transition-colors"
              >
                <svg viewBox="0 0 20 20" className="w-5 h-5" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
                </svg>
              </button>
            )}
          </div>
        )}

        <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1">
          {children}
        </div>

        {footer && (
          <div className="px-5 sm:px-6 py-3 border-t border-gray-100 bg-gray-50">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}