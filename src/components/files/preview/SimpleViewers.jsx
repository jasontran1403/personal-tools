import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SkeletonMedia, SkeletonBox } from '../../common/Skeleton'
import { fileUrl } from '../../../services/filesApi'
import { fmtSize, fmtDateTime, KIND_LABEL, kindOf, iconOf } from '../fileKind'

/* ═══════════════════════════════════════════════════════════════════
   Markdown
   ═══════════════════════════════════════════════════════════════════ */

/**
 * remark-gfm bật bảng, danh sách việc cần làm và gạch ngang — README nào cũng
 * dùng, thiếu nó thì bảng hiện ra thành một mớ dấu gạch đứng.
 * KHÔNG bật rehype-raw: cho phép HTML thô trong markdown là mở đường cho XSS
 * nếu về sau có ai tải lên file của người khác.
 */
export function MarkdownViewer({ content }) {
  return (
    <div className="h-full overflow-auto bg-gray-100 py-6 px-3">
      <article className="mx-auto max-w-3xl bg-white rounded-xl shadow-sm px-6 sm:px-10 py-8 md-body">
        <style>{`
          .md-body { font-size: 15px; line-height: 1.75; color: #1f2937; }
          .md-body h1 { font-size: 26px; font-weight: 800; margin: 20px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
          .md-body h2 { font-size: 21px; font-weight: 700; margin: 22px 0 10px; }
          .md-body h3 { font-size: 17px; font-weight: 700; margin: 18px 0 8px; }
          .md-body p  { margin: 0 0 12px; }
          .md-body ul { list-style: disc;    margin: 0 0 12px 22px; }
          .md-body ol { list-style: decimal; margin: 0 0 12px 22px; }
          .md-body li { margin-bottom: 5px; }
          .md-body a  { color: #2563eb; text-decoration: underline; }
          .md-body code {
            background: #f1f5f9; border-radius: 4px; padding: 1px 5px;
            font-size: 13px; font-family: ui-monospace, Menlo, Consolas, monospace;
          }
          .md-body pre {
            background: #1e1e1e; color: #d4d4d4; border-radius: 10px;
            padding: 14px 16px; overflow-x: auto; margin: 0 0 14px;
          }
          .md-body pre code { background: none; color: inherit; padding: 0; font-size: 12.5px; }
          .md-body blockquote {
            border-left: 3px solid #cbd5e1; padding: 2px 0 2px 14px;
            margin: 0 0 12px; color: #475569;
          }
          .md-body table { border-collapse: collapse; width: 100%; margin: 0 0 14px; font-size: 14px; }
          .md-body th, .md-body td { border: 1px solid #e5e7eb; padding: 7px 10px; text-align: left; }
          .md-body th { background: #f8fafc; font-weight: 600; }
          .md-body hr { border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0; }
          .md-body img { max-width: 100%; border-radius: 8px; }
          .md-body input[type=checkbox] { margin-right: 6px; }
        `}</style>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown>
      </article>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Văn bản thuần
   ═══════════════════════════════════════════════════════════════════ */

export function TextViewer({ content }) {
  return (
    <div className="h-full overflow-auto bg-white">
      <pre className="p-5 text-[13px] leading-relaxed font-mono text-gray-800 whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   PDF
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Xem PDF ngay trong modal.
 *
 * KHÔNG trỏ iframe thẳng vào URL của máy chủ. Frontend chạy ở cổng 5173 còn API
 * ở 9009 — với trình duyệt đó là hai origin khác nhau, và một iframe nhúng nội
 * dung khác origin có thể bị chặn bởi X-Frame-Options, Content-Security-Policy,
 * hoặc quy tắc chặn tài nguyên của chính trình duyệt. Khó chịu nhất là khi bị
 * chặn, iframe KHÔNG bắn sự kiện lỗi nào cả — nó chỉ hiện một khung trống với
 * biểu tượng tài liệu hỏng, đúng như hiện tượng gặp phải.
 *
 * Cách làm ở đây: tự tải file về bằng fetch, dựng thành Blob rồi cho iframe đọc
 * qua `blob:` URL. Blob URL luôn CÙNG ORIGIN với trang, nên không rào cản nào
 * áp dụng được. Đồng thời tự ép kiểu 'application/pdf' nên dù máy chủ trả
 * content-type sai thì trình duyệt vẫn dựng hình đúng.
 *
 * Đánh đổi: phải tải trọn file trước khi hiện, mất khả năng tải từng phần theo
 * HTTP Range. File hợp đồng, hoá đơn vài trăm KB thì không cảm nhận được; file
 * hàng trăm MB sẽ chờ lâu hơn — lúc đó khung xương vẫn hiện nên không bị treo
 * màn hình trắng.
 */
export function PdfViewer({ url, fileName }) {
  const [blobUrl, setBlobUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl = null
    let cancelled = false

    setBlobUrl(null)
    setError('')

    fetch(fileUrl(url))
      .then(res => {
        if (!res.ok) throw new Error(`Máy chủ trả về ${res.status}`)
        return res.arrayBuffer()
      })
      .then(buffer => {
        if (cancelled) return

        // Máy chủ trả lỗi dạng JSON nhưng vẫn HTTP 200 (kiểu bọc ApiResponse)
        // thì buffer không phải PDF. Mọi file PDF hợp lệ đều bắt đầu bằng "%PDF".
        const head = new TextDecoder().decode(buffer.slice(0, 5))
        if (!head.startsWith('%PDF')) {
          throw new Error('Nội dung tải về không phải tệp PDF hợp lệ')
        }

        objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }))
        setBlobUrl(objectUrl)
      })
      .catch(e => {
        if (!cancelled) setError(e.message || 'Không tải được tệp PDF')
      })

    return () => {
      cancelled = true
      // Thu hồi ngay khi đóng, không thì mỗi lần mở xem một file là giữ luôn
      // vài chục MB trong bộ nhớ cho tới lúc tải lại trang
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-300 px-6 text-center">
        <span className="text-5xl">📕</span>
        <p className="text-sm max-w-sm">{error}</p>
      </div>
    )
  }

  if (!blobUrl) {
    return (
      <div className="h-full bg-gray-100 p-6 overflow-hidden relative">
        <div className="mx-auto max-w-2xl space-y-3">
          <SkeletonBox className="h-10 w-1/2 mx-auto" />
          <SkeletonBox className="h-[70vh] w-full" />
        </div>
        <p className="absolute bottom-6 left-0 right-0 text-center text-xs text-gray-400">
          Đang tải tài liệu PDF...
        </p>
      </div>
    )
  }

  return (
    <iframe
      // zoom=100 để mở ra đúng tỉ lệ thật của trang. Mặc định của trình duyệt
      // là co cho vừa bề ngang khung, mà khung modal khá hẹp nên trang A4 bị
      // phóng lên gần 200% — chữ to quá, mỗi màn hình chỉ thấy được vài dòng.
      src={`${blobUrl}#zoom=100`}
      title={fileName}
      className="w-full h-full border-0 bg-gray-700"
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Ảnh và video
   ═══════════════════════════════════════════════════════════════════ */

export function ImageViewer({ url, alt }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // Ảnh đã nằm sẵn trong cache thì sự kiện onLoad không bắn nữa — kiểm tra
  // thuộc tính complete để khung xương không kẹt lại vĩnh viễn
  const imgRef = useRef(null)
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    const id = requestAnimationFrame(() => {
      if (imgRef.current?.complete && imgRef.current.naturalWidth) setLoaded(true)
    })
    return () => cancelAnimationFrame(id)
  }, [url])

  return (
    <div className="relative h-full flex items-center justify-center">
      {!loaded && !failed && (
        <div className="absolute inset-0"><SkeletonMedia /></div>
      )}
      {failed ? (
        <div className="text-center text-white/40">
          <div className="text-4xl mb-2">🖼️</div>
          <p className="text-sm">Không hiển thị được ảnh này</p>
        </div>
      ) : (
        <img
          ref={imgRef}
          src={fileUrl(url)}
          alt={alt}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`max-w-full max-h-full object-contain select-none transition-opacity duration-300
            ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  )
}

export function VideoViewer({ url }) {
  const [ready, setReady] = useState(false)

  useEffect(() => setReady(false), [url])

  return (
    <div className="relative h-full flex items-center justify-center">
      {!ready && <div className="absolute inset-0"><SkeletonMedia isVideo /></div>}
      <video
        key={url}
        src={fileUrl(url)}
        controls
        playsInline
        preload="metadata"
        // loadeddata chứ không phải canplay: canplay có thể bắn trước khi có
        // khung hình nào, khung xương tắt đi để lộ ô đen
        onLoadedData={() => setReady(true)}
        className={`max-w-full max-h-full rounded-lg transition-opacity duration-300
          ${ready ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Không xem trước được — chỉ thông tin tệp
   ═══════════════════════════════════════════════════════════════════ */

export function MetaViewer({ asset, onDownload }) {
  const rows = [
    ['Tên tệp',    asset.originalName],
    ['Loại',       KIND_LABEL[kindOf(asset)] || 'Tệp khác'],
    ['Phần mở rộng', asset.ext ? `.${asset.ext}` : 'Không có'],
    ['Dung lượng', fmtSize(asset.sizeBytes)],
    ['Kiểu MIME',  asset.contentType || 'Không xác định'],
    ['Tải lên',    fmtDateTime(asset.createdAt)],
    ['Sửa lần cuối', asset.updatedAt && asset.updatedAt !== asset.createdAt
      ? fmtDateTime(asset.updatedAt) : 'Chưa sửa'],
  ]

  return (
    <div className="h-full overflow-auto bg-gray-100 py-8 px-4">
      <div className="mx-auto max-w-lg bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-8 text-center border-b border-gray-100">
          <div className="text-5xl mb-3">{iconOf(asset)}</div>
          <p className="font-bold text-gray-900 break-all">{asset.originalName}</p>
          <p className="text-xs text-gray-400 mt-1">
            Không xem trước được định dạng này
          </p>
        </div>

        <dl className="divide-y divide-gray-50">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-4 px-6 py-3">
              <dt className="w-32 shrink-0 text-xs font-semibold text-gray-400 uppercase tracking-wide pt-0.5">
                {label}
              </dt>
              <dd className="flex-1 min-w-0 text-sm text-gray-800 break-all">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="px-6 py-4 bg-gray-50/70">
          <button onClick={onDownload}
            className="w-full h-10 rounded-xl bg-blue-600 text-white text-sm font-semibold
              hover:bg-blue-700 active:scale-[0.98] transition">
            ⬇ Tải về máy để mở
          </button>
        </div>
      </div>
    </div>
  )
}