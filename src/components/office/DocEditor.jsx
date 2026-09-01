import { useRef, useEffect, useState, useCallback } from 'react'

/**
 * Trình soạn thảo tài liệu — kiểu Google Docs.
 *
 * Dùng contentEditable + document.execCommand. execCommand đã bị đánh dấu lỗi
 * thời trên MDN, nhưng thứ thay thế nó (Selection API thuần) thì phải tự viết
 * lại toàn bộ logic đậm/nghiêng/danh sách, còn các trình soạn thảo đầy đủ
 * (TipTap, Slate, Lexical) kéo theo 100–200 KB. Với nhu cầu "sửa vài chữ trong
 * hợp đồng rồi xuất lại" thì execCommand vẫn chạy tốt trên mọi trình duyệt hiện
 * hành và là lựa chọn cân bằng nhất.
 *
 * Khổ giấy A4 được mô phỏng bằng chiều rộng cố định 794px (= 21cm ở 96 dpi) để
 * người dùng thấy trước tài liệu sẽ xuống dòng ở đâu khi in.
 */

const PAGE_WIDTH = 794

export default function DocEditor({ html, onChange, readOnly = false, className = '' }) {
  const ref = useRef(null)
  const [fmt, setFmt] = useState({})
  // Dựng lại nội dung từ prop chỉ ở lần đầu và khi mở file khác — nếu đồng bộ
  // mỗi lần gõ thì con trỏ nhảy về đầu sau từng ký tự
  const seeded = useRef(false)

  useEffect(() => {
    if (!ref.current) return
    if (seeded.current && ref.current.innerHTML === html) return
    ref.current.innerHTML = html || '<p></p>'
    seeded.current = true
  }, [html])

  const emit = useCallback(() => {
    if (ref.current) onChange?.(ref.current.innerHTML)
  }, [onChange])

  /** Đọc trạng thái định dạng tại con trỏ để tô sáng nút trên thanh công cụ */
  const refreshFormat = useCallback(() => {
    if (readOnly) return
    try {
      setFmt({
        bold:      document.queryCommandState('bold'),
        italic:    document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        ul:        document.queryCommandState('insertUnorderedList'),
        ol:        document.queryCommandState('insertOrderedList'),
        block:     document.queryCommandValue('formatBlock')?.toLowerCase(),
        align:
          document.queryCommandState('justifyCenter') ? 'center'
          : document.queryCommandState('justifyRight') ? 'right'
          : document.queryCommandState('justifyFull') ? 'justify'
          : 'left',
      })
    } catch {
      // Safari ném lỗi khi chưa có vùng chọn nào — bỏ qua, lần sau vẫn chạy
    }
  }, [readOnly])

  useEffect(() => {
    document.addEventListener('selectionchange', refreshFormat)
    return () => document.removeEventListener('selectionchange', refreshFormat)
  }, [refreshFormat])

  const exec = (cmd, value) => {
    if (readOnly) return
    ref.current?.focus()
    document.execCommand(cmd, false, value)
    refreshFormat()
    emit()
  }

  /**
   * Dán dưới dạng CHỮ THUẦN.
   * Dán thẳng từ Word/trang web sẽ kéo theo hàng trăm thẻ span kèm style tuyệt
   * đối, làm tài liệu phình to và xuất ra .docx thì lệch lạc hết.
   */
  const onPaste = e => {
    if (readOnly) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    emit()
  }

  const onKeyDown = e => {
    // Tab trong tài liệu phải là thụt lề, không phải nhảy sang nút kế tiếp
    if (e.key === 'Tab') {
      e.preventDefault()
      exec(e.shiftKey ? 'outdent' : 'indent')
    }
  }

  const insertTable = () => {
    const rows = 3, cols = 3
    let html = '<table style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>'
    for (let r = 0; r < rows; r++) {
      html += '<tr>'
      for (let c = 0; c < cols; c++) {
        const tag = r === 0 ? 'th' : 'td'
        const style = 'border:1px solid #cbd5e1;padding:6px 8px' +
          (r === 0 ? ';background:#f1f5f9' : '')
        html += `<${tag} style="${style}">${r === 0 ? 'Tiêu đề' : ''}</${tag}>`
      }
      html += '</tr>'
    }
    html += '</tbody></table><p></p>'
    exec('insertHTML', html)
  }

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>

      {!readOnly && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200
          bg-white overflow-x-auto">

          <select
            value={fmt.block?.match(/^h[1-3]$/) ? fmt.block : 'p'}
            onChange={e => exec('formatBlock', `<${e.target.value}>`)}
            className="h-8 px-2 rounded-lg border border-gray-200 text-xs font-semibold
              text-gray-600 bg-white outline-none focus:border-blue-400 shrink-0">
            <option value="p">Văn bản</option>
            <option value="h1">Tiêu đề 1</option>
            <option value="h2">Tiêu đề 2</option>
            <option value="h3">Tiêu đề 3</option>
          </select>

          <Divider />

          <Btn active={fmt.bold}      onClick={() => exec('bold')}      title="Đậm (Ctrl+B)"><b>B</b></Btn>
          <Btn active={fmt.italic}    onClick={() => exec('italic')}    title="Nghiêng (Ctrl+I)"><i>I</i></Btn>
          <Btn active={fmt.underline} onClick={() => exec('underline')} title="Gạch chân (Ctrl+U)"><u>U</u></Btn>

          <Divider />

          <Btn active={fmt.align === 'left'}    onClick={() => exec('justifyLeft')}   title="Căn trái">⬅</Btn>
          <Btn active={fmt.align === 'center'}  onClick={() => exec('justifyCenter')} title="Căn giữa">↔</Btn>
          <Btn active={fmt.align === 'right'}   onClick={() => exec('justifyRight')}  title="Căn phải">➡</Btn>
          <Btn active={fmt.align === 'justify'} onClick={() => exec('justifyFull')}   title="Căn đều">☰</Btn>

          <Divider />

          <Btn active={fmt.ul} onClick={() => exec('insertUnorderedList')} title="Danh sách dấu chấm">•</Btn>
          <Btn active={fmt.ol} onClick={() => exec('insertOrderedList')}   title="Danh sách đánh số">1.</Btn>
          <Btn onClick={insertTable} title="Chèn bảng">▦</Btn>

          <Divider />

          <input type="color" defaultValue="#111827"
            onChange={e => exec('foreColor', e.target.value)}
            title="Màu chữ"
            className="w-8 h-8 shrink-0 rounded-lg border border-gray-200 cursor-pointer bg-white p-0.5" />

          <Btn onClick={() => exec('removeFormat')} title="Xoá định dạng">⌫</Btn>
          <Btn onClick={() => exec('undo')} title="Hoàn tác (Ctrl+Z)">↶</Btn>
          <Btn onClick={() => exec('redo')} title="Làm lại">↷</Btn>
        </div>
      )}

      {/* Vùng giấy */}
      <div className="flex-1 min-h-0 overflow-auto bg-gray-100 py-6 px-3">
        <style>{`
          .doc-page { width: ${PAGE_WIDTH}px; max-width: 100%; }
          .doc-page h1 { font-size: 24px; font-weight: 700; margin: 18px 0 10px; }
          .doc-page h2 { font-size: 20px; font-weight: 700; margin: 16px 0 8px; }
          .doc-page h3 { font-size: 17px; font-weight: 600; margin: 14px 0 6px; }
          .doc-page p  { margin: 0 0 10px; min-height: 1.5em; }
          .doc-page ul, .doc-page ol { margin: 0 0 10px 24px; }
          .doc-page li { margin-bottom: 4px; }
          .doc-page table { border-collapse: collapse; width: 100%; margin: 10px 0; }
          .doc-page th, .doc-page td { border: 1px solid #cbd5e1; padding: 6px 8px; }
          .doc-page th { background: #f1f5f9; font-weight: 600; }
          .doc-page blockquote {
            margin: 0 0 10px; padding: 4px 0 4px 14px;
            border-left: 3px solid #cbd5e1; color: #475569;
          }
          .doc-page img { max-width: 100%; height: auto; }
          .doc-page:focus { outline: none; }
          .doc-page:empty::before { content: 'Bắt đầu nhập nội dung...'; color: #cbd5e1; }
        `}</style>

        <div
          ref={ref}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onMouseUp={refreshFormat}
          spellCheck={false}
          className="doc-page mx-auto bg-white rounded-lg shadow-sm px-[76px] py-[64px]
            text-[15px] leading-[1.75] text-gray-900"
          style={{ fontFamily: '"Times New Roman", Times, serif', minHeight: 900 }}
        />
      </div>
    </div>
  )
}

function Btn({ active, onClick, title, children }) {
  return (
    <button
      // onMouseDown + preventDefault: nếu để onClick thì việc bấm nút đã làm
      // mất vùng chọn trong tài liệu trước khi lệnh kịp chạy
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={`w-8 h-8 shrink-0 rounded-lg text-sm flex items-center justify-center transition-colors
        ${active ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}

const Divider = () => <span className="w-px h-5 bg-gray-200 mx-1 shrink-0" />
