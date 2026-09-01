import { useState, useRef, useEffect, useCallback } from 'react'
import { fetchWatermarkLogo, watermarkAndSave, listMedia, listAlbums, mediaUrl } from '../../services/api'

/**
 * Gắn watermark lên ảnh hoặc video — TỰ NHẬN DIỆN loại file, không chia 2 tab.
 *
 * Preview khớp tuyệt đối với file xuất ra vì cả frontend và backend dùng chung
 * công thức:
 *     wmW = mediaWidth * scale
 *     wmH = wmW * (logoH / logoW)
 *     tâm watermark tại (x% * mediaWidth, y% * mediaHeight)
 *
 * Canvas là bề mặt hiển thị DUY NHẤT (thẻ <video> bị ẩn, chỉ làm nguồn khung
 * hình) nên toạ độ chuột/chạm không thể lệch so với ảnh đang thấy.
 */

const DEFAULTS = { x: 50, y: 70, scale: 0.28, rotation: 0, opacity: 1 }

/** Trần độ đậm. 1 = như file logo gốc, >1 = vẽ chồng nhiều lượt cho đậm hơn. */
const MAX_OPACITY = 2.5

/**
 * Canvas (và cả ffmpeg) chỉ nhận alpha tối đa 1.0, không có cách nào làm ảnh
 * "đậm hơn chính nó" trong một lượt vẽ. Cách duy nhất là VẼ CHỒNG nhiều lượt:
 * 180% = 1 lượt alpha 1.0 + 1 lượt alpha 0.8.
 * Backend dùng đúng công thức này nên preview khớp với file xuất ra.
 */
const alphaPasses = opacity => {
  const out = []
  let remain = Math.max(0, opacity)
  while (remain > 0.001 && out.length < 4) {
    out.push(Math.min(1, remain))
    remain -= 1
  }
  return out.length ? out : [0]
}

const POSITION_PRESETS = [
  { label: '↖', x: 15, y: 15 }, { label: '↑', x: 50, y: 15 }, { label: '↗', x: 85, y: 15 },
  { label: '←', x: 15, y: 50 }, { label: '•', x: 50, y: 50 }, { label: '→', x: 85, y: 50 },
  { label: '↙', x: 15, y: 85 }, { label: '↓', x: 50, y: 85 }, { label: '↘', x: 85, y: 85 },
]

const fmtEta = sec => {
  if (sec == null || !Number.isFinite(sec)) return '…'
  if (sec < 1) return '<1s'
  if (sec < 60) return `${Math.ceil(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.ceil(sec % 60)
  return `${m}p${String(s).padStart(2, '0')}s`
}

const fmtBytes = b => {
  if (!b || b < 1024) return `${b || 0} B`
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

export default function WatermarkEditor({ onSaved, onNotify }) {
  const [file, setFile] = useState(null)
  const [kind, setKind] = useState('image')
  const [previewUrl, setUrl] = useState(null)
  const [logo, setLogo] = useState(null)
  const [settings, setSettings] = useState(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [saveEta, setSaveEta] = useState(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [firstFrame, setFirst] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)

  const [showMediaPicker, setMediaPicker] = useState(false)
  const [libLoading, setLibLoading] = useState(false)
  const [libProgress, setLibProgress] = useState(0)
  const [libLoaded, setLibLoaded] = useState(0)
  const [libTotal, setLibTotal] = useState(0)
  const [libEta, setLibEta] = useState(null)
  const [libName, setLibName] = useState('')

  const canvasRef = useRef(null)
  const videoRef = useRef(null)
  const imgRef = useRef(null)
  const rafRef = useRef(null)
  const inputRef = useRef(null)
  const dragRef = useRef(null)
  const libAbortRef = useRef(null)
  const saveAbortRef = useRef(null)

  const isVideo = kind === 'video'

  // ── Tải logo ────────────────────────────────────────────────────
  useEffect(() => {
    let objectUrl
    fetchWatermarkLogo()
      .then(res => {
        objectUrl = URL.createObjectURL(res.data)
        const img = new Image()
        img.onload = () => setLogo(img)
        img.src = objectUrl
      })
      .catch(() => setError('Không tải được logo watermark từ máy chủ'))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  // Hủy request khi unmount
  useEffect(() => () => {
    libAbortRef.current?.abort()
    saveAbortRef.current?.abort()
  }, [])

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null); setUrl(null); imgRef.current = null
    setPlaying(false); setDuration(0); setCurrent(0); setFirst(false); setError('')
  }

  const pickFile = e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return

    const byMime = f.type.startsWith('video/') ? 'video'
      : f.type.startsWith('image/') ? 'image' : null
    const byExt = /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(f.name) ? 'video'
      : /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(f.name) ? 'image' : null
    const detected = byMime || byExt

    if (!detected) { setError('Chỉ hỗ trợ file ảnh hoặc video'); return }

    reset()
    setKind(detected)
    setFile(f)
    setUrl(URL.createObjectURL(f))
  }

  // ── Vẽ ──────────────────────────────────────────────────────────
  const drawOverlay = useCallback((ctx, w, h) => {
    if (!logo) return
    const wmW = w * settings.scale
    const wmH = wmW * (logo.height / logo.width)

    ctx.save()
    ctx.translate((settings.x / 100) * w, (settings.y / 100) * h)
    ctx.rotate((settings.rotation * Math.PI) / 180)
    for (const alpha of alphaPasses(settings.opacity)) {
      ctx.globalAlpha = alpha
      ctx.drawImage(logo, -wmW / 2, -wmH / 2, wmW, wmH)
    }
    ctx.restore()
  }, [logo, settings])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !logo) return
    const ctx = canvas.getContext('2d')

    if (!isVideo) {
      const img = imgRef.current
      if (!img) return
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
      drawOverlay(ctx, canvas.width, canvas.height)
    } else {
      const v = videoRef.current
      if (!v || !v.videoWidth) return
      canvas.width = v.videoWidth
      canvas.height = v.videoHeight
      ctx.drawImage(v, 0, 0)
      drawOverlay(ctx, canvas.width, canvas.height)
    }
  }, [isVideo, logo, drawOverlay])

  useEffect(() => {
    if (isVideo || !previewUrl) return
    const img = new Image()
    img.onload = () => { imgRef.current = img; draw() }
    img.src = previewUrl
  }, [isVideo, previewUrl])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { draw() }, [draw])

  useEffect(() => {
    if (!isVideo) return
    const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop) }
    if (playing) rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isVideo, playing, draw])

  // ── Kéo watermark ───────────────────────────────────────────────
  const toPct = e => {
    const r = canvasRef.current.getBoundingClientRect()
    const p = e.touches?.[0] ?? e
    return {
      x: ((p.clientX - r.left) / r.width) * 100,
      y: ((p.clientY - r.top) / r.height) * 100,
    }
  }

  const isOnWatermark = pos => {
    const canvas = canvasRef.current
    if (!canvas || !logo) return false
    const wmW = canvas.width * settings.scale
    const wmH = wmW * (logo.height / logo.width)
    const px = (pos.x / 100) * canvas.width
    const py = (pos.y / 100) * canvas.height
    const cx = (settings.x / 100) * canvas.width
    const cy = (settings.y / 100) * canvas.height
    return Math.abs(px - cx) <= wmW / 2 && Math.abs(py - cy) <= wmH / 2
  }

  const onDown = e => {
    const pos = toPct(e)
    if (!isOnWatermark(pos)) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* */ }
    dragRef.current = { offX: settings.x - pos.x, offY: settings.y - pos.y }
  }

  const onMove = e => {
    const drag = dragRef.current
    if (!drag) {
      if (canvasRef.current) {
        canvasRef.current.style.cursor = isOnWatermark(toPct(e)) ? 'grab' : 'default'
      }
      return
    }
    e.preventDefault()
    const pos = toPct(e)
    setSettings(s => ({
      ...s,
      x: clamp(pos.x + drag.offX, 0, 100),
      y: clamp(pos.y + drag.offY, 0, 100),
    }))
  }

  const onUp = e => {
    dragRef.current = null
    if (e?.pointerId != null) {
      try { canvasRef.current?.releasePointerCapture?.(e.pointerId) } catch { /* */ }
    }
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }

  // ── Nạp video ───────────────────────────────────────────────────
  const handleLoadedMetadata = () => {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration || 0)
    try {
      v.currentTime = Math.min(0.05, (v.duration || 1) / 2)
    } catch { /* */ }
  }

  const handleFrameReady = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    setFirst(true)
    setCurrent(v.currentTime || 0)
    draw()
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) } else { v.pause(); setPlaying(false) }
  }

  const seek = t => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
    setCurrent(t)
  }

  // ── Hủy tải thư viện / lưu ──────────────────────────────────────
  const cancelLibLoad = () => {
    libAbortRef.current?.abort()
    libAbortRef.current = null
    setLibLoading(false)
    setLibProgress(0)
    setLibLoaded(0)
    setLibTotal(0)
    setLibEta(null)
    setLibName('')
  }

  const cancelSave = () => {
    saveAbortRef.current?.abort()
    saveAbortRef.current = null
    setSaving(false)
    setProgress(0)
    setSaveEta(null)
  }

  // ── Lưu vào thư viện ────────────────────────────────────────────
  const save = async () => {
    if (!file || saving) return
    setSaving(true); setError(''); setProgress(0); setSaveEta(null)

    const ac = new AbortController()
    saveAbortRef.current = ac
    const t0 = performance.now()

    try {
      const res = await watermarkAndSave(file, settings, ev => {
        if (!ev.total) return
        const pct = Math.round((ev.loaded / ev.total) * 100)
        setProgress(Math.min(pct, 99))
        const elapsed = (performance.now() - t0) / 1000
        if (elapsed > 0.4 && ev.loaded > 0) {
          const speed = ev.loaded / elapsed
          const remain = Math.max(0, ev.total - ev.loaded)
          setSaveEta(speed > 0 ? remain / speed : null)
        }
      }, ac.signal)

      if (ac.signal.aborted) return

      setProgress(100)
      setSaveEta(null)

      const env = res.data
      if (env && typeof env.code === 'number' && !(env.code >= 900 && env.code < 1000)) {
        throw new Error(env.message || 'Xử lý thất bại')
      }
      onNotify?.('Đã lưu vào Tài nguyên')
      reset()
      onSaved?.(env?.data ?? env)
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED' || err.name === 'AbortError') {
        onNotify?.('Đã hủy lưu', false)
        return
      }
      const msg = err.response?.data?.message || err.message || 'Không lưu được file'
      setError(msg)
      onNotify?.(msg, false)
    } finally {
      if (saveAbortRef.current === ac) saveAbortRef.current = null
      setSaving(false)
      setProgress(0)
      setSaveEta(null)
    }
  }

  // ── Chọn từ thư viện ──────────────────────────────────────────
  const finishLibPick = (blob, asset) => {
    const f = new File([blob], asset.originalName || 'file', {
      type: blob.type || asset.contentType || '',
    })
    const byMime = f.type.startsWith('video/') ? 'video'
      : f.type.startsWith('image/') ? 'image' : null
    const byExt = /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(f.name) ? 'video'
      : /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(f.name) ? 'image' : null
    const detected = byMime || byExt || 'image'

    reset()
    setKind(detected)
    setFile(f)
    setUrl(URL.createObjectURL(f))
  }

  const pickFromLibrary = async (asset) => {
    setMediaPicker(false)
    cancelLibLoad()

    const ac = new AbortController()
    libAbortRef.current = ac
    setLibLoading(true)
    setLibProgress(0)
    setLibLoaded(0)
    setLibTotal(0)
    setLibEta(null)
    setLibName(asset.originalName || 'file')
    setError('')

    const t0 = performance.now()

    try {
      const url = mediaUrl(asset.url)
      const res = await fetch(url, { signal: ac.signal })
      if (!res.ok) throw new Error('Fetch failed')

      const total = Number(res.headers.get('content-length')) || Number(asset.sizeBytes) || 0
      setLibTotal(total)

      const reader = res.body?.getReader()
      if (!reader) {
        const blob = await res.blob()
        if (ac.signal.aborted) return
        finishLibPick(blob, asset)
        return
      }

      const chunks = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.byteLength
        setLibLoaded(received)
        if (total > 0) {
          setLibProgress(Math.min(99, Math.round((received / total) * 100)))
          const elapsed = (performance.now() - t0) / 1000
          if (elapsed > 0.3 && received > 0) {
            const speed = received / elapsed
            const remain = Math.max(0, total - received)
            setLibEta(speed > 0 ? remain / speed : null)
          }
        }
      }

      if (ac.signal.aborted) return
      setLibProgress(100)
      setLibEta(0)
      const blob = new Blob(chunks, {
        type: res.headers.get('content-type') || asset.contentType || '',
      })
      finishLibPick(blob, asset)
    } catch (e) {
      if (e.name === 'AbortError') return
      setError('Không tải được file từ thư viện: ' + (e.message || ''))
    } finally {
      if (libAbortRef.current === ac) libAbortRef.current = null
      setLibLoading(false)
      setLibProgress(0)
      setLibLoaded(0)
      setLibTotal(0)
      setLibEta(null)
      setLibName('')
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 flex gap-2">
          <span className="shrink-0">⚠️</span>{error}
        </div>
      )}

      {libLoading && (
        <div className="mb-4 card p-4 border border-blue-100 bg-blue-50/60">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">
                Đang tải từ thư viện…
              </p>
              <p className="text-xs text-gray-500 truncate mt-0.5">{libName}</p>
            </div>
            <button type="button" onClick={cancelLibLoad}
              className="btn-secondary shrink-0 text-xs">
              Hủy
            </button>
          </div>
          <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
            <div className="h-full bg-blue-600 transition-all duration-150"
              style={{ width: `${libProgress}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-gray-500 tabular-nums">
            <span>
              {libProgress}%
              {libTotal > 0 && ` · ${fmtBytes(libLoaded)} / ${fmtBytes(libTotal)}`}
            </span>
            <span>
              {libEta != null ? `Còn ~${fmtEta(libEta)}` : 'Đang ước tính…'}
            </span>
          </div>
        </div>
      )}

      {!file && !libLoading ? (
        <div className="max-w-2xl mx-auto pt-4 sm:pt-8 space-y-3">
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full card border-2 border-dashed border-gray-200 py-14 text-center hover:border-blue-400 transition-colors"
          >
            <div className="text-4xl mb-3">📁</div>
            <p className="font-semibold text-gray-700 text-sm">Chọn ảnh hoặc video từ máy</p>
            <p className="text-xs text-gray-400 mt-1.5">
              Tự nhận diện loại file · JPG, PNG, MP4, MOV
            </p>
          </button>
          <button
            onClick={() => setMediaPicker(true)}
            className="w-full card border-2 border-dashed border-blue-200 py-8 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          >
            <div className="text-3xl mb-2">🖼️</div>
            <p className="font-semibold text-blue-700 text-sm">Chọn từ thư viện Hình ảnh</p>
            <p className="text-xs text-gray-400 mt-1">
              Chọn ảnh/video đã tải lên trước đó
            </p>
          </button>
          <input ref={inputRef} type="file" hidden accept="image/*,video/*" onChange={pickFile} />

          {showMediaPicker && (
            <MediaPickerModal onClose={() => setMediaPicker(false)} onPick={pickFromLibrary} />
          )}
        </div>
      ) : file ? (
        <>
          <div className="sticky top-0 z-10 -mx-2 sm:-mx-4 lg:-mx-6 px-2 sm:px-4 lg:px-6 py-2.5
            bg-gray-50/95 backdrop-blur border-b border-gray-200 flex items-center gap-2 mb-4">
            <span className="badge bg-white border border-gray-200 text-gray-500 shrink-0">
              {isVideo ? '🎥' : '📷'} {(file.size / 1048576).toFixed(1)} MB
            </span>
            <span className="text-xs text-gray-400 truncate flex-1 hidden sm:block">{file.name}</span>

            {saving ? (
              <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none sm:max-w-xs">
                <div className="flex-1 min-w-[100px]">
                  <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                    <div className="h-full bg-blue-600 transition-all duration-150"
                      style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
                    {progress < 100
                      ? `Gửi ${progress}%${saveEta != null ? ` · còn ~${fmtEta(saveEta)}` : ''}`
                      : 'Đang gắn watermark…'}
                  </p>
                </div>
                <button type="button" onClick={cancelSave}
                  className="btn-secondary shrink-0 text-xs">
                  Hủy
                </button>
              </div>
            ) : (
              <>
                <button onClick={reset} className="btn-secondary shrink-0 text-xs">Đổi file</button>
                <button onClick={save} className="btn-primary shrink-0">💾 Lưu</button>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]
            xl:grid-cols-[minmax(0,1fr)_340px] gap-4 lg:gap-5 items-start">

            <section className="order-1 min-w-0">
              <div className="card p-2 sm:p-4 bg-gray-100/70">
                <div className="flex justify-center">
                  <canvas
                    ref={canvasRef}
                    onPointerDown={onDown} onPointerMove={onMove}
                    onPointerUp={onUp} onPointerCancel={onUp}
                    className="max-w-full w-auto h-auto rounded-lg shadow touch-none bg-white
                      max-h-[46svh] sm:max-h-[calc(100svh-260px)] lg:max-h-[calc(100svh-230px)]"
                  />
                </div>

                {isVideo && (
                  <video
                    ref={videoRef} src={previewUrl} className="hidden"
                    playsInline muted preload="auto"
                    onLoadedMetadata={handleLoadedMetadata}
                    onLoadedData={handleFrameReady}
                    onCanPlay={handleFrameReady}
                    onSeeked={handleFrameReady}
                    onTimeUpdate={() => setCurrent(videoRef.current?.currentTime || 0)}
                    onEnded={() => setPlaying(false)}
                  />
                )}

                {isVideo && !firstFrame && (
                  <p className="mt-3 text-xs text-gray-400 text-center">Đang lấy khung hình đầu tiên...</p>
                )}

                {isVideo && (
                  <div className="mt-3 flex items-center gap-2 sm:gap-3">
                    <button onClick={togglePlay}
                      className="w-9 h-9 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm">
                      {playing ? '❚❚' : '▶'}
                    </button>
                    <input type="range" min={0} max={duration || 0} step={0.05} value={current}
                      onChange={e => seek(+e.target.value)} className="flex-1 accent-blue-600" />
                    <span className="text-xs text-gray-500 tabular-nums shrink-0">
                      {fmtTime(current)}/{fmtTime(duration)}
                    </span>
                  </div>
                )}

                <p className="mt-2 text-xs text-gray-400 text-center">
                  Kéo watermark trên khung hình để đổi vị trí
                </p>
              </div>
            </section>

            <aside className="order-2 lg:sticky lg:top-[60px]">
              <div className="card p-4 space-y-5">
                <Slider label="Kích thước" value={`${Math.round(settings.scale * 100)}%`}
                  min={0.05} max={0.8} step={0.01} v={settings.scale}
                  onChange={v => setSettings(s => ({ ...s, scale: v }))} />

                <Slider label="Góc xoay" value={`${settings.rotation}°`}
                  min={-180} max={180} step={1} v={settings.rotation}
                  onChange={v => setSettings(s => ({ ...s, rotation: v }))} />

                <Slider label="Độ đậm" value={`${Math.round(settings.opacity * 100)}%`}
                  min={0.05} max={MAX_OPACITY} step={0.01} v={settings.opacity}
                  onChange={v => setSettings(s => ({ ...s, opacity: v }))} />
                {settings.opacity > 1 && (
                  <p className="-mt-3 text-xs text-gray-400 leading-relaxed">
                    Trên 100% là vẽ chồng nhiều lượt cho đậm hơn logo gốc.
                  </p>
                )}

                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Vị trí nhanh</p>
                  <div className="grid grid-cols-3 gap-1.5 max-w-[180px]">
                    {POSITION_PRESETS.map(p => (
                      <button key={p.label}
                        onClick={() => setSettings(s => ({ ...s, x: p.x, y: p.y }))}
                        className="aspect-square rounded-lg border border-gray-200 text-gray-500 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors text-sm">
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2 tabular-nums">
                    X {settings.x.toFixed(1)}% · Y {settings.y.toFixed(1)}%
                  </p>
                </div>

                <button onClick={() => setSettings(DEFAULTS)}
                  className="btn-secondary w-full justify-center text-xs">
                  ↺ Đặt lại mặc định
                </button>
              </div>
            </aside>
          </div>
        </>
      ) : null}

      {showMediaPicker && !libLoading && (
        <MediaPickerModal onClose={() => setMediaPicker(false)} onPick={pickFromLibrary} />
      )}
    </>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function Slider({ label, value, min, max, step, v, onChange }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <span className="text-xs text-gray-400 tabular-nums">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={e => onChange(+e.target.value)}
        className="w-full accent-blue-600" />
    </div>
  )
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const fmtTime = s => {
  if (!s || Number.isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

/* ── Modal chọn ảnh/video từ thư viện ─────────────────────────────── */

function MediaPickerModal({ onClose, onPick }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [albums, setAlbums] = useState([])
  const [albumId, setAlbumId] = useState(null)
  const [albumsReady, setAlbumsReady] = useState(false)

  const listRef = useRef(null)
  const sentinelRef = useRef(null)
  const loadingRef = useRef(false)
  const searchTimer = useRef(null)

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setQuery(search)
      setPage(0)
    }, 400)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    listAlbums()
      .then(res => {
        const env = res.data
        const d = env?.data ?? env
        const list = Array.isArray(d) ? d : []
        setAlbums(list)
        if (list.length > 0) {
          setAlbumId(String(list[0].id))
          setPage(0)
        } else {
          setAlbumId(null)
        }
      })
      .catch(() => {
        setAlbums([])
        setAlbumId(null)
      })
      .finally(() => setAlbumsReady(true))
  }, [])

  useEffect(() => {
    if (!albumsReady) return

    let alive = true
    setLoading(true)
    loadingRef.current = true

    const filters = {}
    if (query) filters.q = query
    if (albumId) filters.albumId = Number(albumId)

    listMedia(page, 30, filters).then(res => {
      if (!alive) return
      const env = res.data
      const d = env?.data ?? env
      const batch = d.content || []
      setItems(prev => page === 0 ? batch : [...prev, ...batch])
      setHasMore((d.currentPage || 0) < (d.totalPages || 0) - 1)
      setLoading(false)
      loadingRef.current = false
    }).catch(() => {
      if (alive) {
        setLoading(false)
        loadingRef.current = false
      }
    })
    return () => { alive = false }
  }, [query, page, albumId, albumsReady])

  const onAlbumChange = e => {
    setAlbumId(e.target.value || null)
    setPage(0)
  }

  useEffect(() => {
    const root = listRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingRef.current) {
          setPage(p => p + 1)
        }
      },
      { root, rootMargin: '120px', threshold: 0 }
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasMore, items.length])

  const fmtSize = b => {
    if (b < 1024) return `${b} B`
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
    return `${(b / 1048576).toFixed(1)} MB`
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ height: 'min(80svh, 620px)' }}>

        <div className="shrink-0 px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
          <h2 className="font-bold text-gray-900 text-base">Chọn từ thư viện</h2>
          <button onClick={onClose}
            className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 text-xl">
            ×
          </button>
        </div>

        <div className="shrink-0 px-5 py-3 border-b border-gray-100">
          <div className="flex gap-2 items-center">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm theo tên file..."
              className="w-[65%] min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400"
            />
            <select
              value={albumId ?? ''}
              onChange={onAlbumChange}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 bg-white"
            >
              {albums.length === 0 && (
                <option value="">Tất cả</option>
              )}
              {albums.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{typeof a.count === 'number' ? ` (${a.count})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-1.5">
          {items.map(it => (
            <button key={it.id} onClick={() => onPick(it)}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-gray-100
                bg-gray-50/60 hover:bg-blue-50 hover:border-blue-200 transition-colors text-left">
              <div className="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-gray-200">
                <img src={mediaUrl(it.thumbUrl)} alt="" className="w-full h-full object-cover" loading="lazy" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{it.originalName}</p>
                <p className="text-xs text-gray-400">
                  {it.mediaType === 'VIDEO' ? '🎬 Video' : '📷 Ảnh'} · {fmtSize(it.sizeBytes || 0)}
                </p>
              </div>
            </button>
          ))}

          {loading && (
            <p className="text-xs text-gray-300 text-center py-4">Đang tải...</p>
          )}
          {!loading && items.length === 0 && (
            <p className="text-xs text-gray-300 text-center py-8">Không tìm thấy</p>
          )}

          {hasMore && <div ref={sentinelRef} className="h-4" aria-hidden="true" />}
        </div>
      </div>
    </div>
  )
}