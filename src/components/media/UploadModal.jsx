import { useState, useRef, useEffect } from 'react'
import { uploadOneFile, CHUNK_THRESHOLD } from '../../services/api'

/**
 * Hộp thoại chọn và tải file lên.
 *
 * Luồng: chọn file → xem lại danh sách (có thumbnail, đổi ý thì xóa bớt) →
 * bấm Tải lên → theo dõi tiến độ từng file.
 *
 * Hiển thị chi tiết: số file đã upload / tổng, dung lượng đã gửi / tổng,
 * tốc độ trung bình (MB/s), và thời gian ước tính còn lại (ETA).
 */

/** Định dạng đơn vị lớn nhất — 11111 MB → 11.11 GB */
const fmtSize = bytes => {
  if (bytes == null || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes < 1024 ** 4) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`
  return `${(bytes / (1024 ** 4)).toFixed(2)} TB`
}

const fmtSpeed = bytesPerSec => {
  if (!bytesPerSec || bytesPerSec <= 0) return '—'
  return `${fmtSize(bytesPerSec)}/s`
}

const fmtDuration = seconds => {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = Math.ceil(seconds % 60)
    return `${m}m ${s}s`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

export default function UploadModal({ onClose, onDone, onNotify }) {
  const [entries, setEntries] = useState([])   // { id, file, preview, status, progress, error }
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // ── Thống kê tổng hợp khi đang upload ──
  const [stats, setStats] = useState(null) // { doneCount, totalCount, bytesSent, bytesTotal, startTime, speed, eta }

  // Thu hồi object URL khi đóng để không rò rỉ bộ nhớ
  useEffect(() => () => {
    entries.forEach(e => { if (e.preview) URL.revokeObjectURL(e.preview) })
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = e => {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    if (!picked.length) return

    const next = picked.map(file => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      isVideo: file.type.startsWith('video/') || /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(file.name),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      status: 'pending',
      progress: 0,
      error: null,
    }))
    setEntries(prev => [...prev, ...next])
  }

  const removeEntry = id => {
    setEntries(prev => {
      const found = prev.find(e => e.id === id)
      if (found?.preview) URL.revokeObjectURL(found.preview)
      return prev.filter(e => e.id !== id)
    })
  }

  const clearAll = () => {
    entries.forEach(e => { if (e.preview) URL.revokeObjectURL(e.preview) })
    setEntries([])
  }

  const patch = (id, data) =>
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...data } : e))

  const startUpload = async () => {
    const queue = entries.filter(e => e.status !== 'done')
    if (!queue.length) return

    setBusy(true)
    let ok = 0, fail = 0
    const totalCount = queue.length
    const bytesTotal = queue.reduce((s, e) => s + e.file.size, 0)
    let bytesDonePrev = 0        // bytes of fully finished files
    let currentFileProgress = 0  // 0-100 for current file
    const startTime = Date.now()

    const updateStats = (doneCount, currentIdx) => {
      const now = Date.now()
      const elapsed = (now - startTime) / 1000
      const currentFileBytes = queue[currentIdx]?.file.size || 0
      const bytesSent = bytesDonePrev + (currentFileProgress / 100) * currentFileBytes
      const speed = elapsed > 0.5 ? bytesSent / elapsed : 0
      const bytesRemaining = bytesTotal - bytesSent
      const eta = speed > 0 ? bytesRemaining / speed : 0

      setStats({
        doneCount, totalCount, bytesSent, bytesTotal,
        startTime, speed, eta,
      })
    }

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i]
      currentFileProgress = 0
      patch(entry.id, { status: 'uploading', progress: 0, error: null })
      updateStats(ok + fail, i)

      try {
        await uploadOneFile(entry.file, p => {
          currentFileProgress = p
          patch(entry.id, { progress: p })
          updateStats(ok + fail, i)
        })
        patch(entry.id, { status: 'done', progress: 100 })
        bytesDonePrev += entry.file.size
        ok++
        updateStats(ok + fail, i)
      } catch (err) {
        patch(entry.id, {
          status: 'error',
          error: err.response?.data?.message || err.message || 'Lỗi không xác định',
        })
        bytesDonePrev += entry.file.size // count errored file size too for progress
        fail++
        updateStats(ok + fail, i)
      }
    }

    setBusy(false)
    setStats(null)
    onNotify?.(
      fail === 0 ? `Đã tải lên ${ok} file` : `${ok} file thành công, ${fail} file lỗi`,
      fail === 0
    )
    if (ok > 0) onDone?.()
    if (fail === 0) onClose?.()
  }

  const pendingCount = entries.filter(e => e.status !== 'done').length
  const totalSize = entries.reduce((sum, e) => sum + e.file.size, 0)

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose?.() }}>

      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ height: 'min(80svh, 620px)' }}>

        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-900 text-base">Tải lên</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {entries.length ? `${entries.length} file · ${fmtSize(totalSize)}` : 'Ảnh và video'}
            </p>
          </div>
          <button onClick={() => !busy && onClose?.()} disabled={busy}
            className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 text-xl disabled:opacity-30">
            ×
          </button>
        </div>

        {/* ── Thanh thống kê khi đang upload ── */}
        {stats && (
          <div className="shrink-0 px-5 py-3 border-b border-gray-100 bg-blue-50/60">
            {/* Thanh tổng tiến độ */}
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-2.5">
              <div className="h-full bg-blue-600 transition-all duration-300 rounded-full"
                style={{ width: `${stats.bytesTotal > 0 ? Math.min(100, (stats.bytesSent / stats.bytesTotal) * 100) : 0}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
              <span>
                <span className="font-semibold text-gray-800">{stats.doneCount}</span>
                <span className="text-gray-400">/{stats.totalCount}</span> file
              </span>
              <span>
                <span className="font-semibold text-gray-800">{fmtSize(stats.bytesSent)}</span>
                <span className="text-gray-400">/{fmtSize(stats.bytesTotal)}</span>
              </span>
              <span title="Tốc độ">⚡ {fmtSpeed(stats.speed)}</span>
              <span title="Thời gian còn lại">⏱ {fmtDuration(stats.eta)}</span>
            </div>
          </div>
        )}

        {/* Danh sách — chiều cao hộp thoại cố định, nhiều file thì cuộn */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 text-center
              hover:border-blue-400 transition-colors disabled:opacity-40"
          >
            <div className="text-3xl mb-1.5">📁</div>
            <p className="font-semibold text-gray-700 text-sm">Chọn ảnh hoặc video</p>
            <p className="text-xs text-gray-400 mt-1">Chọn được nhiều file cùng lúc</p>
          </button>
          <input ref={inputRef} type="file" hidden multiple
            accept="image/*,video/*,.heic,.heif" onChange={addFiles} />

          {entries.map(entry => (
            <div key={entry.id}
              className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-100 bg-gray-50/60">

              <div className="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-gray-200 flex items-center justify-center">
                {entry.preview
                  ? <img src={entry.preview} alt="" className="w-full h-full object-cover" />
                  : <span className="text-lg">{entry.isVideo ? '🎬' : '📄'}</span>}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{entry.file.name}</p>
                <p className="text-xs text-gray-400">
                  {fmtSize(entry.file.size)}
                  {entry.file.size > CHUNK_THRESHOLD && ' · chia nhỏ'}
                </p>

                {entry.status === 'uploading' && (
                  <div className="mt-1.5 h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 transition-all duration-200"
                      style={{ width: `${entry.progress}%` }} />
                  </div>
                )}
                {entry.status === 'error' && (
                  <p className="text-xs text-red-600 mt-0.5">{entry.error}</p>
                )}
              </div>

              <div className="shrink-0 w-9 text-center">
                {entry.status === 'uploading' ? (
                  <span className="text-xs font-bold text-blue-600 tabular-nums">{entry.progress}%</span>
                ) : entry.status === 'done' ? (
                  <span className="text-emerald-600">✓</span>
                ) : entry.status === 'error' ? (
                  <span className="text-red-500">⚠️</span>
                ) : (
                  <button onClick={() => removeEntry(entry.id)} disabled={busy}
                    className="w-8 h-8 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-30">
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3.5 border-t border-gray-100 flex items-center gap-3">
          {entries.length > 0 && !busy && (
            <button onClick={clearAll} className="btn-ghost text-gray-400 hover:text-red-500 text-xs">
              Xóa hết
            </button>
          )}
          <button onClick={startUpload} disabled={busy || pendingCount === 0}
            className="btn-primary ml-auto justify-center min-w-[140px]">
            {busy ? 'Đang tải lên...' : `⬆ Tải lên${pendingCount ? ` (${pendingCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}