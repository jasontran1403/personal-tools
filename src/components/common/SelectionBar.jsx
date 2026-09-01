/**
 * Thanh thao tác khi đang chọn nhiều mục — ghim đáy màn hình, kính mờ.
 * Dùng chung cho trang Hình ảnh và trang Tệp.
 *
 * albumAction: 'add' | 'remove'  — trong album thì nút thành Gỡ khỏi album
 * favoriteAction: 'favorite' | 'unfavorite' — có file đã thích thì thành Bỏ thích
 */
export default function SelectionBar({
  count, onDownload, onDelete, onCancel, onDeselectAll,
  onAddToAlbum, onRemoveFromAlbum, onFavorite,
  albumAction = 'add',
  favoriteAction = 'favorite',
  busy = false,
}) {
  const isRemoveAlbum = albumAction === 'remove'
  const isUnfavorite = favoriteAction === 'unfavorite'
  const onAlbumClick = isRemoveAlbum ? onRemoveFromAlbum : onAddToAlbum
  const showAlbumBtn = isRemoveAlbum ? !!onRemoveFromAlbum : !!onAddToAlbum

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-white/70 backdrop-blur-2xl
      border-t border-white/50 shadow-[0_-4px_24px_rgba(0,0,0,0.12)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-2">
        <button onClick={onCancel} disabled={busy}
          className="h-10 px-3 rounded-xl text-sm font-semibold text-gray-600 border border-white/60
            bg-white/50 backdrop-blur active:scale-95 transition disabled:opacity-50">
          Hủy
        </button>

        <div className="flex flex-col leading-tight px-1 min-w-0">
          <span className="text-sm font-semibold text-gray-700">Đã chọn {count}</span>
          <button onClick={onDeselectAll} disabled={busy || count === 0}
            className="text-[11px] text-blue-600 font-semibold text-left hover:underline disabled:text-gray-300 disabled:no-underline">
            Bỏ chọn tất cả
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {onFavorite && (
            <button onClick={onFavorite} disabled={busy || count === 0}
              className={`h-10 px-4 rounded-xl text-sm font-semibold text-white
                border shadow-lg backdrop-blur-md
                flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50
                ${isUnfavorite
                  ? 'bg-gray-600/90 border-gray-400/50 shadow-gray-500/25'
                  : 'bg-rose-600/90 border-rose-400/50 shadow-rose-500/25'}`}>
              <span className="text-base leading-none">{isUnfavorite ? '💔' : '❤️'}</span>
              <span className="hidden xs:inline sm:inline">
                {isUnfavorite ? 'Bỏ thích' : 'Thích'}
              </span>
            </button>
          )}

          {showAlbumBtn && (
            <button onClick={onAlbumClick} disabled={busy || count === 0}
              className={`h-10 px-4 rounded-xl text-sm font-semibold text-white
                border shadow-lg backdrop-blur-md
                flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50
                ${isRemoveAlbum
                  ? 'bg-amber-600/90 border-amber-400/50 shadow-amber-500/25'
                  : 'bg-purple-600/90 border-purple-400/50 shadow-purple-500/25'}`}>
              <span className="text-base leading-none">{isRemoveAlbum ? '📤' : '📂'}</span>
              <span className="hidden xs:inline sm:inline">
                {isRemoveAlbum ? 'Gỡ album' : 'Album'}
              </span>
            </button>
          )}

          <button onClick={onDownload} disabled={busy || count === 0}
            className="h-10 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600/90
              border border-blue-400/50 shadow-lg shadow-blue-500/25 backdrop-blur-md
              flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50">
            <span className="text-base leading-none">⬇</span>
            <span className="hidden xs:inline sm:inline">Tải về</span>
          </button>

          <button onClick={onDelete} disabled={busy || count === 0}
            className="h-10 px-4 rounded-xl text-sm font-semibold text-white bg-red-600/90
              border border-red-400/50 shadow-lg shadow-red-500/25 backdrop-blur-md
              flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50">
            <span className="text-base leading-none">🗑</span>
            <span className="hidden xs:inline sm:inline">Xóa</span>
          </button>
        </div>
      </div>
    </div>
  )
}