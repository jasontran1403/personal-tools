import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  listFiles, listFileFacets, renameFile, deleteFile, downloadFileAsset, fileUrl,
  deleteFilesBatch, filesZipUrl,
} from '../../services/filesApi'
import { useSweepSelect } from '../../hooks/useSweepSelect'
import SelectionBar from '../common/SelectionBar'
import ConfirmModal from '../common/ConfirmModal'
import {
  iconOf, badgeClassOf, fmtSize, fmtDateTime, fmtRelative, splitName,
  isPreviewable, KIND_LABEL, kindOf,
} from './fileKind'
import { withMinDelay, MIN_LOADING_MS } from '../../lib/timing'
import { SkeletonFileRows } from '../common/Skeleton'
import FileUploadModal from './FileUploadModal'
import FilePreviewModal from './FilePreviewModal'
import PrintDialog from './PrintDialog'
import DateRangePicker from '../DateRangePicker'

/**
 * Trang Tệp — kho tài liệu chung.
 *
 * Thứ tự mặc định: MỚI NHẤT TRÊN ĐẦU. Ngược với trang Hình ảnh (cũ nhất trên
 * đầu, mới nhất dưới đáy như gallery điện thoại) — đây là chủ ý, vì hai trang
 * phục vụ hai thói quen khác nhau: xem ảnh là lướt lại kỷ niệm, còn tìm tệp là
 * tìm thứ vừa mới đưa lên.
 *
 * Hệ quả: nút "Đang tải thêm" ở ĐÁY và các dòng mới trượt vào từ dưới lên.
 */

const TAB_BAR_HEIGHT = 44
const TOOLBAR_TOP = TAB_BAR_HEIGHT

const SORTS = [
  { key: 'createdAt-desc', label: 'Mới nhất trước',      sort: 'createdAt', dir: 'desc' },
  { key: 'createdAt-asc',  label: 'Cũ nhất trước',       sort: 'createdAt', dir: 'asc'  },
  { key: 'name-asc',       label: 'Tên A → Z',           sort: 'name',      dir: 'asc'  },
  { key: 'name-desc',      label: 'Tên Z → A',           sort: 'name',      dir: 'desc' },
  { key: 'size-asc',       label: 'Nhỏ nhất trước',      sort: 'size',      dir: 'asc'  },
  { key: 'size-desc',      label: 'Lớn nhất trước',      sort: 'size',      dir: 'desc' },
]

const toDateInput = d => {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function computePageSize() {
  if (typeof window === 'undefined') return 30
  // Mỗi dòng cao ~68px; lấy đủ phủ màn hình cộng một màn đệm
  return Math.min(100, Math.max(15, Math.ceil((window.innerHeight * 2) / 68)))
}

export default function FilesBrowser({ onNotify }) {
  const [items, setItems]      = useState([])
  const [page, setPage]        = useState(0)
  const [totalPages, setTotal] = useState(0)
  const [totalCount, setCount] = useState(0)
  const [loading, setLoading]  = useState(true)     // tải lần đầu / đổi bộ lọc
  const [appending, setAppend] = useState(false)    // đang tải thêm ở đáy
  const [facets, setFacets]    = useState([])

  const [showUpload, setUpload]   = useState(false)
  const [preview, setPreview]     = useState(null)
  const [printing, setPrinting]   = useState(null)
  const [renaming, setRenaming]   = useState(null)  // { id, draft }
  const [confirmDel, setConfirm]  = useState(null)
  const [showFilters, setFilters] = useState(false)

  // Bộ lọc
  const [search, setSearch] = useState('')
  const [query, setQuery]   = useState('')
  const [exts, setExts]     = useState([])
  const [dateOn, setDateOn] = useState(false)
  const [from, setFrom]     = useState('')
  const [to, setTo]         = useState('')
  const [sortKey, setSortKey] = useState('createdAt-desc')

  const searchTimer = useRef(null)
  const loadingRef  = useRef(false)
  const sentinelRef = useRef(null)
  const pageSizeRef = useRef(computePageSize())

  // Chọn nhiều tệp để tải/xóa hàng loạt
  const listRef = useRef(null)
  const sel = useSweepSelect(listRef)
  const [askDelete, setAskDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  // Đánh dấu lô vừa chèn để chỉ chạy animation cho dòng mới, không chạy lại
  // cho toàn bộ danh sách mỗi lần vẽ
  const freshFrom   = useRef(0)

  const sortCfg = useMemo(
    () => SORTS.find(s => s.key === sortKey) || SORTS[0],
    [sortKey]
  )

  // Gõ tới đâu gọi API tới đó thì vừa giật vừa tốn request → chờ 400ms
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setQuery(search), 400)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    const onResize = () => { pageSizeRef.current = computePageSize() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Tải dữ liệu ─────────────────────────────────────────────────

  const buildFilters = useCallback(() => ({
    q: query,
    exts,
    // 'to' phải lấy hết 23:59:59, không thì chọn cùng một ngày ở cả hai đầu
    // sẽ không ra kết quả nào
    from: dateOn && from ? new Date(from + 'T00:00:00').getTime() : null,
    to:   dateOn && to   ? new Date(to   + 'T23:59:59').getTime() : null,
    sort: sortCfg.sort,
    dir:  sortCfg.dir,
  }), [query, exts, dateOn, from, to, sortCfg])

  const load = useCallback(async (targetPage, append) => {
    if (loadingRef.current) return
    loadingRef.current = true
    append ? setAppend(true) : setLoading(true)

    try {
      const request = listFiles(targetPage, pageSizeRef.current, buildFilters())

      // Khi tải thêm, ép dòng "Đang tải thêm" hiện đủ 600ms. Mạng nhanh thì nó
      // chớp lên rồi tắt trong 40ms, danh sách tự dài ra mà không rõ vì sao —
      // cảm giác giật cục. Chờ SONG SONG nên mạng chậm không tốn thêm giây nào.
      const data = append ? await withMinDelay(request, MIN_LOADING_MS) : await request

      const batch = data.content || []
      setItems(prev => {
        if (!append) { freshFrom.current = 0; return batch }
        freshFrom.current = prev.length
        // Khử trùng phòng khi có tệp mới chen vào giữa lúc đang phân trang
        const seen = new Set(prev.map(i => i.id))
        return [...prev, ...batch.filter(i => !seen.has(i.id))]
      })
      setTotal(data.totalPages || 0)
      setCount(data.totalElements || 0)
      setPage(data.currentPage || 0)

    } catch (e) {
      onNotify?.(e.message || 'Không tải được danh sách tệp', false)
    } finally {
      setLoading(false)
      setAppend(false)
      loadingRef.current = false
    }
  }, [buildFilters, onNotify])

  // Đổi bộ lọc / sắp xếp → tải lại từ đầu
  useEffect(() => {
    pageSizeRef.current = computePageSize()
    window.scrollTo({ top: 0, behavior: 'auto' })
    load(0, false)
  }, [query, exts, dateOn, from, to, sortKey])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listFileFacets().then(setFacets).catch(() => setFacets([]))
  }, [totalCount])

  // ── Cuộn tới đáy → tải thêm ─────────────────────────────────────
  /**
   * IntersectionObserver thay cho sự kiện scroll: trình duyệt tự báo khi phần
   * tử mốc lọt vào khung nhìn, không phải tính toán ở mỗi khung hình cuộn.
   * rootMargin 300px để bắt đầu tải trước khi người dùng chạm đáy thật.
   */
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return

    const io = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      if (loadingRef.current) return
      if (page >= totalPages - 1) return
      load(page + 1, true)
    }, { rootMargin: '300px' })

    io.observe(el)
    return () => io.disconnect()
  }, [page, totalPages, load])

  // ── Thao tác trên tệp ───────────────────────────────────────────

  const handleRename = async (asset, newBase) => {
    const trimmed = newBase.trim()
    setRenaming(null)
    if (!trimmed) return

    const { base } = splitName(asset.originalName)
    if (trimmed === base) return

    try {
      const updated = await renameFile(asset.id, trimmed)
      setItems(prev => prev.map(i => i.id === asset.id ? { ...i, ...updated } : i))
      if (updated.originalName !== `${trimmed}.${asset.ext}`) {
        onNotify?.(`Tên đã tồn tại, lưu thành "${updated.originalName}"`)
      } else {
        onNotify?.('Đã đổi tên')
      }
    } catch (e) {
      onNotify?.(e.message || 'Đổi tên thất bại', false)
    }
  }

  const handleDelete = async asset => {
    setConfirm(null)
    try {
      await deleteFile(asset.id)
      setItems(prev => prev.filter(i => i.id !== asset.id))
      setCount(c => Math.max(0, c - 1))
      onNotify?.('Đã xóa tệp')
    } catch {
      onNotify?.('Xóa thất bại', false)
    }
  }

  const handleDownload = async asset => {
    try {
      await downloadFileAsset(asset)
    } catch {
      onNotify?.('Không tải được tệp', false)
    }
  }

  // ── Chọn nhiều ──
  const selectedIds = () => [...sel.selected].map(Number)

  const openRow = item => {
    if (sel.consumeClick()) return
    if (sel.selectMode) { sel.toggle(item.id); return }
    if (isPreviewable(item) && !renaming) setPreview(item)
  }

  const downloadSelected = () => {
    const ids = selectedIds()
    if (ids.length === 0) return
    const a = document.createElement('a')
    a.href = filesZipUrl(ids); a.rel = 'noopener'
    document.body.appendChild(a); a.click(); a.remove()
    onNotify?.(`Đang tải ${ids.length} tệp...`)
  }

  const confirmDeleteSelected = async () => {
    const ids = selectedIds()
    setBusy(true)
    try {
      await deleteFilesBatch(ids)
      const rm = new Set(ids)
      setItems(prev => prev.filter(i => !rm.has(i.id)))
      setCount(c => Math.max(0, c - ids.length))
      onNotify?.(`Đã xóa ${ids.length} tệp`)
      sel.exit()
    } catch {
      onNotify?.('Xóa thất bại', false)
    } finally {
      setBusy(false)
      setAskDelete(false)
    }
  }

  const toggleExt = ext =>
    setExts(prev => prev.includes(ext) ? prev.filter(e => e !== ext) : [...prev, ext])

  const toggleDateFilter = () => {
    if (dateOn) { setDateOn(false); return }
    if (!from || !to) {
      const today = new Date()
      const start = new Date(today)
      start.setDate(start.getDate() - 29)   // 29 vì hôm nay đã là ngày thứ 30
      setFrom(toDateInput(start))
      setTo(toDateInput(today))
    }
    setDateOn(true)
  }

  const clearFilters = () => {
    setSearch(''); setQuery(''); setExts([])
    setDateOn(false); setFrom(''); setTo('')
    setSortKey('createdAt-desc')
  }

  const hasFilter = query || exts.length > 0 || dateOn
  const hasMore = page < totalPages - 1

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes fileInBottom {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: none; }
        }
        .file-row-new { animation: fileInBottom .34s cubic-bezier(.2,.8,.3,1) both; }
        @media (prefers-reduced-motion: reduce) { .file-row-new { animation: none; } }
      `}</style>

      {/* Thanh công cụ, ghim ngay dưới thanh tab */}
      <div className="sticky z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2
        bg-gray-50/95 backdrop-blur border-b border-gray-200"
        style={{ top: TOOLBAR_TOP }}>

        <div className="flex items-center gap-2">
          <button onClick={() => setUpload(true)} title="Tải lên"
            className="h-9 px-3 rounded-lg bg-blue-600 text-white text-sm font-semibold
              flex items-center gap-1.5 active:scale-95 transition shrink-0">
            <span className="text-base leading-none">＋</span>
            <span className="hidden sm:inline">Tải lên</span>
          </button>

          <button onClick={() => setFilters(v => !v)} title="Tìm kiếm và lọc"
            className={`h-9 px-3 rounded-lg text-sm font-semibold border flex items-center gap-1.5
              active:scale-95 transition-colors shrink-0
              ${showFilters || hasFilter
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-gray-200 text-gray-500'}`}>
            <span className="text-base leading-none">🔍</span>
            <span className="hidden sm:inline">Tìm kiếm</span>
            {exts.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px]
                flex items-center justify-center">{exts.length}</span>
            )}
          </button>

          <select value={sortKey} onChange={e => setSortKey(e.target.value)}
            className="h-9 px-2 rounded-lg border border-gray-200 bg-white text-sm
              text-gray-600 outline-none focus:border-blue-400 shrink-0 max-w-[150px]">
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>

          <span className="text-xs sm:text-sm text-gray-400 ml-auto shrink-0 tabular-nums">
            {totalCount} tệp
          </span>
        </div>

        {showFilters && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm theo tên tệp..."
                className="flex-1 min-w-0 px-3.5 py-2 bg-white border border-gray-200 rounded-lg
                  text-sm outline-none focus:border-blue-400 transition-colors placeholder:text-gray-300"
              />
              <div className="flex items-center gap-2">
                <button onClick={toggleDateFilter}
                  className={`h-9 px-3 rounded-lg text-sm font-semibold border shrink-0 transition-colors
                    ${dateOn ? 'bg-blue-50 border-blue-200 text-blue-700'
                             : 'bg-white border-gray-200 text-gray-500'}`}>
                  🗓 Theo ngày
                </button>
                {dateOn && (
                  <DateRangePicker fromDate={from} toDate={to}
                    onChange={(f, t) => { setFrom(f); setTo(t) }} />
                )}
              </div>
            </div>

            {facets.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mr-1">
                  Định dạng
                </span>
                {facets.map(f => (
                  <button key={f.ext} onClick={() => toggleExt(f.ext)}
                    className={`h-7 px-2.5 rounded-lg border text-[11px] font-bold uppercase
                      transition-colors
                      ${exts.includes(f.ext)
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {f.ext}
                    <span className="ml-1 font-normal opacity-60">{f.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {hasFilter && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <span>Đang lọc</span>
            <button onClick={clearFilters} className="text-blue-600 font-semibold hover:underline">
              Bỏ tất cả bộ lọc
            </button>
          </div>
        )}
      </div>

      {/* Danh sách */}
      <div className="pt-3">
        {loading ? (
          <SkeletonFileRows rows={8} />
        ) : items.length === 0 ? (
          <div className="py-20 text-center text-gray-300">
            <div className="text-5xl mb-3">{hasFilter ? '🔍' : '📂'}</div>
            <p className="text-sm">
              {hasFilter ? 'Không có tệp nào khớp bộ lọc' : 'Kho tệp đang trống'}
            </p>
            {!hasFilter && (
              <button onClick={() => setUpload(true)}
                className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">
                Tải tệp đầu tiên lên
              </button>
            )}
          </div>
        ) : (
          <div ref={listRef} className="space-y-1.5 select-none"
            onContextMenu={e => e.preventDefault()}
            style={{
              touchAction: sel.selectMode ? 'none' : 'auto',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
            }}>
            {items.map((item, idx) => (
              <FileRow
                key={item.id}
                asset={item}
                fresh={idx >= freshFrom.current && freshFrom.current > 0}
                freshIndex={idx - freshFrom.current}
                renaming={renaming?.id === item.id ? renaming : null}
                confirming={confirmDel === item.id}
                selectMode={sel.selectMode}
                picked={sel.isSelected(item.id)}
                onOpen={() => openRow(item)}
                onStartRename={() => setRenaming({ id: item.id, draft: splitName(item.originalName).base })}
                onChangeRename={v => setRenaming({ id: item.id, draft: v })}
                onCommitRename={() => handleRename(item, renaming.draft)}
                onCancelRename={() => setRenaming(null)}
                onAskDelete={() => setConfirm(item.id)}
                onCancelDelete={() => setConfirm(null)}
                onConfirmDelete={() => handleDelete(item)}
                onDownload={() => handleDownload(item)}
              />
            ))}
          </div>
        )}

        {/* Mốc kích hoạt tải thêm + thông báo, đặt ở ĐÁY */}
        <div ref={sentinelRef} className="py-5 text-center">
          {appending ? (
            <span className="inline-flex items-center gap-2 text-xs text-gray-400">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-200
                border-t-blue-500 animate-spin" />
              Đang tải thêm...
            </span>
          ) : hasMore ? (
            <span className="text-xs text-gray-300">↓ Cuộn xuống để xem thêm tệp</span>
          ) : items.length > 0 ? (
            <span className="text-xs text-gray-300">Đã hiển thị tất cả {totalCount} tệp</span>
          ) : null}
        </div>

        {sel.selectMode && <div className="h-16" />}
      </div>

      {/* Hộp thoại */}
      {showUpload && (
        <FileUploadModal
          onClose={() => setUpload(false)}
          onDone={() => load(0, false)}
          onNotify={onNotify}
        />
      )}

      {preview && (
        <FilePreviewModal
          asset={preview}
          onClose={() => setPreview(null)}
          onSaved={updated => {
            setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i))
            setPreview(p => p ? { ...p, ...updated } : p)
          }}
          onNotify={onNotify}
          onPrint={setPrinting}
        />
      )}

      {printing && (
        <PrintDialog asset={printing} onClose={() => setPrinting(null)} onNotify={onNotify} />
      )}

      {sel.selectMode && (
        <SelectionBar
          count={sel.count}
          busy={busy}
          onCancel={sel.exit}
          onDeselectAll={sel.clearStay}
          onDownload={downloadSelected}
          onDelete={() => sel.count > 0 && setAskDelete(true)}
        />
      )}

      <ConfirmModal
        open={askDelete}
        danger
        title={`Xóa ${sel.count} tệp?`}
        message="Các tệp đã chọn sẽ bị xóa vĩnh viễn và không thể khôi phục."
        confirmLabel="Xóa"
        busy={busy}
        onConfirm={confirmDeleteSelected}
        onCancel={() => setAskDelete(false)}
      />
    </>
  )
}

/* ── Một dòng tệp ────────────────────────────────────────────────── */

function FileRow({
  asset, fresh, freshIndex, renaming, confirming, selectMode, picked,
  onOpen, onStartRename, onChangeRename, onCommitRename, onCancelRename,
  onAskDelete, onCancelDelete, onConfirmDelete, onDownload,
}) {
  const canPreview = isPreviewable(asset)
  const thumb = asset.thumbUrl ? fileUrl(asset.thumbUrl) : null

  return (
    <div
      data-select-id={asset.id}
      // Bấm một lần là mở xem trước (hoặc bật/tắt chọn khi đang ở chế độ chọn).
      onClick={() => (selectMode ? onOpen() : (canPreview && !renaming && onOpen()))}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all
        ${picked
          ? 'bg-blue-50 border border-blue-300 shadow-sm'
          : 'bg-white border border-gray-100 hover:border-gray-200 hover:shadow-sm'}
        ${(canPreview || selectMode) ? 'cursor-pointer' : ''} ${fresh ? 'file-row-new' : ''}`}
      style={fresh ? { animationDelay: `${Math.min(freshIndex, 10) * 32}ms` } : undefined}>

      {/* Ô đánh dấu khi đang chọn */}
      {selectMode && (
        <span className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center
          text-[11px] ${picked ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-300 text-transparent'}`}>
          ✓
        </span>
      )}

      {/* Biểu tượng hoặc ảnh thu nhỏ */}
      <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-gray-50
        border border-gray-100 flex items-center justify-center">
        {thumb
          ? <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <span className="text-lg">{iconOf(asset)}</span>}
      </div>

      {/* Tên + thời gian */}
      <div className="min-w-0 flex-1">
        {renaming ? (
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <input
              value={renaming.draft}
              autoFocus
              onChange={e => onChangeRename(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  onCommitRename()
                if (e.key === 'Escape') onCancelRename()
              }}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-blue-300
                text-sm outline-none focus:border-blue-500 select-text [-webkit-user-select:text]"
            />
            {asset.ext && <span className="text-xs text-gray-400 shrink-0">.{asset.ext}</span>}
            <button onClick={onCommitRename}
              className="shrink-0 h-8 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold">
              Lưu
            </button>
            <button onClick={onCancelRename}
              className="shrink-0 h-8 px-2.5 rounded-lg bg-gray-100 text-gray-500 text-xs font-semibold">
              Huỷ
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-800 truncate">{asset.originalName}</p>
            <p className="text-[11px] text-gray-400 flex items-center gap-1.5 flex-wrap">
              <span title={fmtDateTime(asset.createdAt)}>{fmtRelative(asset.createdAt)}</span>
              <span className="text-gray-200">·</span>
              <span className="tabular-nums">{fmtSize(asset.sizeBytes)}</span>
              {asset.updatedAt && asset.updatedAt - asset.createdAt > 60000 && (
                <>
                  <span className="text-gray-200">·</span>
                  <span className="text-blue-500">đã sửa</span>
                </>
              )}
            </p>
          </>
        )}
      </div>

      {/* Badge định dạng */}
      {!renaming && (
        <span
          title={KIND_LABEL[kindOf(asset)]}
          className={`shrink-0 px-2 py-1 rounded-md border text-[10px] font-bold uppercase
            tabular-nums ${badgeClassOf(asset)}`}>
          {asset.ext || '—'}
        </span>
      )}

      {/*
        Hành động khi rê chuột. Không có nút xem trước — bấm vào cả dòng là mở
        rồi, thêm nút nữa chỉ làm thừa. Cũng không có nút in: in nằm trong cửa sổ
        xem trước, nơi người dùng đã nhìn thấy nội dung sắp in.
      */}
      {!renaming && !confirming && !selectMode && (
        <div className="shrink-0 flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100
          transition-opacity" onClick={e => e.stopPropagation()}>
          <IconBtn onClick={onDownload} title="Tải về">⬇</IconBtn>
          <IconBtn onClick={onStartRename} title="Đổi tên">✏️</IconBtn>
          <IconBtn onClick={onAskDelete} title="Xóa" danger>🗑</IconBtn>
        </div>
      )}

      {confirming && !selectMode && (
        <div className="shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <span className="text-xs text-red-600 font-medium hidden sm:inline">Xóa vĩnh viễn?</span>
          <button onClick={onCancelDelete}
            className="h-8 px-3 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold">
            Huỷ
          </button>
          <button onClick={onConfirmDelete}
            className="h-8 px-3 rounded-lg bg-red-600 text-white text-xs font-bold">
            Xóa
          </button>
        </div>
      )}
    </div>
  )
}

function IconBtn({ onClick, title, danger, children }) {
  return (
    <button onClick={onClick} title={title}
      className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm
        transition-colors ${danger ? 'hover:bg-red-50' : 'hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}