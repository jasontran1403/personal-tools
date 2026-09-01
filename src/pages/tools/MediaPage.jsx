import { useState, useEffect, useRef } from 'react'
import MediaGallery, { TAB_BAR_HEIGHT, toDateInput } from '../../components/media/MediaGallery'
import UploadModal from '../../components/media/UploadModal'
import DateRangePicker from '../../components/DateRangePicker'
import FilesBrowser from '../../components/files/FilesBrowser'
import OfficeWorkspace from '../../components/office/OfficeWorkspace'
import WatermarkEditor from '../../components/media/WatermarkEditor'
import TodoBoard from '../../components/todo/TodoBoard'
import AlbumDropdown from '../../components/media/AlbumDropdown'
import { SkeletonStyles } from '../../components/common/Skeleton'

/**
 * Bộ tiện ích: Hình ảnh · Tệp · Office · Watermark.
 *
 * PANEL trên (dòng tab + 4 nút chức năng full-width) và THANH LỌC dưới (Năm/
 * Tháng/Ngày) đều dùng hiệu ứng kính mờ (glassmorphism) và tự trượt ẩn khi
 * cuộn, hiện lại khi ngừng cuộn.
 */

const TABS = [
  { key: 'library', icon: '🖼️', label: 'Hình ảnh' },
  { key: 'watermark', icon: '💧', label: 'Watermark' },
  { key: 'files', icon: '📁', label: 'Tệp' },
  { key: 'office', icon: '📊', label: 'Office' },
  { key: 'todo', icon: '✅', label: 'Todo' },
]

const FULL_BLEED = new Set(['office', 'watermark', 'todo'])

const GRANS = [
  { key: 'year', label: 'Năm' },
  { key: 'month', label: 'Tháng' },
  { key: 'day', label: 'Ngày' },
]

/** Mốc bắt đầu của năm/tháng/ngày HIỆN TẠI (epoch ms) */
function periodFrom(gran) {
  const d = new Date()
  if (gran === 'day') { d.setHours(0, 0, 0, 0); return d.getTime() }
  if (gran === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  if (gran === 'year') return new Date(d.getFullYear(), 0, 1).getTime()
  return null
}

export default function MediaPage() {
  const [tab, setTab] = useState('library')
  const [refreshKey, setRefresh] = useState(0)
  const [toast, setToast] = useState(null)

  // Bộ điều khiển thư viện
  const [showUpload, setUpload] = useState(false)
  const [onlyFav, setOnlyFav] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [search, setSearch] = useState('')
  const [dateOn, setDateOn] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // Album filter
  const [albumId, setAlbumId] = useState(null)

  // Lọc theo Năm/Tháng/Ngày — mặc định KHÔNG chọn (null)
  const [activeGran, setActiveGran] = useState(null)
  const [filterNonce, setFilterNonce] = useState(0)

  // Panel tự ẩn khi cuộn, hiện lại khi ngừng
  const [navHidden, setNavHidden] = useState(false)
  const idleTimer = useRef(null)
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || window.pageYOffset || 0
      clearTimeout(idleTimer.current)
      if (y < 8) { setNavHidden(false); return }
      setNavHidden(true)
      idleTimer.current = setTimeout(() => setNavHidden(false), 220)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(idleTimer.current) }
  }, [])

  useEffect(() => { setNavHidden(false) }, [tab])

  const notify = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const handleSaved = () => {
    setRefresh(k => k + 1)
    setTab('library')
  }

  const toggleDateFilter = () => {
    if (dateOn) { setDateOn(false); return }
    if (!from || !to) {
      const today = new Date()
      const start = new Date(today)
      start.setDate(start.getDate() - 29)
      setFrom(toDateInput(start))
      setTo(toDateInput(today))
    }
    setDateOn(true)
  }

  /** Bấm nút Năm/Tháng/Ngày: đang chọn thì bỏ, chưa thì bật; luôn tăng nonce */
  const pickGran = key => {
    setActiveGran(g => (g === key ? null : key))
    setFilterNonce(n => n + 1)
  }

  // Gộp thành mốc lọc gửi xuống gallery
  let fromMs = null, toMs = null
  if (activeGran) {
    fromMs = periodFrom(activeGran)
    toMs = null
  } else if (dateOn && from && to) {
    fromMs = new Date(from + 'T00:00:00').getTime()
    toMs = new Date(to + 'T23:59:59').getTime()
  }

  const isLibrary = tab === 'library'
  const fullBleed = FULL_BLEED.has(tab)

  // ── Kiểu nút kính mờ dùng chung ──
  const glassBtn = 'flex-1 h-10 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold ' +
    'border backdrop-blur-md transition active:scale-95'

  return (
    <div className="min-h-screen bg-gray-50">
      <SkeletonStyles />

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[110] px-5 py-3 rounded-xl shadow-xl
          text-sm font-medium text-white max-w-[92vw] text-center
          ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* ══ PANEL TRÊN — kính mờ, tự trượt lên khi cuộn ══ */}
      <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-xl border-b border-white/40
        shadow-sm will-change-transform"
        style={{ transform: navHidden ? 'translateY(-100%)' : 'translateY(0)', transition: 'transform .3s ease' }}>

        {/* Dòng 1 — đổi trang */}
        <div className="w-full px-4 sm:px-6 lg:px-8 flex items-center gap-1 overflow-x-auto
          [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ height: TAB_BAR_HEIGHT }}>
          {TABS.map(({ key, icon, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 h-full text-sm font-semibold
                border-b-2 -mb-px whitespace-nowrap shrink-0 transition-colors
                ${tab === key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              <span>{icon}</span>{label}
            </button>
          ))}

          <div className="ml-auto shrink-0 pl-2" />
        </div>

        {/* Dòng 2 — 4 nút chức năng, FULL WIDTH, kính mờ (chỉ tab Hình ảnh) */}
        {isLibrary && (
          <div className="w-full px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-2 border-t border-white/40">
            <button onClick={() => setUpload(true)}
              className={`${glassBtn} bg-blue-600/90 text-white border-blue-400/50 shadow-lg shadow-blue-500/25`}>
              <span className="text-base leading-none">＋</span> Tải lên
            </button>

            <AlbumDropdown
              activeAlbumId={albumId}
              onSelect={setAlbumId}
              onNotify={notify}
              glassBtn={glassBtn}
            />

            <button onClick={() => setOnlyFav(f => !f)}
              className={`${glassBtn} ${onlyFav
                ? 'bg-rose-500/20 border-rose-300/60 text-rose-600'
                : 'bg-white/50 border-white/60 text-gray-600'}`}>
              <span className="text-base leading-none">{onlyFav ? '❤️' : '🤍'}</span> Yêu thích
            </button>

            <button onClick={() => setShowSearch(v => !v)}
              className={`${glassBtn} ${showSearch || dateOn || search
                ? 'bg-blue-500/20 border-blue-300/60 text-blue-700'
                : 'bg-white/50 border-white/60 text-gray-600'}`}>
              <span className="text-base leading-none">🔍</span> Tìm kiếm
            </button>
          </div>
        )}

        {isLibrary && showSearch && (
          <div className="w-full px-4 sm:px-6 lg:px-8 pb-2 flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm theo tên file..."
              className="flex-1 min-w-0 px-3.5 py-2 bg-white/70 border border-white/60 rounded-lg text-sm
                outline-none focus:border-blue-400 transition-colors placeholder:text-gray-400 backdrop-blur"
            />
            <div className="flex items-center gap-2">
              <button onClick={toggleDateFilter}
                className={`h-9 px-3 rounded-lg text-sm font-semibold border shrink-0 transition-colors backdrop-blur
                  ${dateOn ? 'bg-blue-500/20 border-blue-300/60 text-blue-700' : 'bg-white/50 border-white/60 text-gray-500'}`}>
                🗓 Theo ngày
              </button>
              {dateOn && (
                <DateRangePicker fromDate={from} toDate={to}
                  onChange={(f, t) => { setFrom(f); setTo(t) }} />
              )}
            </div>
          </div>
        )}
      </header>

      {/* ══ NỘI DUNG ══ */}
      <div className={fullBleed
        ? 'w-full px-2 sm:px-4 lg:px-6 pb-4'
        : `w-full px-4 sm:px-6 lg:px-8 ${isLibrary ? 'pb-28' : 'pb-8'}`}>

        {tab === 'library' && (
          <MediaGallery
            refreshKey={refreshKey}
            onNotify={notify}
            onlyFav={onlyFav}
            search={search}
            fromMs={fromMs}
            toMs={toMs}
            granularity={activeGran || 'auto'}
            expandable={!!activeGran}
            filterNonce={filterNonce}
            albumId={albumId}
          />
        )}

        {tab === 'files' && <FilesBrowser onNotify={notify} />}
        {tab === 'office' && <OfficeWorkspace onNotify={notify} />}
        {tab === 'watermark' && (
          <div className="pt-3">
            <WatermarkEditor onSaved={handleSaved} onNotify={notify} />
          </div>
        )}
        {tab === 'todo' && (
          <div className="pt-3">
            <TodoBoard onNotify={notify} />
          </div>
        )}
      </div>

      {/* ══ THANH LỌC DƯỚI: Năm / Tháng / Ngày — kính mờ, full width ══ */}
      {isLibrary && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white/40 backdrop-blur-2xl
          border-t border-white/50 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] will-change-transform"
          style={{
            transform: navHidden ? 'translateY(100%)' : 'translateY(0)',
            transition: 'transform .3s ease',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}>
          <div className="w-full px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-2">
            {GRANS.map(({ key, label }) => (
              <button key={key} onClick={() => pickGran(key)}
                className={`flex-1 h-10 rounded-xl text-sm font-semibold border backdrop-blur-md transition active:scale-95
                  ${activeGran === key
                    ? 'bg-blue-600/90 border-blue-400/50 text-white shadow-lg shadow-blue-500/25'
                    : 'bg-white/50 border-white/60 text-gray-600 hover:text-gray-900'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setUpload(false)}
          onDone={() => setRefresh(k => k + 1)}
          onNotify={notify}
        />
      )}
    </div>
  )
}
