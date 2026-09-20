/**
 * Badge chung — chip nhỏ dùng để hiển thị trạng thái.
 *
 * Bảng màu chuẩn hoá: gray, blue, green, yellow, red, purple, indigo, pink.
 * Không phát minh màu mới ở component gọi — nếu thiếu, thêm vào bảng ở đây
 * để dùng chung; tránh hai nút "màu xanh" hai chỗ hoá ra khác nhau.
 *
 * Props:
 *   color   — mã màu (mặc định 'gray')
 *   size    — 'xs' | 'sm' | 'md' (mặc định 'sm')
 *   dot     — hiển thị chấm tròn nhỏ ở đầu (dùng cho trạng thái online/live)
 *   onClick — nếu có, badge có thể bấm được (giống nút mini)
 */
const COLOR = {
  gray:   'bg-gray-100 text-gray-700 border-gray-200',
  blue:   'bg-blue-100 text-blue-700 border-blue-200',
  green:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  red:    'bg-rose-100 text-rose-700 border-rose-200',
  purple: 'bg-purple-100 text-purple-700 border-purple-200',
  indigo: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  pink:   'bg-pink-100 text-pink-700 border-pink-200',
}

const DOT_COLOR = {
  gray: 'bg-gray-400', blue: 'bg-blue-500', green: 'bg-emerald-500',
  yellow: 'bg-amber-500', red: 'bg-rose-500', purple: 'bg-purple-500',
  indigo: 'bg-indigo-500', pink: 'bg-pink-500',
}

const SIZE = {
  xs: 'text-[10px] px-1.5 py-0.5 gap-1',
  sm: 'text-xs   px-2   py-0.5 gap-1.5',
  md: 'text-sm   px-2.5 py-1   gap-1.5',
}

export default function Badge({
  color = 'gray',
  size  = 'sm',
  dot   = false,
  onClick,
  className = '',
  children,
}) {
  const classes = `inline-flex items-center rounded-full border font-medium
    ${COLOR[color] || COLOR.gray} ${SIZE[size] || SIZE.sm}
    ${onClick ? 'cursor-pointer hover:brightness-95 active:scale-95 transition' : ''}
    ${className}`

  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={classes}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[color] || DOT_COLOR.gray}`} />}
      {children}
    </Tag>
  )
}
