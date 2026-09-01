import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchFileText, fetchFileBuffer, saveFileContent, downloadFileAsset, saveBlobAs,
} from '../../services/filesApi'
import { KIND, kindOf, iconOf, badgeClassOf, fmtSize, fmtDateTime } from './fileKind'
import { readWorkbook, writeWorkbook, writeCsv, emptySheet } from '../../lib/sheetIO'
import { readDocx, writeDocx, exportPdfViaPrint } from '../../lib/docxIO'
import SheetEditor from '../office/SheetEditor'
import DocEditor from '../office/DocEditor'
import CodeViewer from './preview/CodeViewer'
import {
  MarkdownViewer, TextViewer, PdfViewer, ImageViewer, VideoViewer, MetaViewer,
} from './preview/SimpleViewers'
import {
  SkeletonSheet, SkeletonDoc, SkeletonCode, SkeletonBox, SkeletonLines,
} from '../common/Skeleton'

/**
 * Chỉ những loại này mới hiện nút in: PDF, bảng tính (xlsx/csv), tài liệu Word.
 * Đều là tài liệu có bố cục trang rõ ràng nên in ra đúng như đang thấy.
 */
const PRINTABLE = new Set([KIND.PDF, KIND.SHEET, KIND.DOC])

/**
 * Xem trước một tệp, mở bằng cách bấm vào dòng ở danh sách.
 *
 * Chọn trình xem theo ĐUÔI FILE (fileKind.js), không theo kiểu MIME: nhiều máy
 * chủ trả về application/octet-stream cho mọi thứ, còn điện thoại Android hay
 * gửi content-type rỗng.
 *
 * Bảng tính và tài liệu sửa được rồi lưu đè; các loại còn lại chỉ xem.
 */
export default function FilePreviewModal({ asset, onClose, onSaved, onNotify, onPrint }) {
  const kind = kindOf(asset)

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [dirty, setDirty]     = useState(false)
  const [showExport, setExport] = useState(false)

  // Nội dung theo từng loại
  const [text, setText]     = useState('')
  const [sheets, setSheets] = useState([])
  const [tab, setTab]       = useState(0)
  const [html, setHtml]     = useState('')
  const [warnings, setWarn] = useState([])

  const abortRef = useRef(false)

  // ── Nạp nội dung ────────────────────────────────────────────────
  useEffect(() => {
    abortRef.current = false
    setLoading(true)
    setError('')
    setDirty(false)

    const load = async () => {
      try {
        if (kind === KIND.CODE || kind === KIND.SQL || kind === KIND.MARKDOWN || kind === KIND.TEXT) {
          const data = await fetchFileText(asset.id)
          if (!abortRef.current) setText(data.content ?? '')

        } else if (kind === KIND.SHEET) {
          const buf = await fetchFileBuffer(asset.id, asset.url)
          const parsed = readWorkbook(buf, asset.ext)
          if (!abortRef.current) {
            setSheets(parsed.length ? parsed : [emptySheet()])
            setTab(0)
          }

        } else if (kind === KIND.DOC) {
          const buf = await fetchFileBuffer(asset.id, asset.url)
          const { html: converted, warnings: w } = await readDocx(buf)
          if (!abortRef.current) { setHtml(converted); setWarn(w) }
        }
        // Ảnh / video / pdf tự tải lấy qua thẻ của chúng
      } catch (e) {
        if (!abortRef.current) setError(e.message || 'Không mở được tệp')
      } finally {
        if (!abortRef.current) setLoading(false)
      }
    }

    load()
    return () => { abortRef.current = true }
  }, [asset.id, asset.url, asset.ext, kind])

  // ── Khoá cuộn nền + phím tắt ────────────────────────────────────
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = e => {
      if (e.key === 'Escape' && !showExport) attemptClose()
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  })   // cố ý không có mảng phụ thuộc: handler phải luôn thấy state mới nhất

  const attemptClose = () => {
    if (dirty && !window.confirm('Có thay đổi chưa lưu. Đóng và bỏ thay đổi?')) return
    onClose()
  }

  // ── Lưu đè ──────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      let blob, name = asset.originalName

      if (kind === KIND.SHEET) {
        // CSV chỉ chứa được MỘT bảng và không giữ công thức/định dạng.
        // Lưu đè file .csv thì ghi lại đúng dạng csv, không âm thầm đổi sang xlsx.
        blob = (asset.ext === 'csv' || asset.ext === 'tsv')
          ? writeCsv(sheets[tab])
          : writeWorkbook(sheets)
      } else if (kind === KIND.DOC) {
        blob = await writeDocx(html)
      } else {
        setSaving(false)
        return
      }

      const updated = await saveFileContent(asset.id, blob, name)
      setDirty(false)
      onSaved?.(updated)
      onNotify?.('Đã lưu thay đổi')
    } catch (e) {
      onNotify?.(e.message || 'Lưu thất bại', false)
    } finally {
      setSaving(false)
    }
  }, [dirty, saving, kind, sheets, tab, html, asset, onSaved, onNotify])

  // ── Xuất file ───────────────────────────────────────────────────
  const baseName = asset.originalName.replace(/\.[^.]+$/, '')

  const exportAs = async format => {
    setExport(false)
    try {
      if (format === 'xlsx') {
        saveBlobAs(writeWorkbook(sheets), `${baseName}.xlsx`)
      } else if (format === 'csv') {
        saveBlobAs(writeCsv(sheets[tab]), `${baseName}.csv`)
      } else if (format === 'docx') {
        saveBlobAs(await writeDocx(html), `${baseName}.docx`)
      } else if (format === 'pdf') {
        exportPdfViaPrint(html, baseName)
      }
      if (format !== 'pdf') onNotify?.(`Đã xuất ${format.toUpperCase()}`)
    } catch (e) {
      onNotify?.(e.message || 'Xuất tệp thất bại', false)
    }
  }

  const download = async () => {
    try {
      await downloadFileAsset(asset)
    } catch {
      onNotify?.('Không tải được tệp', false)
    }
  }

  const editable = kind === KIND.SHEET || kind === KIND.DOC
  const darkFrame = kind === KIND.IMAGE || kind === KIND.VIDEO

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/70 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) attemptClose() }}>

      <div className="flex-1 min-h-0 flex flex-col m-0 sm:m-4 lg:m-6 bg-white
        sm:rounded-2xl overflow-hidden shadow-2xl">

        {/* Thanh trên */}
        <header className="shrink-0 flex items-center gap-2 px-3 sm:px-4 h-14 border-b border-gray-200 bg-white"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}>

          <button onClick={attemptClose} aria-label="Đóng"
            className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center
              text-gray-400 hover:bg-gray-100 text-xl">
            ✕
          </button>

          <span className="text-lg shrink-0">{iconOf(asset)}</span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 truncate">{asset.originalName}</p>
            <p className="text-[11px] text-gray-400 truncate">
              {fmtSize(asset.sizeBytes)} · {fmtDateTime(asset.createdAt)}
              {dirty && <span className="text-amber-600 font-semibold"> · Chưa lưu</span>}
            </p>
          </div>

          <span className={`hidden sm:inline-flex shrink-0 px-2 py-0.5 rounded-md border
            text-[10px] font-bold uppercase ${badgeClassOf(asset)}`}>
            {asset.ext || 'file'}
          </span>

          {/* Hành động */}
          <div className="flex items-center gap-1.5 shrink-0">
            {editable && (
              <button onClick={save} disabled={!dirty || saving}
                className="h-9 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold
                  disabled:opacity-30 disabled:cursor-not-allowed hover:bg-blue-700 transition">
                {saving ? 'Đang lưu...' : '💾 Lưu'}
              </button>
            )}

            {editable && (
              <div className="relative">
                <button onClick={() => setExport(v => !v)}
                  className="h-9 px-3 rounded-lg border border-gray-200 text-gray-600
                    text-xs font-semibold hover:bg-gray-50 transition whitespace-nowrap">
                  Xuất ▾
                </button>
                {showExport && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setExport(false)} />
                    <div className="absolute right-0 top-11 z-50 w-52 bg-white rounded-xl
                      shadow-xl border border-gray-100 py-1.5">
                      {kind === KIND.SHEET ? (
                        <>
                          <ExportItem onClick={() => exportAs('xlsx')}
                            title="Excel (.xlsx)" note="Giữ công thức và định dạng" />
                          <ExportItem onClick={() => exportAs('csv')}
                            title="CSV (.csv)" note="Chỉ giá trị, một trang" />
                        </>
                      ) : (
                        <>
                          <ExportItem onClick={() => exportAs('docx')}
                            title="Word (.docx)" note="Giữ cấu trúc và định dạng" />
                          <ExportItem onClick={() => exportAs('pdf')}
                            title="PDF" note="Qua hộp thoại in của trình duyệt" />
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/*
              In chỉ có nghĩa với tài liệu có bố cục trang. Ảnh, video, mã nguồn
              hay markdown thì lệnh in ra kết quả khó đoán, nên ẩn nút đi thay vì
              để người dùng bấm rồi thất vọng.
            */}
            {onPrint && PRINTABLE.has(kind) && (
              <button onClick={() => onPrint(asset)} title="In"
                className="w-9 h-9 rounded-lg flex items-center justify-center
                  text-gray-400 hover:bg-gray-100">
                🖨
              </button>
            )}

            <button onClick={download} title="Tải về"
              className="w-9 h-9 rounded-lg flex items-center justify-center
                text-gray-400 hover:bg-gray-100">
              ⬇
            </button>
          </div>
        </header>

        {/* Cảnh báo từ bộ chuyển đổi Word */}
        {warnings.length > 0 && !loading && (
          <div className="shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-100
            text-[11px] text-amber-700">
            Một số phần của tài liệu không chuyển đổi được ({warnings.length} cảnh báo).
            Nội dung chữ vẫn đầy đủ, nhưng nên đối chiếu với bản gốc trước khi lưu đè.
          </div>
        )}

        {/* Nội dung */}
        <div className={`flex-1 min-h-0 ${darkFrame ? 'bg-neutral-900' : 'bg-gray-50'}`}>
          {error ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <span className="text-4xl">⚠️</span>
              <p className="text-sm text-gray-600 max-w-sm">{error}</p>
              <button onClick={download}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">
                Tải về máy
              </button>
            </div>
          ) : loading ? (
            <LoadingFor kind={kind} />
          ) : (
            <Body
              kind={kind} asset={asset}
              text={text}
              sheets={sheets} tab={tab} setTab={setTab}
              onSheetChange={next => {
                setSheets(prev => prev.map((s, i) => i === tab ? next : s))
                setDirty(true)
              }}
              html={html}
              onHtmlChange={next => { setHtml(next); setDirty(true) }}
              onDownload={download}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Bộ khung xương theo loại ─────────────────────────────────────── */

function LoadingFor({ kind }) {
  if (kind === KIND.SHEET) return <SkeletonSheet />
  if (kind === KIND.DOC)   return <div className="py-6 px-3 h-full overflow-hidden"><SkeletonDoc /></div>
  if (kind === KIND.CODE || kind === KIND.SQL) {
    return <div className="h-full bg-[#1e1e1e]"><SkeletonCode /></div>
  }
  if (kind === KIND.MARKDOWN || kind === KIND.TEXT) {
    return (
      <div className="py-6 px-3">
        <div className="mx-auto max-w-3xl bg-white rounded-xl p-8 space-y-5">
          <SkeletonBox className="h-6 w-1/2" />
          <SkeletonLines lines={6} />
          <SkeletonBox className="h-4 w-1/3" />
          <SkeletonLines lines={4} />
        </div>
      </div>
    )
  }
  return (
    <div className="h-full flex items-center justify-center">
      <SkeletonBox className="w-2/3 max-w-lg h-64" />
    </div>
  )
}

/* ── Chọn trình xem ──────────────────────────────────────────────── */

function Body({
  kind, asset, text, sheets, tab, setTab, onSheetChange, html, onHtmlChange, onDownload,
}) {
  switch (kind) {
    case KIND.IMAGE:
      return <ImageViewer url={asset.url} alt={asset.originalName} />

    case KIND.VIDEO:
      return <VideoViewer url={asset.url} />

    case KIND.PDF:
      return <PdfViewer url={asset.url} fileName={asset.originalName} />

    case KIND.SHEET:
      return (
        <div className="h-full flex flex-col min-h-0">
          <SheetEditor
            sheet={sheets[tab] || sheets[0]}
            onChange={onSheetChange}
            className="flex-1 min-h-0"
          />
          {/* Thanh trang tính — chỉ hiện khi file có nhiều hơn một trang */}
          {sheets.length > 1 && (
            <div className="shrink-0 flex items-center gap-1 px-2 py-1.5
              border-t border-gray-200 bg-gray-100 overflow-x-auto">
              {sheets.map((s, i) => (
                <button key={i} onClick={() => setTab(i)}
                  className={`px-3 h-7 rounded-t-lg text-xs font-semibold whitespace-nowrap transition-colors
                    ${i === tab
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-gray-500 hover:bg-white/60'}`}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )

    case KIND.DOC:
      return <DocEditor html={html} onChange={onHtmlChange} className="h-full" />

    case KIND.CODE:
    case KIND.SQL:
      return <CodeViewer content={text} ext={asset.ext} fileName={asset.originalName} />

    case KIND.MARKDOWN:
      return <MarkdownViewer content={text} />

    case KIND.TEXT:
      return <TextViewer content={text} />

    default:
      return <MetaViewer asset={asset} onDownload={onDownload} />
  }
}

function ExportItem({ onClick, title, note }) {
  return (
    <button onClick={onClick}
      className="w-full text-left px-3.5 py-2 hover:bg-gray-50 transition-colors">
      <p className="text-sm font-medium text-gray-800">{title}</p>
      <p className="text-[11px] text-gray-400">{note}</p>
    </button>
  )
}