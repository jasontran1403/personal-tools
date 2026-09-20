import { Toaster, ToastBar, toast } from 'react-hot-toast'

/**
 * Wrapper cho react-hot-toast với 2 khác biệt so với mặc định:
 *
 *  1. Click vào bất kỳ đâu trên toast → đóng ngay lập tức. UX quen thuộc từ
 *     các app di động — không phải chờ auto-dismiss xong.
 *
 *  2. Thanh timer ở đáy toast — hiển thị trực quan bao lâu nữa nó sẽ tự đóng.
 *     Chạy bằng CSS animation (không setInterval để nhẹ), thu về từ trái sang
 *     phải trong đúng {@code duration} ms mà react-hot-toast tự đếm.
 *
 * Không thay đổi API bên gọi — vẫn dùng {@code toast.success('...')},
 * {@code toast.error('...')} bình thường. Chỉ khác ở tầng hiển thị.
 *
 * ── Vì sao dùng render prop thay vì thay từng lời gọi toast? ────────────
 * Có ~50 chỗ trong codebase gọi toast.success/error. Nếu buộc dùng
 * toastEx.success thì phải sửa từng file — dễ sót. Toaster nhận children là
 * render function bao trọn mọi toast, override một chỗ áp dụng tất cả.
 *
 * ── Vì sao style keyframes bằng <style> inline? ─────────────────────────
 * Để component tự chứa, không phụ thuộc index.css. Multiple render tạo nhiều
 * <style> giống nhau — vô hại (browser dedup).
 */
export default function AppToaster({ position = 'top-right' }) {
  return (
    <>
      <style>{`
        @keyframes app-toast-progress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
      <Toaster
        position={position}
        toastOptions={{
          duration: 3000,
          style: {
            background: '#1f2937',
            color: '#fff',
            fontSize: 13,
            padding: 0,           // padding tự lo trong render → không thừa quanh progress bar
            maxWidth: 380,
          },
        }}
      >
        {(t) => (
          <ToastBar toast={t} style={{ padding: 0, background: 'transparent', boxShadow: 'none' }}>
            {({ icon, message }) => (
              <div
                onClick={() => toast.dismiss(t.id)}
                title="Bấm để đóng"
                className="cursor-pointer rounded-lg shadow-lg bg-gray-800 text-white overflow-hidden min-w-[200px]"
                style={{ pointerEvents: 'auto' }}
              >
                <div className="flex items-center gap-2 px-3.5 py-2.5 text-[13px] leading-snug">
                  <span className="shrink-0 flex items-center">{icon}</span>
                  <div className="flex-1 min-w-0">{message}</div>
                </div>

                {/* Progress bar — ẩn khi loading (không có duration cố định)
                    hoặc khi duration = Infinity (toast dính lại) */}
                {t.type !== 'loading' && t.duration && t.duration !== Infinity && (
                  <div className="h-0.5 bg-white/10 relative">
                    <div
                      className="absolute top-0 left-0 h-full bg-white/50"
                      style={{
                        animation: `app-toast-progress ${t.duration}ms linear forwards`,
                        // Pause khi toast bị hover — react-hot-toast dừng đồng hồ khi hover,
                        // animationPlayState theo cùng để bar khớp
                        animationPlayState: t.pauseDuration ? 'paused' : 'running',
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </ToastBar>
        )}
      </Toaster>
    </>
  )
}
