import mammoth from 'mammoth'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'

/**
 * Đọc / ghi tài liệu Word.
 *
 * Đọc  : mammoth chuyển .docx → HTML ngữ nghĩa (h1..h3, p, ul, table, b/i/u).
 *        Nó cố tình BỎ định dạng trực tiếp (font, cỡ chữ tuyệt đối) và chỉ giữ
 *        cấu trúc — nhờ vậy tài liệu hiện ra sạch sẽ và sửa được, thay vì một
 *        mớ thẻ span lồng nhau như khi mở bằng bộ chuyển đổi thô.
 *
 * Ghi  : tự dựng lại từ DOM của trình soạn thảo. Không dùng html-docx-js vì gói
 *        đó đã ngừng bảo trì từ lâu và sinh ra file Word 2007 mà Office mới cảnh
 *        báo "định dạng không khớp phần mở rộng".
 *
 * GIỚI HẠN đã biết, nói rõ để không ai kỳ vọng nhầm: ảnh nhúng, hộp văn bản,
 * header/footer và bảng lồng bảng không đi qua được vòng đọc–ghi này. Tài liệu
 * hợp đồng, báo cáo, biên bản thì đủ dùng.
 */

// ═══════════════════════════════════════════════════════════════════
// Đọc
// ═══════════════════════════════════════════════════════════════════

/** @returns { html, warnings: string[] } */
export async function readDocx(arrayBuffer) {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1.doc-title:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
      ],
      // Ảnh nhúng → data URI để hiện được ngay trong trình soạn thảo.
      // Chưa xuất ngược ra .docx được, nhưng thấy còn hơn mất.
      convertImage: mammoth.images.imgElement(async image => {
        const buffer = await image.read('base64')
        return { src: `data:${image.contentType};base64,${buffer}` }
      }),
    }
  )

  return {
    html: result.value || '<p></p>',
    warnings: (result.messages || [])
      .filter(m => m.type === 'warning')
      .map(m => m.message),
  }
}

// ═══════════════════════════════════════════════════════════════════
// Ghi .docx
// ═══════════════════════════════════════════════════════════════════

const HEADING = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
}

const ALIGN = {
  center:  AlignmentType.CENTER,
  right:   AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
  left:    AlignmentType.LEFT,
}

/** HTML trong trình soạn thảo → Blob .docx */
export async function writeDocx(html) {
  const container = document.createElement('div')
  container.innerHTML = html

  const children = []
  for (const node of Array.from(container.childNodes)) {
    children.push(...blockOf(node))
  }
  if (!children.length) children.push(new Paragraph(''))

  const doc = new Document({
    styles: {
      default: {
        document: {
          // Times New Roman 13pt là chuẩn văn bản hành chính Việt Nam
          // (Nghị định 30/2020) — mở ra là dùng được ngay, khỏi chỉnh tay
          run: { font: 'Times New Roman', size: 26 },
          paragraph: { spacing: { line: 312, after: 120 } },
        },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 1134 } },
      },
      children,
    }],
  })

  return Packer.toBlob(doc)
}

/** Một nút DOM → mảng phần tử docx (một nút có thể sinh nhiều đoạn) */
function blockOf(node, depth = 0) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim()
    return text ? [new Paragraph({ children: [new TextRun(text)] })] : []
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return []

  const tag = node.tagName.toUpperCase()
  const align = ALIGN[node.style?.textAlign] ?? undefined

  if (HEADING[tag]) {
    return [new Paragraph({
      heading: HEADING[tag],
      alignment: align,
      children: runsOf(node),
      spacing: { before: 240, after: 120 },
    })]
  }

  if (tag === 'P' || tag === 'DIV') {
    const runs = runsOf(node)
    // Đoạn rỗng vẫn phải giữ: người dùng cố ý chừa dòng trắng để giãn cách
    return [new Paragraph({ alignment: align, children: runs.length ? runs : [new TextRun('')] })]
  }

  if (tag === 'BLOCKQUOTE') {
    return [new Paragraph({
      children: runsOf(node),
      indent: { left: 720 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 12 } },
    })]
  }

  if (tag === 'UL' || tag === 'OL') {
    const out = []
    let index = 1
    for (const li of Array.from(node.children)) {
      if (li.tagName?.toUpperCase() !== 'LI') continue
      out.push(new Paragraph({
        children: [
          new TextRun({ text: tag === 'OL' ? `${index++}. ` : '• ' }),
          ...runsOf(li),
        ],
        indent: { left: 720 + depth * 360 },
        spacing: { after: 60 },
      }))
      // Danh sách lồng nhau
      for (const child of Array.from(li.children)) {
        const t = child.tagName?.toUpperCase()
        if (t === 'UL' || t === 'OL') out.push(...blockOf(child, depth + 1))
      }
    }
    return out
  }

  if (tag === 'TABLE') return [tableOf(node)]

  if (tag === 'HR') {
    return [new Paragraph({
      text: '',
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB' } },
    })]
  }

  if (tag === 'BR') return [new Paragraph('')]

  // Thẻ lạ (section, article...) — đi tiếp vào bên trong
  const out = []
  for (const child of Array.from(node.childNodes)) out.push(...blockOf(child, depth))
  return out
}

function tableOf(table) {
  const rows = []
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = []
    for (const td of Array.from(tr.children)) {
      const isHeader = td.tagName.toUpperCase() === 'TH'
      cells.push(new TableCell({
        children: [new Paragraph({
          children: runsOf(td, isHeader ? { bold: true } : {}),
          alignment: isHeader ? AlignmentType.CENTER : undefined,
        })],
        shading: isHeader ? { fill: 'F1F5F9' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
      }))
    }
    if (cells.length) rows.push(new TableRow({ children: cells }))
  }

  if (!rows.length) rows.push(new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] }))

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
}

/**
 * Nội dung nội tuyến → mảng TextRun, giữ đậm/nghiêng/gạch chân.
 * Đi đệ quy vì Word cho phép lồng: <b>đậm <i>và nghiêng</i></b>.
 */
function runsOf(node, inherited = {}) {
  const runs = []

  const walk = (n, fmt) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent
      if (text) runs.push(new TextRun({ text, ...fmt }))
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return

    const tag = n.tagName.toUpperCase()
    const next = { ...fmt }
    if (tag === 'B' || tag === 'STRONG') next.bold = true
    if (tag === 'I' || tag === 'EM')     next.italics = true
    if (tag === 'U')                     next.underline = {}
    if (tag === 'S' || tag === 'STRIKE') next.strike = true
    if (tag === 'CODE')                  next.font = 'Consolas'
    if (tag === 'BR') { runs.push(new TextRun({ break: 1 })); return }

    // Định dạng đặt bằng CSS (nút B trong trình soạn thảo dùng execCommand
    // sinh ra <span style="font-weight:bold">)
    const style = n.style
    if (style) {
      if (style.fontWeight === 'bold' || +style.fontWeight >= 600) next.bold = true
      if (style.fontStyle === 'italic') next.italics = true
      if (style.textDecoration?.includes('underline')) next.underline = {}
      if (style.color) {
        const hex = cssColorToHex(style.color)
        if (hex) next.color = hex
      }
    }

    for (const child of Array.from(n.childNodes)) walk(child, next)
  }

  for (const child of Array.from(node.childNodes)) walk(child, inherited)
  return runs
}

/** "rgb(220, 38, 38)" hoặc "#dc2626" → "DC2626" */
function cssColorToHex(color) {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map(n => Number(n).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())
  return hex ? hex[1].toUpperCase() : null
}

// ═══════════════════════════════════════════════════════════════════
// Xuất PDF
// ═══════════════════════════════════════════════════════════════════

/**
 * Xuất PDF bằng chính hộp thoại in của trình duyệt.
 *
 * Cách này cho kết quả sát mắt hơn hẳn jsPDF + html2canvas: html2canvas chụp
 * ảnh màn hình rồi nhét vào PDF, nên chữ thành ảnh — không tìm kiếm, không bôi
 * đen, không copy được, và mờ khi in. Bản in của trình duyệt giữ nguyên chữ
 * vector và tự ngắt trang.
 *
 * Đổi lại người dùng phải chọn "Lưu thành PDF" trong hộp thoại. Giao diện có
 * ghi chú nhắc chuyện đó.
 */
export function exportPdfViaPrint(html, title = 'Tài liệu') {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  doc.open()
  doc.write(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 20mm 15mm; }
  body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.5; color: #000; }
  h1 { font-size: 18pt; } h2 { font-size: 15pt; } h3 { font-size: 13.5pt; }
  h1,h2,h3 { margin: 12pt 0 6pt; page-break-after: avoid; }
  p { margin: 0 0 6pt; }
  table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
  th, td { border: 1px solid #333; padding: 4pt 6pt; }
  th { background: #f1f5f9; }
  blockquote { margin: 0 0 6pt 18pt; padding-left: 10pt; border-left: 2pt solid #ccc; }
  img { max-width: 100%; }
</style></head><body>${html}</body></html>`)
  doc.close()

  // Chờ layout và font xong mới in; in ngay lập tức sẽ ra trang trắng
  const fire = () => {
    frame.contentWindow.focus()
    frame.contentWindow.print()
    // Gỡ iframe sau khi hộp thoại đóng. Không có sự kiện đáng tin cho việc này
    // trên mọi trình duyệt nên dùng mốc thời gian rộng rãi.
    setTimeout(() => frame.remove(), 60000)
  }

  if (doc.fonts?.ready) doc.fonts.ready.then(fire).catch(fire)
  else setTimeout(fire, 300)
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
