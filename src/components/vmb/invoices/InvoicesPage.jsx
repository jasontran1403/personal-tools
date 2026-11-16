import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import DateRangePicker from '../../common/DateRangePicker'
import VmbFilePreviewModal from '../VmbFilePreviewModal'
import DraftInvoiceModal from './DraftInvoiceModal'
import { listInvoices, getInvoiceDraft } from '../../../services/vmbApi'

/**
 * Trang "Quản lý hóa đơn" — list theo đơn vị hóa đơn (group vé), responsive.
 *
 * ── 2026-11-15 (v4) ─────────────────────────────────────────────────────
 * - Bộ lọc bên mua = COMBOBOX có gợi ý (gõ để lọc): Tất cả / Khách lẻ / <cty>.
 *   Loại bỏ công ty ảo tên "Khách lẻ" để không trùng mục Khách lẻ.
 * - 2 khoảng ngày (tạo booking / phát hành) gom 1 dòng, picker compact (bỏ
 *   icon lịch, chữ nhỏ).
 * - Tìm kiếm (client-side):
 *     • số 3/6 ký tự   → SỐ HÓA ĐƠN (chính xác).
 *     • số khác        → SỐ TIỀN (nhập "2512181" khớp 2.512.181).
 *     • có chữ         → TÊN BÊN MUA (so khớp theo cụm/từ, KHÔNG subsequence —
 *                        "chi nhanh" không còn khớp nhầm "cheng chiao").
 */

const DAY = 86400000

function pad(n) { return String(n).padStart(2, '0') }
function fmtDateTime(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtDate(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
function dayStart(iso) { return iso ? new Date(iso + 'T00:00:00').getTime() : null }
function dayEnd(iso)   { return iso ? new Date(iso + 'T23:59:59').getTime() : null }

// ── Tiện ích tìm kiếm ──────────────────────────────────────────────────
function removeDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
}
function norm(s) { return removeDiacritics(s).toLowerCase().trim() }
function digitsOnly(s) { return String(s || '').replace(/\D/g, '') }

/** Khớp số hóa đơn (chuỗi "142, 143" → so từng số, chính xác, bỏ số 0 đầu). */
function invoiceNumMatch(invoiceNo, numStr) {
  if (!invoiceNo) return false
  const parts = String(invoiceNo).match(/\d+/g)
  if (!parts) return false
  const t = String(parseInt(numStr, 10))
  return parts.some(p => p === numStr || String(parseInt(p, 10)) === t)
}

/**
 * Fuzzy theo tên: bỏ dấu rồi khớp CẢ CỤM hoặc MỌI TỪ là chuỗi con.
 * KHÔNG dùng subsequence (dễ khớp nhầm, vd "chi nhanh" ~ "cheng chiao").
 */
function fuzzy(q, target) {
  const nq = norm(q), nt = norm(target)
  if (!nq) return true
  if (!nt) return false
  if (nt.includes(nq)) return true
  const toks = nq.split(/\s+/).filter(Boolean)
  return toks.length > 0 && toks.every(t => nt.includes(t))
}

function matchSearch(row, raw) {
  const query = (raw || '').trim()
  if (!query) return true
  const compact = query.replace(/[.\s,]/g, '')
  if (/^\d+$/.test(compact)) {
    // Chuỗi số: 3/6 ký tự = số hóa đơn; còn lại = số tiền (fallback số HĐ).
    if (compact.length === 3 || compact.length === 6) return invoiceNumMatch(row.invoiceNo, compact)
    return digitsOnly(row.grandTotal) === compact || invoiceNumMatch(row.invoiceNo, compact)
  }
  // Có chữ → fuzzy theo tên bên mua.
  return fuzzy(query, row.buyerDisplay) || fuzzy(query, row.companyName)
}

const PAGE_SIZE = 80
export default function InvoicesPage({ onBack, refreshSignal }) {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage]         = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal]       = useState(0)

  const [q, setQ]               = useState('')      // tìm kiếm (client-side)
  const [fromCreated, setFromCreated] = useState('') // ngày tạo booking (server)
  const [toCreated, setToCreated]     = useState('')
  const [fromIssued, setFromIssued]   = useState('') // ngày phát hành (client)
  const [toIssued, setToIssued]       = useState('')

  const [preview, setPreview]   = useState(null)
  const [draft, setDraft]       = useState(null)

  const scrollRef = useRef(null)
  const qTimer = useRef(null)
  const onSearch = (v) => {
    if (qTimer.current) clearTimeout(qTimer.current)
    qTimer.current = setTimeout(() => setQ(v.trim()), 300)
  }


  // Server CHỈ lọc theo ngày tạo booking (tìm kiếm + bên mua + ngày phát hành
  // xử lý client để đúng ngữ nghĩa số tiền/fuzzy).
  const params = useMemo(() => {
    const p = {}
    const f = dayStart(fromCreated), t = dayEnd(toCreated)
    if (f) p.fromDate = f
    if (t) p.toDate = t
    return p
  }, [fromCreated, toCreated])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listInvoices({ ...params, page: 0, size: PAGE_SIZE })
      const d = res.data?.data
      setRows(d?.content || [])
      setTotalPages(d?.totalPages || 1)
      setTotal(d?.totalElements || 0)
      setPage(0)
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải được danh sách hóa đơn')
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])

  // 2026-11-15: Mỗi lần mở lại trang Quản lý hóa đơn (từ VMB) → nạp lại dữ liệu
  //   để thấy ngay thay đổi vừa làm bên Vé máy bay (thu tiền, phát hành…).
  //   Bỏ qua lần render đầu (đã có mount load ở trên).
  const firstReloadRef = useRef(true)
  useEffect(() => {
    if (firstReloadRef.current) { firstReloadRef.current = false; return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || page >= totalPages - 1) return
    setLoadingMore(true)
    try {
      const next = page + 1
      const res = await listInvoices({ ...params, page: next, size: PAGE_SIZE })
      setRows(prev => [...prev, ...(res.data?.data?.content || [])])
      setPage(next)
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải thêm được')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, loading, page, totalPages, params])

  const onScroll = () => {
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMore()
  }

  // Có bộ lọc client → cần toàn bộ dữ liệu: tự nạp hết các trang còn lại.
  const filterActive = !!(q || fromIssued || toIssued)
  useEffect(() => {
    if (filterActive && !loading && !loadingMore && page < totalPages - 1) loadMore()
  }, [filterActive, loading, loadingMore, page, totalPages, loadMore])

  const openView = async (row) => {
    if (row.issuedUrl) {
      const name = row.issuedUrl.split('/').pop()
      setPreview({ filePath: row.issuedUrl, fileName: name, title: `Hóa đơn ${row.invoiceNo || ''}` })
      return
    }
    setDraft({ open: true, loading: true, mode: null, pdfBase64: null, error: null })
    try {
      const res = await getInvoiceDraft(row.bookingId, row.kind)
      const d = res.data?.data || {}
      setDraft({ open: true, loading: false, mode: d.mode || 'ERROR', pdfBase64: d.pdfBase64 || null, error: d.error || null })
    } catch (e) {
      setDraft({ open: true, loading: false, mode: 'ERROR', pdfBase64: null, error: e?.response?.data?.message || 'Không lấy được hóa đơn nháp' })
    }
  }

  const openPayment = (row) => {
    if (!row.paymentUrl) return
    const name = row.paymentUrl.split('/').pop()
    setPreview({ filePath: row.paymentUrl, fileName: name, title: `Ảnh thanh toán — ${row.buyerDisplay || ''}` })
  }

  const onIssue = () => toast('Chức năng phát hành sẽ triển khai ở bước sau (nối VinVoice).', { icon: '🧾' })

  // Lọc client-side (tìm kiếm + bên mua + ngày phát hành).
  const shown = useMemo(() => {
    const fi = dayStart(fromIssued), ti = dayEnd(toIssued)
    return rows.filter(r => {
      if (!matchSearch(r, q)) return false
      if (fi && (!r.issuedAt || r.issuedAt < fi)) return false
      if (ti && (!r.issuedAt || r.issuedAt > ti)) return false
      return true
    })
  }, [rows, q, fromIssued, toIssued])

  const rowClass = (r) => {
    if (r.paid) return 'bg-blue-50'
    const issued = r.status === 'ISSUED' || r.status === 'ADJUSTED' || !!r.issuedUrl
    if (issued) return 'bg-orange-50'
    return 'hover:bg-gray-50'
  }

  const btnBase = 'px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center justify-center gap-1.5 flex-1 lg:flex-none'

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 mb-3">
        <button type="button" onClick={onBack}
          className="px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 shrink-0 flex items-center gap-1.5">
          <span className="text-base leading-none">←</span> <span className="hidden sm:inline">Vé máy bay</span>
        </button>
        <div className="min-w-0">
          <div className="text-base font-bold text-gray-900 leading-tight flex items-center gap-2">🧾 Quản lý hóa đơn</div>
          <div className="text-[11px] text-gray-500 leading-tight">{loading ? 'Đang tải…' : `${total}+ hóa đơn`}</div>
        </div>
      </div>

      {/* Toolbar lọc */}
      <div className="shrink-0 flex flex-col gap-2 mb-2">
        {/* Tìm kiếm (gồm cả tên công ty) — full width, bỏ dropdown lọc công ty */}
        <input defaultValue={q} onChange={e => onSearch(e.target.value)}
          placeholder="Tìm số hóa đơn, tên khách, số tiền…"
          className="w-full px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none" />
        {/* 2 khoảng ngày — luôn cùng 1 dòng, picker gọn (không icon, chữ nhỏ) */}
        <div className="grid grid-cols-2 gap-2">
          <DateRangePicker compact value={{ from: fromCreated, to: toCreated }}
            onChange={({ from, to }) => { setFromCreated(from); setToCreated(to) }}
            placeholder="Ngày tạo booking" />
          <DateRangePicker compact value={{ from: fromIssued, to: toIssued }}
            onChange={({ from, to }) => { setFromIssued(from); setToIssued(to) }}
            placeholder="Ngày phát hành HĐ" />
        </div>
      </div>

      {/* Header cột (desktop) */}
      <div className="shrink-0 hidden lg:flex items-center gap-3 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200">
        <div className="w-40 shrink-0">Ngày tạo</div>
        <div className="flex-1 min-w-0">Bên mua</div>
        <div className="w-28 shrink-0 text-right">Số HĐ</div>
        <div className="w-44 shrink-0 text-right">Số tiền</div>
        <div className="min-w-[230px] shrink-0 text-right">Hành động</div>
      </div>

      {/* Danh sách */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Đang tải danh sách hóa đơn…</div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">Không có hóa đơn phù hợp.</div>
        ) : (
          <div>
            {shown.map(row => {
              const issued = row.status === 'ISSUED' || row.status === 'ADJUSTED' || !!row.issuedUrl
              const days = issued && row.issuedAt ? Math.floor((Date.now() - row.issuedAt) / DAY) : 0
              return (
                <div key={`${row.kind}-${row.bookingId}`}
                  className={`flex flex-col lg:flex-row lg:items-center gap-1.5 lg:gap-3 px-3 lg:px-4 py-3 border-b-[6px] lg:border-b border-gray-100 ${rowClass(row)}`}>

                  {/* Mobile: ngày tạo (đậm, to) + ngày phát hành (phải) */}
                  <div className="flex items-center justify-between gap-2 lg:hidden">
                    <span className="text-sm font-bold text-gray-900 whitespace-nowrap">{fmtDateTime(row.createdAt)}</span>
                    {issued && row.issuedAt && (
                      <span className="text-[11px] text-gray-500 whitespace-nowrap">Phát hành: {fmtDate(row.issuedAt)}</span>
                    )}
                  </div>

                  {/* Desktop: ngày tạo cột riêng */}
                  <div className="hidden lg:block lg:w-40 shrink-0 text-sm text-gray-700 whitespace-nowrap">
                    {fmtDateTime(row.createdAt)}
                  </div>

                  {/* Bên mua — hiện đủ tên, không truncate */}
                  <div className="w-full lg:flex-1 lg:min-w-0">
                    <span className="font-semibold text-gray-900 text-sm break-words leading-snug">
                      {row.buyerDisplay || 'Khách lẻ'}
                    </span>
                  </div>

                  {/* Số HĐ (+ badge số ngày > 5) */}
                  <div className="flex items-center justify-between lg:justify-end gap-2 w-full lg:w-28 shrink-0">
                    <span className="lg:hidden text-[11px] text-gray-400">Số HĐ</span>
                    <span className="flex items-center gap-1.5">
                      {issued && days > 5 && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-bold" title="Số ngày kể từ khi phát hành">
                          {days}d
                        </span>
                      )}
                      <span className="text-sm text-gray-700">{row.invoiceNo || '—'}</span>
                    </span>
                  </div>

                  {/* Số tiền — đã thu → badge xanh dương; có ảnh thì bấm xem ảnh TT */}
                  <div className="flex items-center justify-between lg:block w-full lg:w-44 shrink-0 lg:text-right">
                    <span className="lg:hidden text-[11px] text-gray-400">Số tiền</span>
                    {row.paid ? (
                      <button type="button"
                        onClick={row.paymentUrl ? () => openPayment(row) : undefined}
                        disabled={!row.paymentUrl}
                        title={row.paymentUrl ? 'Đã thu — bấm xem ảnh thanh toán' : 'Đã thu'}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-100 text-blue-700 text-sm font-bold whitespace-nowrap ${row.paymentUrl ? 'hover:bg-blue-200 cursor-pointer' : 'cursor-default'}`}>
                        {row.paymentUrl && <span className="text-xs">🧾</span>}
                        {row.grandTotal ? `${row.grandTotal} ₫` : '—'}
                      </button>
                    ) : (
                      <span className="text-sm font-bold text-gray-900 whitespace-nowrap">{row.grandTotal ? `${row.grandTotal} ₫` : '—'}</span>
                    )}
                  </div>

                  {/* Hành động — mobile full-width */}
                  <div className="w-full lg:w-auto lg:min-w-[230px] flex items-stretch gap-2 lg:justify-end">
                    {issued ? (
                      <button type="button" onClick={() => openView(row)}
                        className={`${btnBase} border border-green-300 bg-green-100 text-green-700 hover:bg-green-200`}>
                        <span>📄</span> HĐ Phát hành
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={() => openView(row)}
                          className={`${btnBase} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>
                          <span>🧾</span> HĐ Nháp
                        </button>
                        <button type="button" onClick={onIssue}
                          className={`${btnBase} text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-500/20`}>
                          <span>🚀</span> Phát hành
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {loadingMore && <div className="py-4 text-center text-xs text-gray-400">Đang tải thêm…</div>}
            {page >= totalPages - 1 && shown.length > 0 && (
              <div className="py-4 text-center text-[11px] text-gray-300">— hết —</div>
            )}
          </div>
        )}
      </div>

      <VmbFilePreviewModal open={!!preview} onClose={() => setPreview(null)}
        filePath={preview?.filePath} fileName={preview?.fileName} title={preview?.title} />
      <DraftInvoiceModal open={!!draft?.open} onClose={() => setDraft(null)}
        mode={draft?.mode} pdfBase64={draft?.pdfBase64} error={draft?.error} loading={!!draft?.loading} />
    </div>
  )
}
