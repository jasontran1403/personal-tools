import { useState, useRef, useCallback, useEffect } from 'react'
import SheetEditor from './SheetEditor'
import DocEditor from './DocEditor'
import { readWorkbook, writeWorkbook, writeCsv, emptySheet } from '../../lib/sheetIO'
import { readDocx, writeDocx, exportPdfViaPrint } from '../../lib/docxIO'
import { saveBlobAs, uploadFile, listFiles, fetchFileBuffer, fileUrl } from '../../services/filesApi'
import { SkeletonSheet, SkeletonDoc } from '../common/Skeleton'
import { extOf, fmtSize } from '../files/fileKind'
import Modal from '../common/Modal'

/**
 * Trang Office — mở bảng tính và tài liệu ngay trên trình duyệt.
 *
 * Khác trang Tệp ở chỗ: đây là bàn làm việc TẠM, tệp lấy thẳng từ máy người
 * dùng và không tự động lưu lên máy chủ. Muốn giữ lại thì bấm "Lưu vào kho Tệp".
 * Cách này để người ta xử lý nhanh một file gửi qua Zalo mà không làm kho tệp
 * đầy lên vì mấy bản nháp.
 *
 * Toàn bộ việc đọc/ghi chạy ở CLIENT — file không rời khỏi máy trừ khi người
 * dùng chủ động bấm lưu.
 */

const ACCEPT = '.xlsx,.xls,.xlsm,.csv,.tsv,.docx'
const ACCEPT_EXTS = ['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'docx']

/** 2026-10-10: Kiểm tra DataTransfer có ít nhất 1 file với extension hợp lệ. */
function dragHasAcceptable(dt) {
  if (!dt) return { any: false, allOk: false }
  // dt.items có cả filename trong một số trình duyệt; items chỉ cho MIME type khi drag,
  // name đọc được qua getAsFile() nhưng drag event chưa cho phép. Dùng mime-type suy ra.
  const items = dt.items ? Array.from(dt.items).filter(i => i.kind === 'file') : []
  if (items.length === 0) return { any: false, allOk: false }
  // Khi drag, chỉ có `type` (mime). Chúng ta coi là OK nếu mime hợp lệ hoặc trống (unknown).
  // Kiểm tra chặt khi drop (lúc có `name`).
  const okMime = (t) =>
       t === ''  // nhiều trình duyệt báo type rỗng cho .csv/.xlsx → coi là chưa biết, cho qua
    || t === 'text/csv'
    || t === 'text/tab-separated-values'
    || t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || t === 'application/vnd.ms-excel'
    || t === 'application/vnd.ms-excel.sheet.macroenabled.12'
    || t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const anyOk = items.some(i => okMime(i.type))
  return { any: true, allOk: anyOk }
}

/** Sau khi drop, kiểm tra chặt bằng extension của file name. */
function isAcceptableFile(file) {
  if (!file) return false
  return ACCEPT_EXTS.includes(extOf(file.name))
}

export default function OfficeWorkspace({ onNotify }) {
  const [doc, setDoc] = useState(null)
  // doc = { mode: 'sheet'|'doc', fileName, ext, size, sheets|html, tab, dirty }
  const [loading, setLoading] = useState(false)
  const [savingTo, setSaving] = useState(false)
  const [showExport, setExport] = useState(false)
  const [warnings, setWarn] = useState([])

  // ── 2026-10-10: Drag-and-drop state ──
  const [dragState, setDragState] = useState(null) // null | 'accept' | 'reject'
  const dragDepthRef = useRef(0)
  // ── 2026-10-10: Modal chọn file (từ máy / từ kho Tệp) ──
  const [showPicker, setShowPicker] = useState(false)

  const inputRef = useRef(null)

  // ── Mở tệp ──────────────────────────────────────────────────────

  const openFile = useCallback(async file => {
    const ext = extOf(file.name)
    const isSheet = ['xlsx', 'xls', 'xlsm', 'csv', 'tsv'].includes(ext)
    const isDoc   = ext === 'docx'

    if (!isSheet && !isDoc) {
      onNotify?.('Chỉ mở được Excel (.xlsx, .csv) và Word (.docx)', false)
      return
    }

    setLoading(true)
    setWarn([])
    try {
      const buffer = await file.arrayBuffer()

      if (isSheet) {
        const sheets = readWorkbook(buffer, ext)
        setDoc({
          mode: 'sheet', fileName: file.name, ext, size: file.size,
          sheets: sheets.length ? sheets : [emptySheet()],
          tab: 0, dirty: false,
        })
      } else {
        const { html, warnings: w } = await readDocx(buffer)
        setWarn(w)
        setDoc({
          mode: 'doc', fileName: file.name, ext, size: file.size,
          html, dirty: false,
        })
      }
    } catch (e) {
      onNotify?.(e.message || 'Không mở được tệp. Có thể tệp bị hỏng hoặc được bảo vệ bằng mật khẩu.', false)
    } finally {
      setLoading(false)
    }
  }, [onNotify])

  const newBlank = mode => {
    setWarn([])
    if (mode === 'sheet') {
      setDoc({
        mode: 'sheet', fileName: 'Bảng tính mới.xlsx', ext: 'xlsx', size: 0,
        sheets: [emptySheet()], tab: 0, dirty: false,
      })
    } else {
      setDoc({
        mode: 'doc', fileName: 'Tài liệu mới.docx', ext: 'docx', size: 0,
        html: '<h1>Tiêu đề</h1><p>Bắt đầu nhập nội dung...</p>', dirty: false,
      })
    }
  }

  const close = () => {
    if (doc?.dirty && !window.confirm('Có thay đổi chưa xuất ra tệp. Đóng và bỏ thay đổi?')) return
    setDoc(null)
    setWarn([])
  }

  // ── Xuất ────────────────────────────────────────────────────────

  const baseName = doc?.fileName.replace(/\.[^.]+$/, '') || 'tai-lieu'

  const buildBlob = async format => {
    if (format === 'xlsx') return writeWorkbook(doc.sheets)
    if (format === 'csv')  return writeCsv(doc.sheets[doc.tab])
    if (format === 'docx') return writeDocx(doc.html)
    return null
  }

  const exportAs = async format => {
    setExport(false)
    try {
      if (format === 'pdf') {
        exportPdfViaPrint(doc.html, baseName)
        return
      }
      const blob = await buildBlob(format)
      saveBlobAs(blob, `${baseName}.${format}`)
      onNotify?.(`Đã xuất ${format.toUpperCase()}`)
    } catch (e) {
      onNotify?.(e.message || 'Xuất tệp thất bại', false)
    }
  }

  /** Đẩy bản đang sửa lên kho Tệp — máy chủ tự chống trùng tên */
  const saveToLibrary = async () => {
    setSaving(true)
    try {
      const format = doc.mode === 'sheet'
        ? (doc.ext === 'csv' || doc.ext === 'tsv' ? 'csv' : 'xlsx')
        : 'docx'
      const blob = await buildBlob(format)
      const file = new File([blob], `${baseName}.${format}`)

      const saved = await uploadFile(file, baseName, null, undefined)
      setDoc(d => ({ ...d, dirty: false }))
      onNotify?.(`Đã lưu vào kho Tệp: ${saved.originalName}`)
    } catch (e) {
      onNotify?.(e.message || 'Lưu vào kho thất bại', false)
    } finally {
      setSaving(false)
    }
  }

  // ── Màn hình chọn tệp ───────────────────────────────────────────

  if (!doc && !loading) {
    // Visual theo trạng thái drag
    const dropCls =
        dragState === 'accept'
          ? 'border-emerald-500 bg-emerald-50 ring-4 ring-emerald-200'
      : dragState === 'reject'
          ? 'border-rose-500 bg-rose-50 ring-4 ring-rose-200'
      : 'border-gray-200 hover:border-blue-400'
    const dropIcon = dragState === 'reject' ? '🚫' : dragState === 'accept' ? '📥' : '📂'
    const dropTitle = dragState === 'reject'
          ? 'Loại tệp không hỗ trợ'
      : dragState === 'accept'
          ? 'Thả vào đây để mở'
          : 'Chọn tệp Excel hoặc Word'
    const dropHint = dragState === 'reject'
          ? 'Chỉ nhận .xlsx · .xls · .csv · .tsv · .docx'
      : dragState === 'accept'
          ? 'Nhả chuột để mở tệp'
          : '.xlsx · .xls · .csv · .docx — kéo thả vào đây hoặc click để chọn'

    return (
      <div className="py-6 sm:py-10">
        <div className="mx-auto w-full max-w-2xl">
          <button
            onClick={() => setShowPicker(true)}
            onDragEnter={e => {
              e.preventDefault()
              dragDepthRef.current++
              const { any, allOk } = dragHasAcceptable(e.dataTransfer)
              if (any) setDragState(allOk ? 'accept' : 'reject')
            }}
            onDragOver={e => { e.preventDefault() }}
            onDragLeave={e => {
              e.preventDefault()
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
              if (dragDepthRef.current === 0) setDragState(null)
            }}
            onDrop={e => {
              e.preventDefault()
              dragDepthRef.current = 0
              setDragState(null)
              const file = e.dataTransfer.files?.[0]
              if (!file) return
              if (!isAcceptableFile(file)) {
                onNotify?.(`Loại tệp .${extOf(file.name)} không hỗ trợ. Chỉ nhận ${ACCEPT_EXTS.map(x => '.' + x).join(', ')}.`, false)
                return
              }
              openFile(file)
            }}
            className={`w-full bg-white border-2 border-dashed rounded-2xl
              py-14 px-6 text-center transition-all ${dropCls}`}>
            <div className="text-4xl mb-3">{dropIcon}</div>
            <p className={`font-semibold ${
              dragState === 'reject' ? 'text-rose-700'
              : dragState === 'accept' ? 'text-emerald-700'
              : 'text-gray-700'
            }`}>{dropTitle}</p>
            <p className={`text-xs mt-1.5 ${
              dragState === 'reject' ? 'text-rose-600' : 'text-gray-400'
            }`}>{dropHint}</p>
          </button>
          <input ref={inputRef} type="file" hidden accept={ACCEPT}
            onChange={e => { if (e.target.files?.[0]) openFile(e.target.files[0]); e.target.value = '' }} />

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button onClick={() => newBlank('sheet')}
              className="bg-white border border-gray-200 rounded-xl py-5 text-center
                hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors">
              <div className="text-2xl mb-1.5">📊</div>
              <p className="text-sm font-semibold text-gray-700">Bảng tính trống</p>
            </button>
            <button onClick={() => newBlank('doc')}
              className="bg-white border border-gray-200 rounded-xl py-5 text-center
                hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
              <div className="text-2xl mb-1.5">📝</div>
              <p className="text-sm font-semibold text-gray-700">Tài liệu trống</p>
            </button>
          </div>

          <div className="mt-6 rounded-xl bg-gray-50 border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              Làm được gì ở đây
            </p>
            <ul className="text-xs text-gray-500 space-y-1.5 leading-relaxed">
              <li>• Bảng tính: sửa nội dung, dùng công thức (SUM, IF, VLOOKUP, HLOOKUP...),
                  định dạng ô, rồi xuất ra .xlsx hoặc .csv</li>
              <li>• Tài liệu: soạn thảo có tiêu đề, danh sách, bảng, rồi xuất ra .docx hoặc PDF</li>
              <li>• Tệp được xử lý ngay trên máy bạn, không gửi lên máy chủ trừ khi bấm lưu vào kho</li>
            </ul>
          </div>
        </div>

        {/* 2026-10-10: Modal chọn nguồn file */}
        {showPicker && (
          <FilePickerModal
            onClose={() => setShowPicker(false)}
            onPickDevice={() => { setShowPicker(false); inputRef.current?.click() }}
            onPickFromLibrary={async (asset) => {
              setShowPicker(false)
              setLoading(true)
              setWarn([])
              try {
                const ext = extOf(asset.originalName)
                const buffer = await fetchFileBuffer(asset.id, fileUrl(asset.storedPath || asset.url))
                const isSheet = ['xlsx', 'xls', 'xlsm', 'csv', 'tsv'].includes(ext)
                const isDoc   = ext === 'docx'
                if (!isSheet && !isDoc) {
                  onNotify?.('Chỉ mở được Excel (.xlsx, .csv) và Word (.docx)', false)
                  return
                }
                if (isSheet) {
                  const sheets = readWorkbook(buffer, ext)
                  setDoc({
                    mode: 'sheet', fileName: asset.originalName, ext, size: asset.sizeBytes || 0,
                    sheets: sheets.length ? sheets : [emptySheet()],
                    tab: 0, dirty: false,
                  })
                } else {
                  const { html, warnings: w } = await readDocx(buffer)
                  setWarn(w)
                  setDoc({
                    mode: 'doc', fileName: asset.originalName, ext, size: asset.sizeBytes || 0,
                    html, dirty: false,
                  })
                }
              } catch (e) {
                onNotify?.(e.message || 'Không mở được tệp từ kho.', false)
              } finally {
                setLoading(false)
              }
            }}
            onNotify={onNotify}
          />
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="py-4">
        <div className="bg-white rounded-2xl overflow-hidden border border-gray-100">
          <SkeletonSheet rows={10} />
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">Đang mở tệp...</p>
      </div>
    )
  }

  // ── Bàn làm việc ────────────────────────────────────────────────

  const isSheet = doc.mode === 'sheet'

  return (
    <div className="flex flex-col" style={{ height: 'calc(100svh - 44px - 16px)' }}>

      {/* Thanh tệp */}
      <div className="shrink-0 flex items-center gap-2 py-2.5">
        <span className="text-lg shrink-0">{isSheet ? '📊' : '📝'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{doc.fileName}</p>
          <p className="text-[11px] text-gray-400">
            {doc.size ? fmtSize(doc.size) : 'Tệp mới'}
            {doc.dirty && <span className="text-amber-600 font-semibold"> · chưa xuất</span>}
          </p>
        </div>

        <button onClick={saveToLibrary} disabled={savingTo}
          className="h-9 px-3 rounded-lg border border-gray-200 text-gray-600 text-xs
            font-semibold hover:bg-gray-50 disabled:opacity-40 transition shrink-0 whitespace-nowrap">
          {savingTo ? 'Đang lưu...' : '📥 Lưu vào kho'}
        </button>

        <div className="relative shrink-0">
          <button onClick={() => setExport(v => !v)}
            className="h-9 px-3.5 rounded-lg bg-blue-600 text-white text-xs font-bold
              hover:bg-blue-700 transition whitespace-nowrap">
            Xuất ▾
          </button>
          {showExport && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setExport(false)} />
              <div className="absolute right-0 top-11 z-50 w-56 bg-white rounded-xl
                shadow-xl border border-gray-100 py-1.5">
                {isSheet ? (
                  <>
                    <ExportItem onClick={() => exportAs('xlsx')}
                      title="Excel (.xlsx)" note="Giữ công thức, định dạng, nhiều trang" />
                    <ExportItem onClick={() => exportAs('csv')}
                      title="CSV (.csv)" note="Chỉ giá trị của trang đang mở" />
                  </>
                ) : (
                  <>
                    <ExportItem onClick={() => exportAs('docx')}
                      title="Word (.docx)" note="Giữ tiêu đề, danh sách, bảng" />
                    <ExportItem onClick={() => exportAs('pdf')}
                      title="PDF" note="Chọn 'Lưu thành PDF' ở hộp thoại in" />
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <button onClick={close} title="Đóng tệp"
          className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center
            text-gray-400 hover:bg-gray-100 text-xl">×</button>
      </div>

      {warnings.length > 0 && (
        <div className="shrink-0 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100
          text-[11px] text-amber-700">
          {warnings.length} phần của tài liệu không chuyển đổi được (thường là ảnh nhúng
          hoặc kiểu định dạng riêng). Nội dung chữ vẫn đầy đủ.
        </div>
      )}

      {/* Vùng làm việc */}
      <div className="flex-1 min-h-0 bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col">
        {isSheet ? (
          <>
            <SheetEditor
              sheet={doc.sheets[doc.tab]}
              onChange={next => setDoc(d => ({
                ...d,
                sheets: d.sheets.map((s, i) => i === d.tab ? next : s),
                dirty: true,
              }))}
              className="flex-1 min-h-0"
            />

            {/* Thanh trang tính */}
            <div className="shrink-0 flex items-center gap-1 px-2 py-1.5
              border-t border-gray-200 bg-gray-100 overflow-x-auto">
              {doc.sheets.map((s, i) => (
                <button key={i} onClick={() => setDoc(d => ({ ...d, tab: i }))}
                  className={`px-3 h-7 rounded-t-lg text-xs font-semibold whitespace-nowrap transition-colors
                    ${i === doc.tab ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:bg-white/60'}`}>
                  {s.name}
                </button>
              ))}
              <button
                onClick={() => setDoc(d => ({
                  ...d,
                  sheets: [...d.sheets, emptySheet(`Trang ${d.sheets.length + 1}`)],
                  tab: d.sheets.length,
                  dirty: true,
                }))}
                title="Thêm trang tính"
                className="w-7 h-7 shrink-0 rounded-lg text-gray-400 hover:bg-white/60 text-base">
                ＋
              </button>
            </div>
          </>
        ) : (
          <DocEditor
            html={doc.html}
            onChange={next => setDoc(d => ({ ...d, html: next, dirty: true }))}
            className="h-full"
          />
        )}
      </div>
    </div>
  )
}

function ExportItem({ onClick, title, note }) {
  return (
    <button onClick={onClick}
      className="w-full text-left px-3.5 py-2 hover:bg-gray-50 transition-colors">
      <p className="text-sm font-medium text-gray-800">{title}</p>
      <p className="text-[11px] text-gray-400 leading-snug">{note}</p>
    </button>
  )
}

/**
 * ── 2026-10-10 ──────────────────────────────────────────────
 * Modal chọn nguồn file để mở trong Office:
 *   1) Từ máy  → gọi onPickDevice() → parent trigger input file
 *   2) Từ kho Tệp → list files Office có extension hợp lệ, click chọn 1 file
 */
function FilePickerModal({ onClose, onPickDevice, onPickFromLibrary, onNotify }) {
  const [tab, setTab] = useState('menu') // 'menu' | 'library'
  const [files, setFiles] = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (tab !== 'library') return
    let cancel = false
    setLoadingFiles(true)
    listFiles(0, 100, { exts: ACCEPT_EXTS, q: q.trim() || undefined })
      .then(d => {
        if (cancel) return
        setFiles(d?.content || d?.items || d || [])
      })
      .catch(e => { if (!cancel) onNotify?.(e.message || 'Không tải được danh sách tệp', false) })
      .finally(() => { if (!cancel) setLoadingFiles(false) })
    return () => { cancel = true }
  }, [tab, q, onNotify])

  return (
    <Modal open onClose={onClose} title="Mở tệp" size="lg">
      {tab === 'menu' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={onPickDevice}
            className="p-5 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50/40 transition text-left">
            <div className="text-3xl mb-2">💻</div>
            <div className="font-bold text-gray-900">Từ máy của bạn</div>
            <div className="text-xs text-gray-500 mt-1">
              Chọn file .xlsx, .xls, .csv, .docx trên máy. File không bị tải lên server.
            </div>
          </button>
          <button onClick={() => setTab('library')}
            className="p-5 rounded-xl border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/40 transition text-left">
            <div className="text-3xl mb-2">📁</div>
            <div className="font-bold text-gray-900">Từ kho Tệp</div>
            <div className="text-xs text-gray-500 mt-1">
              Chọn file đã lưu trong tab Tệp của hệ thống.
            </div>
          </button>
        </div>
      )}

      {tab === 'library' && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setTab('menu')}
              className="px-2 py-1 rounded text-xs text-gray-600 hover:bg-gray-100">← Quay lại</button>
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Tìm theo tên tệp…"
              className="flex-1 px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="max-h-[60dvh] overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
            {loadingFiles ? (
              <div className="p-6 text-center text-sm text-gray-400">Đang tải…</div>
            ) : files.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                Không có tệp Office nào trong kho{q ? ' khớp tìm kiếm' : ''}.
              </div>
            ) : files.map(f => (
              <button key={f.id} onClick={() => onPickFromLibrary(f)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 text-left transition">
                <span className="text-xl">{iconForExt(extOf(f.originalName || f.name))}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {f.originalName || f.name}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {f.sizeBytes ? fmtSize(f.sizeBytes) : ''}
                    {f.createdAt && ` · ${new Date(f.createdAt).toLocaleString('vi-VN')}`}
                  </div>
                </div>
                <span className="text-[10px] uppercase font-bold text-gray-400">
                  {extOf(f.originalName || f.name)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function iconForExt(ext) {
  if (['xlsx', 'xls', 'xlsm', 'csv', 'tsv'].includes(ext)) return '📊'
  if (ext === 'docx') return '📝'
  return '📄'
}