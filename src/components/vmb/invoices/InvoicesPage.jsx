import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import DateRangePicker from '../../common/DateRangePicker'
import VmbFilePreviewModal from '../VmbFilePreviewModal'
import DraftInvoiceModal from './DraftInvoiceModal'
import { listInvoices, getInvoiceDraft, getInvoiceDetail, createPendingInvoice } from '../../../services/vmbApi'

/**
 * Trang "Quản lý hóa đơn" — list theo đơn vị hóa đơn (group vé), responsive.
 *
 * ── 2026-11-20 (v5) ──────────────────────────────────────
 * - Màu nền chia theo 4 trạng thái:
 *     DRAFT_UNPAID  : trung tính (slate).
 *     DRAFT_PAID    : amber (tiền về nhưng chưa xuất HĐ).
 *     ISSUED_UNPAID : sky   (đã xuất, còn nợ).
 *     ISSUED_PAID   : emerald (đóng).
 *   Thêm dải màu bên trái cho dễ phân biệt khi scroll.
 * - Số tiền đã thu: badge nổi bật hơn (to hơn, in đậm, có check icon).
 * - Cột "Ngày tạo" đổi label thành "Ngày xuất vé", format dd/MM/yyyy.
 * - Cột "Số HĐ" đổi thành "Hóa đơn": 2 dòng số HĐ + ngày phát hành (dd/MM/yyyy).
 * - Click row → expand chi tiết hóa đơn (gọi /invoices/detail), click lần nữa → collapse.
 *
 * ── Theme ── project dùng `html.dark` + `darkmode.css`, KHÔNG dùng Tailwind `dark:`.
 */

const DAY = 86400000

function pad(n) { return String(n).padStart(2, '0') }
function fmtDate(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
function dayStart(iso) { return iso ? new Date(iso + 'T00:00:00').getTime() : null }
function dayEnd(iso) { return iso ? new Date(iso + 'T23:59:59').getTime() : null }

// ── Tiện ích tìm kiếm ────────────────────────────────────────────
function removeDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
}
function norm(s) { return removeDiacritics(s).toLowerCase().trim() }
function digitsOnly(s) { return String(s || '').replace(/\D/g, '') }

function invoiceNumMatch(invoiceNo, numStr) {
  if (!invoiceNo) return false
  const parts = String(invoiceNo).match(/\d+/g)
  if (!parts) return false
  const t = String(parseInt(numStr, 10))
  return parts.some(p => p === numStr || String(parseInt(p, 10)) === t)
}

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
    if (compact.length === 3 || compact.length === 6) return invoiceNumMatch(row.invoiceNo, compact)
    return digitsOnly(row.grandTotal) === compact || invoiceNumMatch(row.invoiceNo, compact)
  }
  return fuzzy(query, row.buyerDisplay) || fuzzy(query, row.companyName)
}

// ── Trạng thái hóa đơn → tén định danh + màu kiểu ───────────────────────────
function rowState(row) {
  const issued = row.status === 'ISSUED' || row.status === 'ADJUSTED' || !!row.issuedUrl
  if (issued && row.paid) return 'ISSUED_PAID'
  if (issued && !row.paid) return 'ISSUED_UNPAID'
  if (!issued && row.paid) return 'DRAFT_PAID'
  return 'DRAFT_UNPAID'
}

const STATE_STYLES = {
  DRAFT_UNPAID: { bg: 'bg-slate-50', bar: 'bg-slate-300', label: 'Nháp • chưa thu', pill: 'bg-slate-100 text-slate-600' },
  DRAFT_PAID: { bg: 'bg-amber-50', bar: 'bg-amber-400', label: 'Nháp • đã thu', pill: 'bg-amber-100 text-amber-700' },
  ISSUED_UNPAID: { bg: 'bg-sky-50', bar: 'bg-sky-400', label: 'Đã phát hành • chưa thu', pill: 'bg-sky-100 text-sky-700' },
  ISSUED_PAID: { bg: 'bg-emerald-50', bar: 'bg-emerald-500', label: 'Đã phát hành • đã thu', pill: 'bg-emerald-100 text-emerald-700' },
}

const PAGE_SIZE = 80
export default function InvoicesPage({ onBack, refreshSignal }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const [q, setQ] = useState('')
  const [fromCreated, setFromCreated] = useState('')
  const [toCreated, setToCreated] = useState('')
  const [fromIssued, setFromIssued] = useState('')
  const [toIssued, setToIssued] = useState('')

  const [preview, setPreview] = useState(null)
  const [draft, setDraft] = useState(null)
  const [creatingPending, setCreatingPending] = useState(false)

  // ── Expand state: { [rowKey]: { loading, data, error } } ──
  const [expanded, setExpanded] = useState({})

  const scrollRef = useRef(null)
  const qTimer = useRef(null)
  const onSearch = (v) => {
    if (qTimer.current) clearTimeout(qTimer.current)
    qTimer.current = setTimeout(() => setQ(v.trim()), 300)
  }

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
      setExpanded({})
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải được danh sách hóa đơn')
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])

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
    setDraft({ open: true, loading: true, mode: null, pdfBase64: null, error: null, row, fileName: null })
    try {
      const res = await getInvoiceDraft(row.bookingId, row.kind)
      const d = res.data?.data || {}
      setDraft({
        open: true, loading: false,
        mode: d.mode || 'ERROR', pdfBase64: d.pdfBase64 || null, error: d.error || null,
        fileName: d.fileName || 'Draft-Invoice.pdf',
        row,
      })
    } catch (e) {
      setDraft({ open: true, loading: false, mode: 'ERROR', pdfBase64: null, error: e?.response?.data?.message || 'Không lấy được hóa đơn nháp', row, fileName: null })
    }
  }

  const openPayment = (row) => {
    if (!row.paymentUrl) return
    const name = row.paymentUrl.split('/').pop()
    setPreview({ filePath: row.paymentUrl, fileName: name, title: `Ảnh thanh toán — ${row.buyerDisplay || ''}` })
  }

  // 2026-11-22: Đẩy hóa đơn lên tab "Hóa đơn chưa phát hành" trên vinvoice.viettel.vn.
  // KHÔNG ký USB, KHÔNG phát hành. Kế toán vào web vinvoice để ký + phát hành/xóa.
  const onCreatePending = async (row) => {
    if (!row?.bookingId) return
    setCreatingPending(true)
    try {
      const res = await createPendingInvoice(row.bookingId, row.kind || 'BOOKING')
      const env = res?.data
      if (env && typeof env.code === 'number' && !(env.code >= 900 && env.code < 1000)) {
        throw new Error(env.message || 'Không đẩy được hóa đơn')
      }
      const reservation = env?.data?.reservationCode
      toast.success(
        reservation
          ? `Đã đẩy lên "Hóa đơn chưa phát hành" — mã nháp: ${reservation}`
          : 'Đã đẩy lên "Hóa đơn chưa phát hành" trên vinvoice.',
        { icon: '📤', duration: 5000 },
      )
      setDraft(null)   // đóng modal sau khi push thành công
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || 'Không đẩy được hóa đơn')
    } finally {
      setCreatingPending(false)
    }
  }

  // ── Expand / collapse 1 row ──
  const toggleExpand = async (row) => {
    const key = `${row.kind}-${row.bookingId}`
    const cur = expanded[key]
    if (cur) {
      setExpanded(prev => { const n = { ...prev }; delete n[key]; return n })
      return
    }
    setExpanded(prev => ({ ...prev, [key]: { loading: true } }))
    try {
      const res = await getInvoiceDetail(row.bookingId, row.kind)
      const data = res.data?.data || null
      setExpanded(prev => ({ ...prev, [key]: { loading: false, data } }))
    } catch (e) {
      setExpanded(prev => ({
        ...prev,
        [key]: { loading: false, error: e?.response?.data?.message || 'Không tải được chi tiết hóa đơn' },
      }))
    }
  }

  const shown = useMemo(() => {
    const fi = dayStart(fromIssued), ti = dayEnd(toIssued)
    return rows.filter(r => {
      if (!matchSearch(r, q)) return false
      if (fi && (!r.issuedAt || r.issuedAt < fi)) return false
      if (ti && (!r.issuedAt || r.issuedAt > ti)) return false
      return true
    })
  }, [rows, q, fromIssued, toIssued])

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
        <input defaultValue={q} onChange={e => onSearch(e.target.value)}
          placeholder="Tìm số hóa đơn, tên khách, số tiền…"
          className="w-full px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none" />
        <div className="grid grid-cols-2 gap-2">
          <DateRangePicker compact value={{ from: fromCreated, to: toCreated }}
            onChange={({ from, to }) => { setFromCreated(from); setToCreated(to) }}
            placeholder="Ngày xuất vé" />
          <DateRangePicker compact value={{ from: fromIssued, to: toIssued }}
            onChange={({ from, to }) => { setFromIssued(from); setToIssued(to) }}
            placeholder="Ngày phát hành HĐ" />
        </div>
      </div>

      {/* Header cột (desktop) */}
      <div className="shrink-0 hidden lg:flex items-center gap-3 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200">
        <div className="w-6 shrink-0" />
        <div className="w-32 shrink-0">Ngày xuất vé</div>
        <div className="flex-1 min-w-0">Bên mua</div>
        <div className="w-40 shrink-0">Hóa đơn</div>
        <div className="w-44 shrink-0 text-right">Số tiền</div>
        <div className="min-w-[160px] shrink-0 text-right">Hành động</div>
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
              const key = `${row.kind}-${row.bookingId}`
              const st = rowState(row)
              const S = STATE_STYLES[st]
              const issued = st === 'ISSUED_PAID' || st === 'ISSUED_UNPAID'
              const days = issued && row.issuedAt ? Math.floor((Date.now() - row.issuedAt) / DAY) : 0
              const exp = expanded[key]
              return (
                <div key={key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpand(row)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(row) } }}
                    className={`flex flex-col lg:flex-row lg:items-center gap-1.5 lg:gap-3 px-3 lg:px-4 py-3 border-b-[6px] lg:border-b border-gray-100 cursor-pointer ${S.bg} border-l-4 ${S.bar.replace('bg-', 'border-')}`}>

                    {/* Caret expand (desktop only) */}
                    <div className="hidden lg:flex w-6 shrink-0 items-center justify-center text-gray-400">
                      <span className={`transition-transform inline-block ${exp ? 'rotate-90' : ''}`}>▸</span>
                    </div>

                    {/* Mobile: ngày xuất vé (đậm, to) + badge trạng thái */}
                    <div className="flex items-center justify-between gap-2 lg:hidden">
                      <span className="text-sm font-bold text-gray-900 whitespace-nowrap">{fmtDate(row.createdAt)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${S.pill}`}>{S.label}</span>
                    </div>

                    {/* Desktop: ngày xuất vé */}
                    <div className="hidden lg:block lg:w-32 shrink-0 text-sm font-medium text-gray-800 whitespace-nowrap">
                      {fmtDate(row.createdAt)}
                    </div>

                    {/* Bên mua */}
                    <div className="w-full lg:flex-1 lg:min-w-0">
                      <span className="font-semibold text-gray-900 text-sm break-words leading-snug">
                        {row.buyerDisplay || 'Khách lẻ'}
                      </span>
                    </div>

                    {/* Hóa đơn — 2 dòng: số HĐ + ngày phát hành */}
                    <div className="flex items-center justify-between lg:justify-start gap-2 w-full lg:w-40 shrink-0">
                      <span className="lg:hidden text-[11px] text-gray-400">Hóa đơn</span>
                      <div className="flex items-center gap-1.5">
                        <div className="leading-tight">
                          <div className="text-sm font-semibold text-gray-800">
                            {row.invoiceNo ? `#C26MCB${row.invoiceNo}` : '—'}
                          </div>
                          <div className="text-[11px] text-gray-500">{issued && row.issuedAt ? fmtDate(row.issuedAt) : '—'}</div>
                        </div>
                      </div>
                    </div>

                    {/* Số tiền — đã thu nổi bật hơn */}
                    <div className="flex items-center justify-between lg:block w-full lg:w-44 shrink-0 lg:text-right">
                      <span className="lg:hidden text-[11px] text-gray-400">Số tiền</span>
                      {row.paid ? (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); if (row.paymentUrl) openPayment(row) }}
                          disabled={!row.paymentUrl}
                          title={row.paymentUrl ? 'Đã thu — bấm xem ảnh thanh toán' : 'Đã thu'}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800 text-[15px] font-extrabold whitespace-nowrap shadow-sm ring-1 ring-emerald-200 ${row.paymentUrl ? 'hover:bg-emerald-200 cursor-pointer' : 'cursor-default'}`}>
                          <span className="text-sm">✓</span>
                          {row.grandTotal ? `${row.grandTotal} ₫` : '—'}
                        </button>
                      ) : (
                        <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">{row.grandTotal ? `${row.grandTotal} ₫` : '—'}</span>
                      )}
                    </div>

                    {/* Hành động */}
                    <div className="w-full lg:w-auto lg:min-w-[160px] flex items-stretch gap-2 lg:justify-end" onClick={(e) => e.stopPropagation()}>
                      {issued ? (
                        <button type="button" onClick={() => openView(row)}
                          className={`${btnBase} border border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200`}>
                          <span>📄</span> Xem hóa đơn
                        </button>
                      ) : (
                        <button type="button" onClick={() => openView(row)}
                          className={`${btnBase} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>
                          <span>🧾</span> HĐ Nháp
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expand chi tiết */}
                  {exp && (
                    <div className={`border-b border-gray-200 px-3 lg:px-6 py-4 ${S.bg}`}>
                      {exp.loading ? (
                        <div className="text-sm text-gray-500 py-4 text-center">Đang tải chi tiết hóa đơn…</div>
                      ) : exp.error ? (
                        <div className="text-sm text-rose-600 py-4 text-center">{exp.error}</div>
                      ) : exp.data ? (
                        <InvoiceDetailBlock draft={exp.data} />
                      ) : null}
                    </div>
                  )}
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
        mode={draft?.mode} pdfBase64={draft?.pdfBase64} error={draft?.error} loading={!!draft?.loading}
        fileName={draft?.fileName}
        creating={creatingPending}
        onCreatePending={() => onCreatePending(draft?.row)} />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
//  Expand block: chi tiết hóa đơn (buyer/seller + items + totals)
// ═════════════════════════════════════════════════════════════════
function fmtVnd(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return new Intl.NumberFormat('vi-VN').format(Number(n))
}

function InvoiceDetailBlock({ draft }) {
  const items = draft.items || []
  const buyer = draft.buyer || {}
  const seller = draft.seller || {}
  return (
    <div className="text-sm text-gray-800 bg-white rounded-xl border border-gray-200 p-3 lg:p-4">
      {/* Buộc hình thông tin */}
      <div className="grid grid-cols-1 md:grid-cols-1 gap-3 mb-3">
        <div className="text-[12px]">
          <div className="text-gray-400 uppercase font-semibold mb-1">Bên mua</div>
          <div className="font-semibold text-gray-900">
            {buyer.company ? (buyer.name || '—') : (buyer.personName || 'Khách lẻ')}
          </div>
          {buyer.taxId && <div className="text-gray-500">MST: {buyer.taxId}</div>}
          {buyer.address && <div className="text-gray-500 break-words">Địa chỉ: {buyer.address}</div>}
          {(buyer.documentType || buyer.documentNumber) && (
            <div className="text-gray-500">{buyer.documentType} {buyer.documentNumber}</div>
          )}
        </div>
      </div>

      {/* Bảng items */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-600 uppercase text-[10px]">
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Nội dung / hành trình • số vé</th>
              <th className="px-2 py-1.5 text-center">ĐVT</th>
              <th className="px-2 py-1.5 text-right">SL</th>
              <th className="px-2 py-1.5 text-right">Đơn giá</th>
              <th className="px-2 py-1.5 text-right">Thành tiền</th>
              <th className="px-2 py-1.5 text-center">Thuế</th>
              <th className="px-2 py-1.5 text-right">Tiền thuế</th>
              <th className="px-2 py-1.5 text-right">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={9} className="py-3 text-center text-gray-400">Không có dòng nào.</td></tr>
            ) : items.map((it, idx) => (
              <tr key={idx} className="border-t border-gray-100 align-top">
                <td className="px-2 py-1.5 text-gray-500">{it.no || idx + 1}</td>
                <td className="px-2 py-1.5 text-gray-800 break-words">{it.name}</td>
                <td className="px-2 py-1.5 text-center text-gray-600">{it.unit || 'Vé'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtVnd(it.unitPrice)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtVnd(it.amount)}</td>
                <td className="px-2 py-1.5 text-center text-gray-600">{it.vatRateText || '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{fmtVnd(it.vatAmount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtVnd(it.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50">
              <td colSpan={5} className="px-2 py-1.5 text-right text-gray-500">Cộng tiền trước thuế</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtVnd(draft.amountBeforeTax)}</td>
              <td colSpan={2} className="px-2 py-1.5 text-right text-gray-500">Cộng tiền thuế</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtVnd(draft.vatTotal)}</td>
            </tr>
            <tr className="bg-gray-50">
              <td colSpan={8} className="px-2 py-1.5 text-right text-gray-700 font-bold uppercase">Tổng cộng thanh toán</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-extrabold text-gray-900">{fmtVnd(draft.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}