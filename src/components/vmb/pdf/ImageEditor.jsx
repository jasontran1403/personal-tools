import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ZoomBar from './ZoomBar'
import FilePicker from './FilePicker'

/**
 * ImageEditor — tab con "Sửa ảnh" trong Pdf.
 *
 * Chức năng hiện tại: TÁCH NỀN (remove background) client-side.
 *
 * ── Thư viện ───────────────────────────────────────────────
 *   @imgly/background-removal — chạy ONNX model (BRIA / MODNet) qua
 *   ONNX Runtime WASM, 100% trong browser. Lần đầu dùng sẽ tải model
 *   (~44 MB) rồi cache ở OPFS; các lần sau chạy nhanh.
 *
 * ── Luồng ──────────────────────────────────────────────────
 *   1. User chọn / drop ảnh.
 *   2. Hiển thị animation "shimmer sweep" chạy ngang ảnh trong khi xử lý.
 *   3. Preview before/after: slider so sánh hoặc 2 panel tuỳ layout.
 *   4. Nút Download → tải PNG trong suốt (chất lượng gốc, không nén).
 *
 * ── Dependencies ───────────────────────────────────────────
 *   npm i @imgly/background-removal
 */
export default function ImageEditor() {
  const [srcDataUrl, setSrcDataUrl] = useState(null)  // ảnh gốc dataURL
  const [outUrl, setOutUrl]         = useState(null)  // ảnh đã tách nền (object URL)
  const [fileName, setFileName]     = useState('')
  const [status, setStatus]         = useState('idle')  // idle | loading | processing | done | error
  const [progress, setProgress]     = useState(0)   // 0..100 (model download)
  const [progressLabel, setProgressLabel] = useState('')
  const [view, setView] = useState('after')  // 'before' | 'after' | 'split' | 'checker'
  const [zoom, setZoom] = useState(1)
  const fileInputRef = useRef(null)   // giữ cho reset() clear value nếu cần

  // Cleanup object URL khi unmount hoặc đổi ảnh
  useEffect(() => {
    return () => {
      if (outUrl) URL.revokeObjectURL(outUrl)
    }
  }, [outUrl])

  const onPick = (f) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { toast.error('Chỉ nhận ảnh'); return }

    // Reset
    if (outUrl) URL.revokeObjectURL(outUrl)
    setOutUrl(null)
    setStatus('loading')
    setProgress(0)
    setProgressLabel('Đọc file…')
    setFileName(f.name)

    const reader = new FileReader()
    reader.onload = async () => {
      setSrcDataUrl(reader.result)
      await processImage(reader.result)
    }
    reader.onerror = () => { toast.error('Không đọc được file'); setStatus('error') }
    reader.readAsDataURL(f)
  }

  const processImage = async (dataUrl) => {
    setStatus('processing')
    setProgressLabel('Đang tải model (lần đầu ~44MB)…')
    try {
      // Dynamic import để không nhồi bundle chính + chỉ tải khi user bước
      // vào tab này.
      const mod = await import('@imgly/background-removal')
      const removeBackground = mod.removeBackground || mod.default?.removeBackground || mod.default

      const config = {
        progress: (key, current, total) => {
          // key dạng "fetch:..." / "compute:..." — cho user biết đang làm gì
          const pct = total > 0 ? Math.round((current / total) * 100) : 0
          setProgress(pct)
          if (key.startsWith('fetch')) setProgressLabel(`Tải model… ${pct}%`)
          else if (key.startsWith('compute')) setProgressLabel('Đang tách nền…')
          else setProgressLabel(key)
        },
        output: { format: 'image/png', quality: 1 },   // PNG trong suốt, lossless
      }

      const blob = await removeBackground(dataUrl, config)
      const url = URL.createObjectURL(blob)
      setOutUrl(url)
      setStatus('done')
      setProgress(100)
      setProgressLabel('Hoàn tất')
      setView('after')
      toast.success('Tách nền xong')
    } catch (e) {
      console.error(e)
      toast.error('Tách nền thất bại: ' + (e?.message || e))
      setStatus('error')
    }
  }

  const download = () => {
    if (!outUrl) return
    const a = document.createElement('a')
    a.href = outUrl
    a.download = suggestName(fileName)
    document.body.appendChild(a); a.click(); a.remove()
    toast.success('Đã tải PNG')
  }

  const reset = () => {
    if (outUrl) URL.revokeObjectURL(outUrl)
    setSrcDataUrl(null); setOutUrl(null); setFileName('')
    setStatus('idle'); setProgress(0); setProgressLabel('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const busy = status === 'loading' || status === 'processing'

  const hasImage = !!srcDataUrl

  return (
    <div className="bg-white rounded-2xl shadow border border-gray-100 p-3 sm:p-4 flex flex-col"
      style={{ height: 'calc(100dvh - 170px)', minHeight: 420 }}>
      {/* Toolbar — chỉ render khi đã có ảnh */}
      {hasImage && (
        <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-gray-100 flex-none">
          {fileName && (
            <span className="text-xs text-gray-600 truncate max-w-[260px]" title={fileName}>
              🖼 {fileName}
            </span>
          )}

          {outUrl && (
            <div className="inline-flex rounded-md bg-gray-100 p-0.5 ml-2">
              {[
                ['before',  'Gốc'],
                ['after',   'Đã tách'],
                ['checker', 'Checker'],
                ['split',   'So sánh'],
              ].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={`text-[11px] px-2 py-1 rounded font-semibold transition
                    ${view === v ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1" />
          {outUrl && <ZoomBar zoom={zoom} onZoom={setZoom} />}
          <button type="button" onClick={reset} disabled={busy}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg text-gray-600 hover:bg-gray-100
              disabled:opacity-50">
            Huỷ
          </button>
          {outUrl && (
            <button type="button" onClick={download}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white
                hover:bg-emerald-700">
              ⬇ Tải PNG
            </button>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {!hasImage ? (
          <FilePicker
            icon="🎨"
            title="Tách nền ảnh"
            description={'Chọn 1 ảnh có chủ thể rõ (người, vật, sản phẩm…). Hệ thống sẽ tách khỏi nền và xuất PNG trong suốt.\nLần đầu tải model AI (~44MB); lần sau nhanh hơn vì đã cache.'}
            accept="image/*"
            onPick={onPick}
          />
        ) : (
          <div className="relative bg-slate-100 rounded-lg border border-gray-200 overflow-auto flex-1 min-h-0">
            <div className={zoom === 1
                ? 'absolute inset-0 flex items-center justify-center p-3'
                : 'inline-block p-3'}>
              <StageContent
                srcDataUrl={srcDataUrl}
                outUrl={outUrl}
                view={view}
                zoom={zoom}
                busy={busy}
              />
            </div>

            {busy && (
              <ProgressOverlay label={progressLabel} progress={progress} />
            )}
          </div>
        )}
      </div>

      {/* Shimmer keyframes + checker pattern */}
      <style>{`
        @keyframes shimmer-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes pulse-mask {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.6; }
        }
        .ime-checker {
          background-image:
            linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
            linear-gradient(-45deg, transparent 75%, #e5e7eb 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0;
        }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Stage — hiển thị ảnh theo chế độ view hiện tại
// ═══════════════════════════════════════════════════════════════

function StageContent({ srcDataUrl, outUrl, view, zoom, busy }) {
  const imgStyle = {
    display: 'block',
    maxWidth: zoom === 1 ? '100%' : 'none',
    maxHeight: zoom === 1 ? 'calc(100dvh - 260px)' : 'none',
    width: zoom === 1 ? 'auto' : `${zoom * 100}%`,
    height: 'auto',
  }

  // Trạng thái "đang xử lý" — hiển thị ảnh gốc + overlay shimmer sweep.
  // Khi xong → chuyển sang view mode.
  if (busy || !outUrl) {
    return (
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
        <img src={srcDataUrl} alt="src" style={imgStyle} />
        {busy && <ShimmerOverlay />}
      </div>
    )
  }

  if (view === 'before') {
    return <img src={srcDataUrl} alt="before" style={imgStyle} />
  }

  if (view === 'after') {
    return (
      <div style={{ display: 'inline-block' }}>
        <img src={outUrl} alt="after" style={imgStyle} />
      </div>
    )
  }

  if (view === 'checker') {
    // Nền checkerboard làm nổi vùng trong suốt
    return (
      <div className="ime-checker" style={{ display: 'inline-block', padding: 0 }}>
        <img src={outUrl} alt="after-checker" style={imgStyle} />
      </div>
    )
  }

  // view === 'split' — so sánh trước/sau bằng clip-path 50/50
  return <SplitCompare srcDataUrl={srcDataUrl} outUrl={outUrl} imgStyle={imgStyle} />
}

// ═══════════════════════════════════════════════════════════════
//  Shimmer sweep overlay — animation hiển thị "đang quét" trên ảnh
// ═══════════════════════════════════════════════════════════════

function ShimmerOverlay() {
  return (
    <>
      {/* Mask tối pulsing — làm cho ảnh gốc trông "đang được xử lý" */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(37, 99, 235, 0.15)',
        animation: 'pulse-mask 1.4s ease-in-out infinite',
        pointerEvents: 'none',
      }} />
      {/* Dải sáng quét ngang */}
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute',
          top: 0, bottom: 0,
          width: '35%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent)',
          animation: 'shimmer-sweep 1.6s linear infinite',
        }} />
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Split compare — kéo slider so sánh before / after
// ═══════════════════════════════════════════════════════════════

function SplitCompare({ srcDataUrl, outUrl, imgStyle }) {
  const [pct, setPct] = useState(50)   // vị trí thanh chia theo %
  const wrapRef = useRef(null)
  const dragging = useRef(false)

  const onDown = (e) => { dragging.current = true; onMove(e) }
  const onUp   = () => { dragging.current = false }
  const onMove = (e) => {
    if (!dragging.current && e.type !== 'click') return
    const rect = wrapRef.current.getBoundingClientRect()
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const p = ((cx - rect.left) / rect.width) * 100
    setPct(Math.max(0, Math.min(100, p)))
  }

  return (
    <div ref={wrapRef}
      className="ime-checker"
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
      style={{
        position: 'relative', display: 'inline-block', cursor: 'ew-resize',
        userSelect: 'none', touchAction: 'none',
      }}>
      {/* Gốc — toàn bộ */}
      <img src={srcDataUrl} alt="before" style={imgStyle} draggable={false} />
      {/* Đã tách — clip theo pct */}
      <img src={outUrl} alt="after"
        style={{
          ...imgStyle,
          position: 'absolute', inset: 0,
          clipPath: `inset(0 0 0 ${pct}%)`,
          WebkitClipPath: `inset(0 0 0 ${pct}%)`,
        }}
        draggable={false} />
      {/* Divider */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        left: `${pct}%`, width: 2, background: '#2563EB',
        boxShadow: '0 0 0 1px white',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: `${pct}%`,
        transform: 'translate(-50%, -50%)',
        width: 32, height: 32, borderRadius: '50%',
        background: 'white', border: '2px solid #2563EB',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, color: '#2563EB', fontWeight: 'bold',
        pointerEvents: 'none',
      }}>
        ⇄
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Overlays phụ
// ═══════════════════════════════════════════════════════════════

function ProgressOverlay({ label, progress }) {
  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 12,
      padding: '10px 14px', borderRadius: 10,
      background: 'rgba(255,255,255,0.96)',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      border: '1px solid rgba(0,0,0,0.06)',
    }}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-3 h-3 rounded-full bg-blue-600 animate-pulse" />
        <span className="text-xs font-semibold text-gray-800 flex-1 truncate">{label}</span>
        {progress > 0 && (
          <span className="text-[11px] tabular-nums text-gray-500">{progress}%</span>
        )}
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: 'linear-gradient(90deg, #3B82F6, #6366F1)',
          transition: 'width .3s',
        }} />
      </div>
    </div>
  )
}

// EmptyState — ĐÃ bỏ, thay bằng <FilePicker /> (drag+drop + click + visual state)

function suggestName(name) {
  if (!name) return 'image_nobg.png'
  return name.replace(/\.[^.]+$/, '') + '_nobg.png'
}