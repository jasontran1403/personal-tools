import { useState, useEffect, useRef } from 'react'
import { listAlbums, createAlbum, deleteAlbum } from '../../services/api'

/**
 * Nút Album ở header + dropdown danh sách album.
 * Chọn album → gọi onSelect(albumId). Bỏ chọn → onSelect(null).
 */
export default function AlbumDropdown({ activeAlbumId, onSelect, onNotify, glassBtn }) {
  const [open, setOpen] = useState(false)
  const [albums, setAlbums] = useState([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const ref = useRef(null)

  // Đóng dropdown khi click bên ngoài
  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [open])

  // Tải danh sách album khi mở dropdown
  useEffect(() => {
    if (!open) return
    setLoading(true)
    ;(async () => {
      try {
        const res = await listAlbums()
        const env = res.data
        setAlbums(env?.data ?? env ?? [])
      } catch {
        onNotify?.('Không tải được album', false)
      } finally {
        setLoading(false)
      }
    })()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const res = await createAlbum(newName.trim())
      const env = res.data
      const album = env?.data ?? env
      setAlbums(prev => [album, ...prev])
      setNewName('')
      setCreating(false)
    } catch {
      onNotify?.('Tạo album thất bại', false)
    }
  }

  const handleDelete = async (e, albumId) => {
    e.stopPropagation()
    if (!confirm('Xóa album này? (ảnh sẽ không bị xóa)')) return
    try {
      await deleteAlbum(albumId)
      setAlbums(prev => prev.filter(a => a.id !== albumId))
      if (activeAlbumId === albumId) onSelect(null)
      onNotify?.('Đã xóa album')
    } catch {
      onNotify?.('Xóa album thất bại', false)
    }
  }

  const pick = id => {
    onSelect(activeAlbumId === id ? null : id)
    setOpen(false)
  }

  const activeAlbum = albums.find(a => a.id === activeAlbumId)
  const isActive = activeAlbumId != null

  return (
    <div ref={ref} className="relative flex-1">
      <button onClick={() => setOpen(v => !v)}
        className={`${glassBtn} ${isActive
          ? 'bg-purple-500/20 border-purple-300/60 text-purple-700'
          : 'bg-white/50 border-white/60 text-gray-600'} w-full`}>
        <span className="text-base leading-none">📂</span>
        <span className="truncate max-w-[60px]">{activeAlbum ? activeAlbum.name : 'Album'}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-2xl
          border border-gray-100 overflow-hidden z-50 min-w-[220px]"
          style={{ maxHeight: '60vh' }}>

          {/* Tất cả ảnh */}
          <button onClick={() => pick(null)}
            className={`w-full flex items-center gap-2.5 px-4 py-3 text-left text-sm transition
              ${!activeAlbumId ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-700 hover:bg-gray-50'}`}>
            <span className="text-lg">🖼️</span>
            <span className="flex-1">Tất cả ảnh</span>
          </button>

          <div className="border-t border-gray-100" />

          {/* Danh sách album */}
          <div className="max-h-[40vh] overflow-y-auto">
            {loading ? (
              <div className="py-4 text-center text-xs text-gray-400">Đang tải...</div>
            ) : albums.length === 0 ? (
              <div className="py-4 text-center text-xs text-gray-400">Chưa có album</div>
            ) : albums.map(a => (
              <button key={a.id} onClick={() => pick(a.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition group
                  ${activeAlbumId === a.id ? 'bg-purple-50 text-purple-700 font-bold' : 'text-gray-700 hover:bg-gray-50'}`}>
                <span className="text-lg">📁</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{a.name}</div>
                  <div className="text-[11px] text-gray-400 font-normal">{a.count} mục</div>
                </div>
                <span onClick={e => handleDelete(e, a.id)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs
                    text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100
                    transition shrink-0">✕</span>
              </button>
            ))}
          </div>

          <div className="border-t border-gray-100" />

          {/* Tạo album mới */}
          {creating ? (
            <div className="flex items-center gap-1.5 p-2.5">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Tên album..."
                className="flex-1 min-w-0 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg
                  text-sm outline-none focus:border-blue-400 placeholder:text-gray-400"
              />
              <button onClick={handleCreate} disabled={!newName.trim()}
                className="h-8 px-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600
                  disabled:opacity-50 active:scale-95 transition">Tạo</button>
              <button onClick={() => { setCreating(false); setNewName('') }}
                className="h-8 px-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition">✕</button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-left text-sm
                text-blue-600 font-semibold hover:bg-blue-50 transition">
              <span className="text-lg">＋</span> Tạo album mới
            </button>
          )}
        </div>
      )}
    </div>
  )
}
