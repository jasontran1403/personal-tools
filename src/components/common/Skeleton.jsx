/**
 * Khung xương chờ tải.
 *
 * Vì sao cần: ảnh và PDF nặng mất một hai giây mới hiện, trong lúc đó khung
 * preview là một mảng đen trống rỗng — người dùng tưởng hỏng và bấm lại. Một
 * khối xám nhấp nháy đúng hình dạng nội dung sắp tới thì cảm giác "đang chạy"
 * rõ ràng, mà lại không nhảy layout khi nội dung thật vào chỗ.
 *
 * Keyframes để ngay trong file cho component tự chứa, khỏi phải nhớ sửa
 * index.css khi mang sang dự án khác.
 */

export function SkeletonStyles() {
  return (
    <style>{`
      @keyframes skShimmer {
        0%   { background-position: -600px 0; }
        100% { background-position:  600px 0; }
      }
      .sk {
        background: linear-gradient(90deg, #eef1f5 25%, #f7f9fb 50%, #eef1f5 75%);
        background-size: 600px 100%;
        animation: skShimmer 1.4s linear infinite;
      }
      .sk-dark {
        background: linear-gradient(90deg, #1f2226 25%, #2b3036 50%, #1f2226 75%);
        background-size: 600px 100%;
        animation: skShimmer 1.4s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .sk, .sk-dark { animation: none; }
      }
    `}</style>
  )
}

/** Một khối xám bo góc. dark = dùng trên nền tối (lightbox) */
export function SkeletonBox({ className = '', dark = false, style }) {
  return <div className={`${dark ? 'sk-dark' : 'sk'} rounded-lg ${className}`} style={style} />
}

/** Vài dòng chữ giả, dòng cuối ngắn lại cho giống đoạn văn thật */
export function SkeletonLines({ lines = 3, className = '', dark = false }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBox key={i} dark={dark} className="h-3"
          style={{ width: i === lines - 1 ? '55%' : `${88 - (i % 3) * 9}%` }} />
      ))}
    </div>
  )
}

/** Chờ ảnh/video trong lightbox — nền tối, ô lớn giữa màn hình */
export function SkeletonMedia({ isVideo = false }) {
  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div className="relative w-full max-w-3xl aspect-[4/3] max-h-full">
        <SkeletonBox dark className="w-full h-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/25">
          <span className="text-4xl">{isVideo ? '🎬' : '🖼️'}</span>
          <span className="text-xs">Đang tải {isVideo ? 'video' : 'ảnh'}...</span>
        </div>
      </div>
    </div>
  )
}

/** Chờ bảng tính — vẽ sẵn lưới nên nội dung thật vào chỗ không bị giật */
export function SkeletonSheet({ rows = 12, cols = 6 }) {
  return (
    <div className="p-3">
      <div className="flex gap-1 mb-1">
        {Array.from({ length: cols }).map((_, c) => (
          <SkeletonBox key={c} className="h-7 flex-1 min-w-[70px]" />
        ))}
      </div>
      <div className="space-y-1">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-1">
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonBox key={c} className="h-7 flex-1 min-w-[70px]"
                style={{ opacity: 1 - r * 0.05 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Chờ tài liệu — giả lập trang giấy A4 có tiêu đề và các đoạn văn */
export function SkeletonDoc() {
  return (
    <div className="mx-auto max-w-3xl bg-white rounded-xl p-8 sm:p-12 shadow-sm">
      <SkeletonBox className="h-7 w-2/3 mb-6" />
      <SkeletonLines lines={4} className="mb-6" />
      <SkeletonBox className="h-5 w-1/3 mb-4" />
      <SkeletonLines lines={5} className="mb-6" />
      <SkeletonLines lines={3} />
    </div>
  )
}

/** Chờ mã nguồn — nền tối như IDE, độ dài dòng ngẫu nhiên nhưng ổn định */
export function SkeletonCode({ lines = 16 }) {
  return (
    <div className="p-4 space-y-2.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex gap-3 items-center">
          <SkeletonBox dark className="h-3 w-6 shrink-0" />
          <SkeletonBox dark className="h-3"
            style={{ width: `${25 + ((i * 37) % 60)}%`, marginLeft: `${(i % 4) * 14}px` }} />
        </div>
      ))}
    </div>
  )
}

/** Chờ danh sách tệp — khớp đúng bố cục một dòng ở trang Tệp */
export function SkeletonFileRows({ rows = 6 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-xl border border-gray-100 bg-white">
          <SkeletonBox className="w-10 h-10 shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <SkeletonBox className="h-3.5" style={{ width: `${45 + ((i * 23) % 35)}%` }} />
            <SkeletonBox className="h-2.5 w-28" />
          </div>
          <SkeletonBox className="h-6 w-14 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/** Chờ lưới ảnh ở trang Hình ảnh — luôn 5 cột giống gallery */
export function SkeletonTiles({ count = 12 }) {
  return (
    <div className="grid gap-1.5"
      style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBox key={i} className="aspect-square" />
      ))}
    </div>
  )
}