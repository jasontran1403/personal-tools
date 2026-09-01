import { useState, useEffect } from 'react'
import { listAlbums, createAlbum, addToAlbum } from '../../services/api'

/**
 * Modal chọn album để thêm ảnh vào.
 * Hiển thị danh sách album hiện có (tên + số lượng ảnh) + nút tạo mới.
 */
export default function AlbumPickerModal({ assetIds = [], onClose, onDone, onNotify }) {
  const [albums, setAlbums] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await listAlbums()
        const env = res.data
        setAlbums(env?.data ?? env ?? [])
      } catch {
        onNotify?.('Không tải được danh sách album', false)
      } finally {
        setLoading(false)
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      const res = await createAlbum(newName.trim())
      const env = res.data
      const album = env?.data ?? env
      setAlbums(prev => [album, ...prev])
      setNewName('')
      setCreating(false)
    } catch {
      onNotify?.('Tạo album thất bại', false)
    } finally {
      setBusy(false)
    }
  }

  const handlePick = async (albumId, albumName) => {
    setBusy(true)
    try {
      await addToAlbum(albumId, assetIds)
      onNotify?.(`Đã thêm ${assetIds.length} mục vào "${albumName}"`)
      onDone?.()
    } catch {
      onNotify?.('Thêm vào album thất bại', false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center"
      onClick={busy ? undefined : onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl
        max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">Thêm vào album</h3>
          <button onClick={onClose} disabled={busy}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500
              hover:bg-gray-200 transition text-lg leading-none">×</button>
        </div>

        {/* Nút tạo mới */}
        <div className="px-5 py-3 border-b border-gray-100">
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Tên album mới..."
                className="flex-1 min-w-0 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm
                  outline-none focus:border-blue-400 transition placeholder:text-gray-400"
              />
              <button onClick={handleCreate} disabled={busy || !newName.trim()}
                className="h-9 px-3 rounded-lg text-sm font-semibold text-white bg-blue-600
                  disabled:opacity-50 active:scale-95 transition">Tạo</button>
              <button onClick={() => setCreating(false)} disabled={busy}
                className="h-9 px-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition">Hủy</button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="w-full h-11 rounded-xl border-2 border-dashed border-gray-300 text-sm font-semibold
                text-gray-500 hover:border-blue-400 hover:text-blue-600 transition active:scale-[.98]
                flex items-center justify-center gap-2">
              <span className="text-lg leading-none">＋</span> Tạo album mới
            </button>
          )}
        </div>

        {/* Danh sách album */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Đang tải...</div>
          ) : albums.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">Chưa có album nào</div>
          ) : albums.map(a => (
            <button key={a.id} onClick={() => handlePick(a.id, a.name)} disabled={busy}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50
                active:bg-gray-100 transition disabled:opacity-50 text-left">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-blue-50
                flex items-center justify-center text-2xl shrink-0">📁</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 truncate">{a.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">{a.count} mục</div>
              </div>
              <span className="text-gray-300 text-lg">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
