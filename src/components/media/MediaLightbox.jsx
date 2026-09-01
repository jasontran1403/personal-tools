import { useEffect, useRef, useState } from 'react'
import { mediaUrl, downloadFile } from '../../services/api'
import { fmtFullTime } from './groupByDate'
import { SkeletonMedia } from '../common/Skeleton'

const SWIPE_THRESHOLD = 50   // px — dưới mức này coi như chạm nhầm, không chuyển ảnh

/**
 * Xem tài nguyên toàn màn hình.
 *
 * Ảnh: hiển thị vừa khung. Video: player có sẵn điều khiển của trình duyệt
 * (tua được nhờ backend phục vụ file qua static resource handler hỗ trợ Range).
 *
 * Vuốt trái/phải để chuyển (áp dụng cho cả ảnh lẫn video),
 * hoặc dùng nút ‹ ›, hoặc phím mũi tên trên desktop.
 *
 * Thanh trên có: thả tim, đổi tên, tải về, xóa.
 * Đuôi file được backend giữ nguyên khi đổi tên — mất đuôi thì tải về máy
 * không mở được bằng ứng dụng nào.
 */
export default function MediaLightbox({
  items, index, onClose, onIndexChange, onDelete, onRename, onFavorite,
}) {
  const item = items[index]
  const touchStart = useRef(null)
  const [downloading, setDownloading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  /**
   * Ảnh/video gốc nặng hơn thumbnail rất nhiều, mở lightbox là một khoảng đen
   * kéo dài một hai giây. Khung xương lấp chỗ đó lại.
   *
   * `ready` phải reset mỗi lần đổi sang mục khác, không thì vuốt sang ảnh sau
   * sẽ hiện ảnh cũ cho tới khi ảnh mới tải xong.
   */
  const [ready, setReady] = useState(false)
  const mediaRef = useRef(null)

  useEffect(() => {
    setReady(false)
    // Ảnh đã nằm trong cache thì onLoad không bắn nữa — soi `complete` ở khung
    // hình kế tiếp để khung xương không kẹt lại vĩnh viễn
    const id = requestAnimationFrame(() => {
      const el = mediaRef.current
      if (el?.tagName === 'IMG' && el.complete && el.naturalWidth) setReady(true)
    })
    return () => cancelAnimationFrame(id)
  }, [item?.id])

  const isVideo = item?.mediaType === 'VIDEO'
  const canPrev = index > 0
  const canNext = index < items.length - 1

  const go = delta => {
    const next = index + delta
    if (next >= 0 && next < items.length) {
      setConfirmDelete(false)
      setRenaming(false)
      onIndexChange(next)
    }
  }

  // Phím tắt trên desktop
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length])   // eslint-disable-line react-hooks/exhaustive-deps

  // Khoá cuộn nền khi đang mở.
  //
  // Chỉ đặt body { overflow:hidden } là KHÔNG đủ trên iOS Safari — chạm rồi kéo
  // vẫn cuộn trang phía sau. Cách chắc ăn: ghim body ở position:fixed và bù lại
  // đúng scrollY, khi đóng thì trả về vị trí cũ.
  useEffect(() => {
    const scrollY = window.scrollY || window.pageYOffset || 0
    const body = document.body
    const saved = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    return () => {
      body.style.position = saved.position
      body.style.top = saved.top
      body.style.left = saved.left
      body.style.right = saved.right
      body.style.width = saved.width
      body.style.overflow = saved.overflow
      // Trả về đúng chỗ đang xem trước khi mở (thư viện phụ thuộc vị trí cuộn)
      window.scrollTo(0, scrollY)
    }
  }, [])

  // Vuốt ngang để chuyển ảnh/video (áp dụng cho cả hai)
  const onTouchStart = e => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  const onTouchEnd = e => {
    if (!touchStart.current) return
    const dx = e.changedTouches[0].clientX - touchStart.current.x
    const dy = e.changedTouches[0].clientY - touchStart.current.y
    touchStart.current = null

    // Chỉ tính là vuốt ngang khi lệch ngang rõ hơn lệch dọc + đủ xa
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return
    go(dx < 0 ? 1 : -1)
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      await downloadFile(item.url, item.originalName)
    } catch {
      alert('Không tải được file, vui lòng thử lại.')
    } finally {
      setDownloading(false)
    }
  }

  if (!item) return null

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col"
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>

      {/* Thanh trên */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 text-white/80"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <button onClick={onClose} aria-label="Đóng"
          className="w-10 h-10 shrink-0 rounded-full hover:bg-white/10 flex items-center justify-center text-xl">
          ✕
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm truncate">{item.originalName}</p>
          <p className="text-xs text-white/40">
            {index + 1} / {items.length} · {fmtFullTime(item.createdAt)}
          </p>
        </div>

        {onFavorite && (
          <button onClick={() => onFavorite(item)} aria-label="Yêu thích"
            className="w-10 h-10 shrink-0 rounded-full hover:bg-white/10 flex items-center justify-center">
            {item.favorite ? '❤️' : '🤍'}
          </button>
        )}
        {onRename && (
          <button
            onClick={() => { setDraftName(item.originalName || ''); setRenaming(r => !r); setConfirmDelete(false) }}
            aria-label="Đổi tên"
            className="w-10 h-10 shrink-0 rounded-full hover:bg-white/10 flex items-center justify-center">
            ✏️
          </button>
        )}

        <button onClick={handleDownload} disabled={downloading} aria-label="Tải về"
          className="w-10 h-10 shrink-0 rounded-full hover:bg-white/10 flex items-center justify-center disabled:opacity-40">
          {downloading ? '…' : '⬇'}
        </button>
        {onDelete && (
          <button onClick={() => { setConfirmDelete(c => !c); setRenaming(false) }} aria-label="Xóa"
            className="w-10 h-10 shrink-0 rounded-full hover:bg-white/10 flex items-center justify-center">
            🗑
          </button>
        )}
      </div>

      {renaming && (
        <div className="mx-3 mb-2 bg-white rounded-xl p-3 flex items-center gap-2">
          <input
            value={draftName}
            autoFocus
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && draftName.trim()) {
                onRename(item, draftName.trim()); setRenaming(false)
              }
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 outline-none focus:border-blue-400"
            placeholder="Tên hiển thị"
          />
          <button onClick={() => setRenaming(false)}
            className="px-3 py-2 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold shrink-0">Huỷ</button>
          <button
            disabled={!draftName.trim()}
            onClick={() => { onRename(item, draftName.trim()); setRenaming(false) }}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40 shrink-0">
            Lưu
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="mx-3 mb-2 bg-red-600/90 text-white text-sm rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="flex-1">Xóa vĩnh viễn file này?</span>
          <button onClick={() => setConfirmDelete(false)}
            className="px-3 py-1.5 rounded-lg bg-white/20 text-xs font-semibold">Huỷ</button>
          <button onClick={() => { setConfirmDelete(false); onDelete(item) }}
            className="px-3 py-1.5 rounded-lg bg-white text-red-600 text-xs font-bold">Xóa</button>
        </div>
      )}

      {/* Nội dung */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center px-2">
        {!ready && (
          <div className="absolute inset-0 pointer-events-none">
            <SkeletonMedia isVideo={isVideo} />
          </div>
        )}

        {isVideo ? (
          <video
            key={item.id}
            ref={mediaRef}
            src={mediaUrl(item.url)}
            controls
            playsInline
            autoPlay
            // loadeddata chứ không phải canplay: canplay có thể bắn trước khi
            // có khung hình nào, khung xương tắt đi để lộ ô đen
            onLoadedData={() => setReady(true)}
            onError={() => setReady(true)}
            className={`max-w-full max-h-full rounded-lg transition-opacity duration-300
              ${ready ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <img
            key={item.id}
            ref={mediaRef}
            src={mediaUrl(item.url)}
            alt={item.originalName}
            onLoad={() => setReady(true)}
            onError={() => setReady(true)}
            className={`max-w-full max-h-full object-contain select-none
              transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
            draggable={false}
          />
        )}

        {/* Nút chuyển — ẩn trên màn hình hẹp vì đã có vuốt 
        {canPrev && (
          <button onClick={() => go(-1)} aria-label="Trước"
            className="hidden sm:flex absolute left-3 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center text-2xl">
            ‹
          </button>
        )}
        {canNext && (
          <button onClick={() => go(1)} aria-label="Sau"
            className="hidden sm:flex absolute right-3 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center text-2xl">
            ›
          </button>
        )}
          */}
      </div>

      {/* Thanh dưới — chỉ hiện nút chuyển trên điện thoại 
      <div className="shrink-0 flex items-center justify-center gap-6 py-3 text-white/70 sm:hidden"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button onClick={() => go(-1)} disabled={!canPrev}
          className="px-5 py-2 rounded-full bg-white/10 disabled:opacity-30 text-lg">‹</button>
        <button onClick={() => go(1)} disabled={!canNext}
          className="px-5 py-2 rounded-full bg-white/10 disabled:opacity-30 text-lg">›</button>
      </div>
      */}
    </div>
  )
}