import toast from 'react-hot-toast'
import { copyText } from '../../lib/clipboard'

/**
 * Ô label + value, click cả thẻ hoặc icon copy để chép value vào clipboard.
 * Dùng ở IdPresentationModal — nhân viên quầy nhấn 1 phát là copy được số
 * CCCD / hộ chiếu / họ tên rồi paste sang hệ thống check-in.
 *
 * Props:
 *   label     — nhãn ngắn ("Số CCCD", "Họ tên"...)
 *   value     — giá trị hiển thị + copy
 *   mono      — dùng font mono (số CCCD/PP nên bật)
 *   display   — nếu muốn hiển thị khác giá trị copy
 *   copyLabel — toast text, mặc định "Đã copy {label}"
 *   suffix    — ReactNode chèn ngay cạnh value (VD: badge "còn lại")
 */
export default function CopyableField({ label, value, display, mono, copyLabel, suffix }) {
  const shownText = display != null ? display : (value || '—')
  const hasValue = value != null && value !== ''

  const doCopy = async () => {
    if (!hasValue) return
    const ok = await copyText(String(value))
    if (ok) toast.success(copyLabel || `Đã copy ${label.toLowerCase()}`)
    else toast.error('Không copy được')
  }

  return (
    <button type="button" onClick={doCopy} disabled={!hasValue}
      className={`w-full text-left p-2.5 rounded-lg border transition group
        ${hasValue
          ? 'bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50/60 cursor-pointer'
          : 'bg-gray-50 border-gray-100 cursor-default'}`}
      title={hasValue ? `Click để copy "${value}"` : 'Chưa có dữ liệu'}>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
          {label}
        </div>
        {hasValue && (
          <span className="text-[10px] text-gray-400 group-hover:text-blue-600 opacity-0 group-hover:opacity-100 transition">
            📋 Copy
          </span>
        )}
      </div>
      <div className={`flex items-center gap-2 flex-wrap text-sm ${hasValue ? 'text-gray-900 font-medium' : 'text-gray-300 italic'} ${mono ? 'font-mono' : ''}`}>
        <span className="break-words">{shownText}</span>
        {suffix /* 👈 badge hiển thị ở đây */}
      </div>
    </button>
  )
}