import { useState, useRef, useEffect, useCallback } from 'react'
import ToolShell from '../../components/ToolShell'
import { fetchWatermarkLogo, applyWatermark } from '../../services/api'

/**
 * Gắn watermark lên ảnh / video.
 *
 * ĐIỂM QUAN TRỌNG — vì sao preview khớp với file xuất ra:
 * Cả hai phía dùng CHUNG một công thức:
 *     wmW = mediaWidth * scale
 *     wmH = wmW * (logoH / logoW)
 *     tâm watermark đặt tại (x% * mediaWidth, y% * mediaHeight)
 *
 * Ở tab video, canvas là bề mặt hiển thị DUY NHẤT (thẻ <video> bị ẩn, chỉ
 * dùng làm nguồn khung hình). Bản cũ chồng canvas lên trên <video> bằng
 * position:absolute — hai thẻ có cách co giãn khác nhau nên lệch nhau vài
 * pixel, kéo theo tọa độ chuột lệch. Giờ chỉ còn một bề mặt nên không thể lệch.
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

export default function WatermarkPage() {
  const [tab, setTab]           = useState('image')
  const [file, setFile]         = useState(null)
  const [previewUrl, setUrl]    = useState(null)
  const [logo, setLogo]         = useState(null)
  const [settings, setSettings] = useState(DEFAULTS)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [playing, setPlaying]   = useState(false)
  const [firstFrame, setFirst]  = useState(false)   // đã có khung hình để vẽ chưa
  const [duration, setDuration] = useState(0)
  const [current, setCurrent]   = useState(0)

  const canvasRef = useRef(null)
  const videoRef  = useRef(null)
  const imgRef    = useRef(null)     // ảnh đã decode, giữ lại để vẽ lại nhanh
  const rafRef    = useRef(null)
  const inputRef  = useRef(null)
  const dragRef   = useRef(null)

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
      .catch(() => setError('Không tải được logo watermark từ server'))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [])

  // ── Dọn URL ─────────────────────────────────────────────────────
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null); setUrl(null); imgRef.current = null
    setPlaying(false); setDuration(0); setCurrent(0); setError(''); setFirst(false)
  }

  const switchTab = t => { if (t !== tab) { setTab(t); reset() } }

  const pickFile = e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const okType = tab === 'image' ? f.type.startsWith('image/') : f.type.startsWith('video/')
    if (!okType) { setError(`Vui lòng chọn file ${tab === 'image' ? 'ảnh' : 'video'}`); return }

    reset()
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

    if (tab === 'image') {
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
  }, [tab, logo, drawOverlay])

  // Ảnh: decode xong thì vẽ
  useEffect(() => {
    if (tab !== 'image' || !previewUrl) return
    const img = new Image()
    img.onload = () => { imgRef.current = img; draw() }
    img.src = previewUrl
  }, [tab, previewUrl])   // eslint-disable-line react-hooks/exhaustive-deps

  // Vẽ lại khi đổi thiết lập
  useEffect(() => { draw() }, [draw])

  // Video: vòng lặp vẽ khi đang phát
  useEffect(() => {
    if (tab !== 'video') return
    const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop) }
    if (playing) rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [tab, playing, draw])

  // ── Kéo watermark ───────────────────────────────────────────────
  // Quy đổi tọa độ chuột sang % của canvas. Vì canvas là bề mặt duy nhất,
  // rect của nó chính là khung hình đang thấy → không lệch.
  const toPct = e => {
    const r = canvasRef.current.getBoundingClientRect()
    const p = e.touches?.[0] ?? e
    return {
      x: ((p.clientX - r.left) / r.width) * 100,
      y: ((p.clientY - r.top) / r.height) * 100,
    }
  }

  /** Hit-test theo PIXEL, không theo % — % của trục X và Y không cùng đơn vị */
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
    dragRef.current = { offX: settings.x - pos.x, offY: settings.y - pos.y }
  }

  const onMove = e => {
    if (!dragRef.current) {
      if (canvasRef.current) {
        canvasRef.current.style.cursor = isOnWatermark(toPct(e)) ? 'grab' : 'default'
      }
      return
    }
    e.preventDefault()
    const pos = toPct(e)
    setSettings(s => ({
      ...s,
      x: clamp(pos.x + dragRef.current.offX, 0, 100),
      y: clamp(pos.y + dragRef.current.offY, 0, 100),
    }))
  }

  const onUp = () => {
    dragRef.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }

  // ── Nạp video ───────────────────────────────────────────────────
  /**
   * Trình duyệt KHÔNG tự decode khung hình nào cho tới khi video được phát.
   * Trước đây phải bấm play rồi dừng lại thì canvas mới có hình — rất khó chịu
   * khi chỉ muốn căn vị trí watermark.
   *
   * Cách ép: ngay khi có metadata thì tua tới một mốc rất nhỏ (0.05s). Thao tác
   * seek buộc trình duyệt decode đúng một khung hình và bắn sự kiện `seeked`,
   * lúc đó vẽ được lên canvas. Tua 0.05s thay vì 0 vì nhiều file có khung đầu
   * đen hoặc trống.
   */
  const handleLoadedMetadata = () => {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration || 0)
    try {
      v.currentTime = Math.min(0.05, (v.duration || 1) / 2)
    } catch {
      // Một số định dạng không seek được trước khi buffer xong — bỏ qua,
      // các sự kiện canplay/loadeddata bên dưới vẫn xử lý được.
    }
  }

  const handleFrameReady = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    setFirst(true)
    setCurrent(v.currentTime || 0)
    draw()
  }

  // ── Điều khiển video ────────────────────────────────────────────
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
    // Không gọi draw() ngay: khung hình mới chưa decode xong.
    // Sự kiện `seeked` (→ handleFrameReady) sẽ vẽ đúng lúc.
  }

  // ── Xuất file ───────────────────────────────────────────────────
  const save = async () => {
    if (!file) return
    setSaving(true); setError('')
    try {
      const res = await applyWatermark(file, settings, tab)

      // Backend trả lỗi dạng JSON nhưng responseType là blob → phải đọc ra
      if (res.data.type?.includes('json')) {
        const txt = await res.data.text()
        throw new Error(JSON.parse(txt).message || 'Xử lý thất bại')
      }

      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `watermarked_${Date.now()}.${tab === 'video' ? 'mp4' : guessExt(file)}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || 'Không lưu được file')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <ToolShell
      icon="💧"
      title="Gắn watermark"
      subtitle="Ảnh và video — vị trí trên preview đúng bằng vị trí khi xuất file"
      actions={
        <button onClick={save} disabled={!file || saving} className="btn-primary">
          {saving ? 'Đang xử lý...' : `💾 Lưu ${tab === 'image' ? 'ảnh' : 'video'}`}
        </button>
      }
    >
      {/* Tab */}
      <div className="flex items-center gap-1 mb-5 border-b border-gray-200">
        {[['image', '📷 Ảnh'], ['video', '🎥 Video']].map(([k, label]) => (
          <button key={k} onClick={() => switchTab(k)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors
              ${tab === k ? 'border-blue-600 text-blue-700'
                          : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 flex gap-2">
          <span className="shrink-0">⚠️</span>{error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

        {/* ── Bảng điều khiển ── */}
        <aside className="lg:col-span-1 space-y-4 order-2 lg:order-1">
          <div className="card p-4">
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 text-center hover:border-blue-400 transition-colors"
            >
              <div className="text-3xl mb-2">📁</div>
              <p className="font-semibold text-gray-700 text-sm">
                Chọn {tab === 'image' ? 'ảnh' : 'video'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {tab === 'image' ? 'PNG, JPG' : 'MP4, MOV'}
              </p>
            </button>
            <input ref={inputRef} type="file" hidden
              accept={tab === 'image' ? 'image/*' : 'video/*'} onChange={pickFile} />

            {file && (
              <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-600 break-all">
                <span className="font-semibold">{file.name}</span>
                <span className="text-gray-400"> · {(file.size / 1048576).toFixed(1)} MB</span>
              </div>
            )}
          </div>

          {file && (
            <div className="card p-4 space-y-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Điều chỉnh
              </p>

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
                <div className="grid grid-cols-3 gap-1.5 max-w-[160px]">
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
          )}
        </aside>

        {/* ── Preview ── */}
        <section className="lg:col-span-3 order-1 lg:order-2">
          <div className="card p-3 sm:p-5 bg-gray-100/70">
            {!file ? (
              <div className="py-24 text-center text-gray-300">
                <div className="text-5xl mb-3">🖼️</div>
                <p className="text-sm">Chọn {tab === 'image' ? 'ảnh' : 'video'} để bắt đầu</p>
              </div>
            ) : (
              <>
                <div className="flex justify-center">
                  <canvas
                    ref={canvasRef}
                    onMouseDown={onDown}
                    onMouseMove={onMove}
                    onMouseUp={onUp}
                    onMouseLeave={onUp}
                    onTouchStart={onDown}
                    onTouchMove={onMove}
                    onTouchEnd={onUp}
                    className="max-w-full max-h-[62vh] w-auto h-auto rounded-lg shadow-lg touch-none bg-white"
                  />
                </div>

                {/* Thẻ video ẩn — chỉ làm nguồn khung hình cho canvas */}
                {tab === 'video' && (
                  <video
                    ref={videoRef}
                    src={previewUrl}
                    className="hidden"
                    playsInline
                    muted
                    preload="auto"
                    onLoadedMetadata={handleLoadedMetadata}
                    onLoadedData={handleFrameReady}
                    onCanPlay={handleFrameReady}
                    onSeeked={handleFrameReady}
                    onTimeUpdate={() => setCurrent(videoRef.current?.currentTime || 0)}
                    onEnded={() => setPlaying(false)}
                  />
                )}

                {tab === 'video' && !firstFrame && (
                  <p className="mt-3 text-xs text-gray-400 text-center">Đang lấy khung hình đầu tiên...</p>
                )}

                {tab === 'video' && (
                  <div className="mt-4 flex items-center gap-3">
                    <button onClick={togglePlay}
                      className="w-10 h-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition-colors">
                      {playing ? '❚❚' : '▶'}
                    </button>
                    <input type="range" min={0} max={duration || 0} step={0.05} value={current}
                      onChange={e => seek(+e.target.value)}
                      className="flex-1 accent-blue-600" />
                    <span className="text-xs text-gray-500 tabular-nums shrink-0 w-24 text-right">
                      {fmtTime(current)} / {fmtTime(duration)}
                    </span>
                  </div>
                )}

                <p className="mt-3 text-xs text-gray-400 text-center">
                  Kéo trực tiếp watermark trên khung hình để đổi vị trí
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </ToolShell>
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

const guessExt = f => (f.type === 'image/png' || f.name.toLowerCase().endsWith('.png') ? 'png' : 'jpg')