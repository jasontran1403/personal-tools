import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Tab bar chung — 1 hàng nút full-width, active có gạch chân xanh.
 *
 * Dùng cho: trang /vmb (3 tab), và có thể tái sử dụng ở các trang mới sau này.
 *
 * Props:
 *   tabs      — [{ key, icon?, label, badge? }]
 *   active    — key đang được chọn (nếu điều khiển từ ngoài)
 *   onChange  — (newKey) => void
 *   syncParam — nếu truyền một tên (ví dụ 'tab'), sẽ đồng bộ với URL query
 *               ?tab=<key>. Reload trang giữ nguyên tab đang xem, back/forward
 *               của trình duyệt cũng chuyển tab. Bỏ qua nếu chỉ cần state trong RAM.
 *   sticky    — dán vào top (mặc định true) — cho phép nội dung cuộn phía dưới
 *
 * NOTE: khi dùng syncParam, `active`/`onChange` vẫn được ưu tiên — chỉ sync khi
 * URL đổi (do back/forward hoặc paste link).
 */
export default function Tabs({
  tabs,
  active,
  onChange,
  syncParam,
  sticky = true,
  className = '',
}) {
  const [searchParams, setSearchParams] = useSearchParams()

  // URL → state (khi người dùng bấm back/forward hoặc paste link)
  useEffect(() => {
    if (!syncParam) return
    const fromUrl = searchParams.get(syncParam)
    if (fromUrl && fromUrl !== active && tabs.some(t => t.key === fromUrl)) {
      onChange?.(fromUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleClick = key => {
    if (key === active) return
    onChange?.(key)
    if (syncParam) {
      const next = new URLSearchParams(searchParams)
      next.set(syncParam, key)
      setSearchParams(next, { replace: true })
    }
  }

  return (
    <div className={`${sticky ? 'sticky top-0 z-30' : ''} bg-white/85 backdrop-blur-xl border-b border-gray-200 ${className}`}>
      <div className="w-full px-4 sm:px-6 lg:px-8 flex items-center gap-1 overflow-x-auto
        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ key, icon, label, badge }) => {
          const isActive = key === active
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleClick(key)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 h-12 text-sm font-semibold
                border-b-2 -mb-px whitespace-nowrap shrink-0 transition-colors
                ${isActive
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {icon && <span>{icon}</span>}
              <span>{label}</span>
              {badge != null && badge !== '' && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold
                  ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
