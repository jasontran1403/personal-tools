import { useState, useRef, useCallback } from 'react'
import SheetEditor from './SheetEditor'
import DocEditor from './DocEditor'
import { readWorkbook, writeWorkbook, writeCsv, emptySheet } from '../../lib/sheetIO'
import { readDocx, writeDocx, exportPdfViaPrint } from '../../lib/docxIO'
import { saveBlobAs, uploadFile } from '../../services/filesApi'
import { SkeletonSheet, SkeletonDoc } from '../common/Skeleton'
import { extOf, fmtSize } from '../files/fileKind'

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

export default function OfficeWorkspace({ onNotify }) {
  const [doc, setDoc] = useState(null)
  // doc = { mode: 'sheet'|'doc', fileName, ext, size, sheets|html, tab, dirty }
  const [loading, setLoading] = useState(false)
  const [savingTo, setSaving] = useState(false)
  const [showExport, setExport] = useState(false)
  const [warnings, setWarn] = useState([])

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
    return (
      <div className="py-6 sm:py-10">
        <div className="mx-auto w-full max-w-2xl">
          <button
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              if (e.dataTransfer.files?.[0]) openFile(e.dataTransfer.files[0])
            }}
            className="w-full bg-white border-2 border-dashed border-gray-200 rounded-2xl
              py-14 px-6 text-center hover:border-blue-400 transition-colors">
            <div className="text-4xl mb-3">📂</div>
            <p className="font-semibold text-gray-700">Chọn tệp Excel hoặc Word</p>
            <p className="text-xs text-gray-400 mt-1.5">
              .xlsx · .xls · .csv · .docx — hoặc kéo thả vào đây
            </p>
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
