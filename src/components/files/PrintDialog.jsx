import { useState, useEffect } from 'react'
import { listPrinters, discoverPrinters, connectPrinter, printFile, fileUrl } from '../../services/filesApi'
import { SkeletonBox } from '../common/Skeleton'
import { iconOf, fmtSize } from './fileKind'

/**
 * Hộp thoại in.
 *
 * HAI ĐƯỜNG IN, khác nhau ở chỗ máy in nằm ở đâu:
 *
 *   • Qua máy chủ — máy chủ gửi tệp thẳng tới máy in bằng CUPS. Chỉ thấy được
 *     máy in cùng mạng với MÁY CHỦ. Đúng cho máy in văn phòng đặt cố định.
 *
 *   • Qua trình duyệt — mở hộp thoại in của máy người dùng. Thấy được máy in
 *     cắm vào chính máy đó, kể cả khi đang ngồi ở nhà.
 *
 * Trình duyệt KHÔNG có API nào để dò máy in trong LAN, nên việc quét mạng bắt
 * buộc phải làm ở máy chủ — đây là giới hạn của nền tảng web chứ không phải
 * thiếu sót có thể vá được. Giao diện nói rõ để người dùng chọn đúng đường.
 */

const PAPER = [
  { value: 'A4',     label: 'A4' },
  { value: 'A5',     label: 'A5' },
  { value: 'Letter', label: 'Letter' },
]

export default function PrintDialog({ asset, onClose, onNotify }) {
  const [mode, setMode] = useState('server')        // server | browser
  const [printers, setPrinters] = useState([])
  const [loading, setLoading]   = useState(true)
  const [scanning, setScanning] = useState(false)
  const [found, setFound]       = useState(null)    // null = chưa quét lần nào
  const [connecting, setConnecting] = useState(null)
  const [sending, setSending]   = useState(false)

  const [selected, setSelected] = useState('')
  const [copies, setCopies]     = useState(1)
  const [range, setRange]       = useState('')
  const [media, setMedia]       = useState('A4')
  const [color, setColor]       = useState(true)
  const [duplex, setDuplex]     = useState(false)
  const [landscape, setLandscape] = useState(false)

  // ── Nạp máy in đã cài ───────────────────────────────────────────
  const refresh = async () => {
    setLoading(true)
    try {
      const list = await listPrinters()
      setPrinters(list || [])
      // Chọn sẵn máy mặc định để người dùng bấm In là xong
      const def = list?.find(p => p.isDefault) || list?.[0]
      if (def) setSelected(prev => prev || def.name)
    } catch {
      setPrinters([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Quét mạng ───────────────────────────────────────────────────
  const scan = async () => {
    setScanning(true)
    try {
      const list = await discoverPrinters()
      setFound(list || [])
      if (!list?.length) onNotify?.('Không tìm thấy máy in nào trong mạng', false)
    } catch (e) {
      setFound([])
      onNotify?.(e.message || 'Quét mạng thất bại', false)
    } finally {
      setScanning(false)
    }
  }

  const connect = async printer => {
    setConnecting(printer.uri)
    try {
      const res = await connectPrinter(printer.uri, printer.suggestedName || printer.name)
      onNotify?.(`Đã kết nối ${res.name}`)
      setSelected(res.name)
      setFound(null)
      await refresh()
    } catch (e) {
      onNotify?.(e.message || 'Kết nối thất bại', false)
    } finally {
      setConnecting(null)
    }
  }

  // ── Gửi lệnh in ─────────────────────────────────────────────────
  const send = async () => {
    if (mode === 'browser') return printViaBrowser()

    if (!selected) { onNotify?.('Chưa chọn máy in', false); return }
    setSending(true)
    try {
      await printFile(asset.id, selected, {
        copies,
        range: range.trim(),
        media,
        color,
        sides: duplex ? 'two-sided-long-edge' : 'one-sided',
        orientation: landscape ? 'landscape' : 'portrait',
      })
      onNotify?.('Đã gửi lệnh in')
      onClose()
    } catch (e) {
      onNotify?.(e.message || 'Gửi lệnh in thất bại', false)
    } finally {
      setSending(false)
    }
  }

  /**
   * In qua trình duyệt.
   *
   * Tải file về thành blob rồi mới nhúng, vì lý do giống trang xem trước PDF:
   * iframe trỏ sang origin khác (frontend 5173, API 9009) có thể bị chặn mà
   * không báo lỗi gì, dẫn tới in ra trang trắng. Blob URL luôn cùng origin nên
   * chắc chắn nhúng và in được.
   */
  const printViaBrowser = async () => {
    setSending(true)
    try {
      const res = await fetch(fileUrl(asset.url))
      if (!res.ok) throw new Error(`Máy chủ trả về ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)

      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
      frame.src = objectUrl
      document.body.appendChild(frame)

      frame.onload = () => {
        // Chờ một nhịp cho trình xem PDF dựng xong trang; gọi print() ngay khi
        // onload bắn có thể ra bản in trắng
        setTimeout(() => {
          try {
            frame.contentWindow.focus()
            frame.contentWindow.print()
          } catch {
            window.open(objectUrl, '_blank', 'noopener')
          }
        }, 300)

        setTimeout(() => {
          frame.remove()
          URL.revokeObjectURL(objectUrl)
        }, 60000)
      }

      onClose()
    } catch (e) {
      onNotify?.(e.message || 'Không tải được tệp để in', false)
    } finally {
      setSending(false)
    }
  }

  const browserPrintable = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'html', 'htm', 'txt']
    .includes((asset.ext || '').toLowerCase())

  return (
    <div className="fixed inset-0 z-[105] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl
        flex flex-col" style={{ maxHeight: 'min(90svh, 760px)' }}>

        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-gray-100">
          <span className="text-xl">🖨</span>
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 text-base">In tệp</h2>
            <p className="text-xs text-gray-400 truncate">
              {asset.originalName} · {fmtSize(asset.sizeBytes)}
            </p>
          </div>
          <button onClick={onClose}
            className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg
              hover:bg-gray-100 text-gray-400 text-xl">×</button>
        </div>

        {/* Chọn đường in */}
        <div className="shrink-0 flex gap-1 px-5 pt-3">
          {[
            ['server',  '🖧 Máy in mạng', 'Máy in cùng mạng với máy chủ'],
            ['browser', '💻 Máy này',     'Máy in nối với máy bạn đang dùng'],
          ].map(([key, label, note]) => (
            <button key={key} onClick={() => setMode(key)}
              className={`flex-1 px-3 py-2.5 rounded-xl border text-left transition-colors
                ${mode === key
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 hover:bg-gray-50'}`}>
              <p className={`text-xs font-bold ${mode === key ? 'text-blue-700' : 'text-gray-600'}`}>
                {label}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{note}</p>
            </button>
          ))}
        </div>

        {/* Nội dung */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">

          {mode === 'browser' ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-sm text-gray-600 leading-relaxed">
                Trình duyệt sẽ mở hộp thoại in của hệ điều hành. Ở đó bạn chọn máy in,
                số bản và khổ giấy như khi in từ bất kỳ ứng dụng nào khác.
              </div>
              {!browserPrintable && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-4
                  text-sm text-amber-800 leading-relaxed">
                  Trình duyệt không hiển thị được định dạng <b>.{asset.ext}</b> nên không in
                  trực tiếp được. Hãy tải tệp về rồi in bằng ứng dụng tương ứng, hoặc
                  dùng đường <b>Máy in mạng</b>.
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Danh sách máy in đã kết nối */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Máy in đã kết nối</p>
                  <button onClick={refresh}
                    className="ml-auto text-xs font-semibold text-blue-600 hover:underline">
                    Làm mới
                  </button>
                </div>

                {loading ? (
                  <div className="space-y-2">
                    <SkeletonBox className="h-14" />
                    <SkeletonBox className="h-14" />
                  </div>
                ) : printers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center">
                    <p className="text-sm text-gray-400">Chưa có máy in nào</p>
                    <p className="text-xs text-gray-300 mt-1">Quét mạng bên dưới để tìm và thêm</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {printers.map(p => (
                      <button key={p.name} onClick={() => setSelected(p.name)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border
                          text-left transition-colors
                          ${selected === p.name
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-gray-200 hover:bg-gray-50'}`}>
                        <span className={`w-2 h-2 rounded-full shrink-0
                          ${p.ready ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                          <p className="text-[11px] text-gray-400">
                            {p.status}{p.isDefault && ' · mặc định'}
                          </p>
                        </div>
                        {selected === p.name && <span className="text-blue-600 shrink-0">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Quét mạng */}
              <section>
                <button onClick={scan} disabled={scanning}
                  className="w-full h-10 rounded-xl border border-gray-200 text-sm font-semibold
                    text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                  {scanning ? '🔄 Đang quét mạng...' : '🔍 Tìm máy in trong mạng'}
                </button>

                {scanning && (
                  <div className="mt-2 space-y-2">
                    <SkeletonBox className="h-12" />
                    <SkeletonBox className="h-12" />
                  </div>
                )}

                {found !== null && !scanning && (
                  found.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-400 text-center leading-relaxed">
                      Không thấy máy in nào. Kiểm tra máy in đã bật, đã bật Wi-Fi
                      và nằm cùng mạng với máy chủ.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {found.map(p => (
                        <div key={p.uri}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl
                            border border-gray-200 bg-gray-50/60">
                          <span className="text-base shrink-0">🖨</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                            <p className="text-[10px] text-gray-400 truncate font-mono">{p.uri}</p>
                          </div>
                          {p.connected ? (
                            <span className="text-[11px] text-emerald-600 font-semibold shrink-0">
                              Đã kết nối
                            </span>
                          ) : (
                            <button onClick={() => connect(p)} disabled={connecting === p.uri}
                              className="shrink-0 h-8 px-3 rounded-lg bg-blue-600 text-white
                                text-xs font-bold disabled:opacity-50">
                              {connecting === p.uri ? '...' : 'Kết nối'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </section>

              {/* Tuỳ chọn in */}
              {printers.length > 0 && (
                <section className="space-y-3 pt-1">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Tuỳ chọn</p>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Số bản">
                      <input type="number" min={1} max={99} value={copies}
                        onChange={e => setCopies(Math.max(1, Math.min(99, +e.target.value || 1)))}
                        className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm
                          outline-none focus:border-blue-400" />
                    </Field>

                    <Field label="Khổ giấy">
                      <select value={media} onChange={e => setMedia(e.target.value)}
                        className="w-full h-9 px-2 rounded-lg border border-gray-200 text-sm
                          bg-white outline-none focus:border-blue-400">
                        {PAPER.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </Field>
                  </div>

                  <Field label="Trang" hint="Bỏ trống để in tất cả. Ví dụ: 1-5 hoặc 2,4,7">
                    <input value={range} onChange={e => setRange(e.target.value)}
                      placeholder="Tất cả"
                      className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm
                        outline-none focus:border-blue-400 placeholder:text-gray-300" />
                  </Field>

                  <div className="space-y-1">
                    <Toggle checked={color}     onChange={setColor}     label="In màu" />
                    <Toggle checked={duplex}    onChange={setDuplex}    label="In hai mặt" />
                    <Toggle checked={landscape} onChange={setLandscape} label="Khổ ngang" />
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3.5 border-t border-gray-100 flex items-center gap-3">
          <button onClick={onClose}
            className="text-sm font-semibold text-gray-400 hover:text-gray-600">Đóng</button>
          <button onClick={send}
            disabled={sending || (mode === 'server' && !selected) || (mode === 'browser' && !browserPrintable)}
            className="ml-auto h-10 px-6 rounded-xl bg-blue-600 text-white text-sm font-bold
              disabled:opacity-30 disabled:cursor-not-allowed hover:bg-blue-700
              active:scale-[0.98] transition">
            {sending ? 'Đang gửi...' : '🖨 In'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Thành phần nhỏ ──────────────────────────────────────────────── */

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-300 mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <button onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 px-1 py-1.5 text-left">
      <span className={`w-9 h-5 rounded-full shrink-0 relative transition-colors
        ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all
          ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span className="text-sm text-gray-700">{label}</span>
    </button>
  )
}