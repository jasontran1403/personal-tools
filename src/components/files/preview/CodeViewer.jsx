import { useMemo, useState } from 'react'
import hljs from 'highlight.js/lib/common'
import { format as formatSql } from 'sql-formatter'
import { hljsLangOf } from '../fileKind'

/**
 * Xem mã nguồn kiểu IDE.
 *
 * Bảng màu lấy theo Dark+ của VS Code — cùng tông với thứ lập trình viên nhìn
 * cả ngày, nên đọc trong này không phải điều tiết lại mắt. Tự viết CSS thay vì
 * import file theme của highlight.js để không phải kéo thêm một tệp CSS toàn
 * cục có nguy cơ đè lên phần còn lại của ứng dụng.
 *
 * File .sql được ĐỊNH DẠNG LẠI trước khi tô màu: câu lệnh trong file thật hay
 * nằm gọn một dòng dài 400 ký tự, tô màu cũng không cứu nổi. sql-formatter tách
 * mệnh đề, thụt lề JOIN/WHERE cho ra hình khối đọc được.
 */

const VSCODE_DARK = `
  .code-view { background: #1e1e1e; color: #d4d4d4; }
  .code-view .hljs-keyword,
  .code-view .hljs-selector-tag       { color: #569cd6; }
  .code-view .hljs-built_in,
  .code-view .hljs-type               { color: #4ec9b0; }
  .code-view .hljs-string,
  .code-view .hljs-meta .hljs-string  { color: #ce9178; }
  .code-view .hljs-number,
  .code-view .hljs-literal            { color: #b5cea8; }
  .code-view .hljs-comment,
  .code-view .hljs-quote              { color: #6a9955; font-style: italic; }
  .code-view .hljs-title,
  .code-view .hljs-title.function_    { color: #dcdcaa; }
  .code-view .hljs-title.class_,
  .code-view .hljs-class .hljs-title  { color: #4ec9b0; }
  .code-view .hljs-variable,
  .code-view .hljs-params,
  .code-view .hljs-attr               { color: #9cdcfe; }
  .code-view .hljs-attribute          { color: #9cdcfe; }
  .code-view .hljs-name,
  .code-view .hljs-tag                { color: #569cd6; }
  .code-view .hljs-property           { color: #9cdcfe; }
  .code-view .hljs-symbol,
  .code-view .hljs-meta               { color: #c586c0; }
  .code-view .hljs-regexp             { color: #d16969; }
  .code-view .hljs-deletion           { color: #f48771; }
  .code-view .hljs-addition           { color: #b5cea8; }
`

/** Phương ngữ SQL đoán theo nội dung — sai phương ngữ thì format ra sai cú pháp */
const guessSqlDialect = sql => {
  const s = sql.toLowerCase()
  if (/\bnvarchar\b|\btop\s+\d|\[dbo\]/.test(s)) return 'transactsql'
  if (/\bengine\s*=|\bauto_increment\b|`/.test(s)) return 'mysql'
  if (/\bserial\b|\breturning\b|::/.test(s)) return 'postgresql'
  return 'sql'
}

export default function CodeViewer({ content, ext, fileName }) {
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState(false)

  const { lines, language, formatted } = useMemo(() => {
    let text = content || ''
    let didFormat = false

    if (ext === 'sql') {
      try {
        text = formatSql(text, {
          language: guessSqlDialect(text),
          keywordCase: 'upper',
          tabWidth: 2,
          linesBetweenQueries: 2,
        })
        didFormat = true
      } catch {
        // SQL có cú pháp lạ hoặc chứa phương ngữ riêng — giữ nguyên bản gốc,
        // vẫn tô màu được, chỉ là không đẹp bằng
      }
    }

    const lang = hljsLangOf(ext)
    let html
    try {
      html = hljs.getLanguage(lang)
        ? hljs.highlight(text, { language: lang }).value
        : hljs.highlightAuto(text).value
    } catch {
      html = escapeHtml(text)
    }

    // Tách theo dòng SAU khi tô màu để đánh số dòng. highlight.js có thể để thẻ
    // mở ở cuối dòng này và đóng ở dòng sau; trình duyệt tự vá thẻ hở nên chấp
    // nhận được, đổi lại không phải tô màu riêng từng dòng (chậm hơn nhiều lần).
    return { lines: html.split('\n'), language: lang, formatted: didFormat }
  }, [content, ext])

  const copy = () => {
    navigator.clipboard?.writeText(content || '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-[#1e1e1e]">
      <style>{VSCODE_DARK}</style>

      {/* Thanh trạng thái kiểu tab của IDE */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#252526] border-b border-black/40">
        <span className="text-xs text-gray-300 font-mono truncate">{fileName}</span>
        <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-gray-400 uppercase shrink-0">
          {language}
        </span>
        {formatted && (
          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-[10px] text-amber-300 shrink-0">
            đã định dạng lại
          </span>
        )}

        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button onClick={() => setWrap(w => !w)}
            className={`px-2 h-7 rounded text-[11px] font-medium transition-colors
              ${wrap ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/10'}`}>
            Ngắt dòng
          </button>
          <button onClick={copy}
            className="px-2 h-7 rounded text-[11px] font-medium text-gray-400 hover:bg-white/10">
            {copied ? '✓ Đã chép' : 'Chép'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto code-view">
        <table className="w-full border-collapse font-mono text-[13px] leading-[1.55]">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-white/[0.04]">
                {/* Số dòng: user-select-none để copy cả khối không dính số vào */}
                <td className="select-none text-right align-top pl-4 pr-3 text-[#858585]
                  sticky left-0 bg-[#1e1e1e] w-px tabular-nums">
                  {i + 1}
                </td>
                <td className={`pr-5 align-top ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
                  dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const escapeHtml = s => String(s).replace(/[&<>]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))
