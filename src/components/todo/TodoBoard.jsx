import { useState, useEffect, useRef, useCallback } from 'react'
import { listTodos, createTodo, updateTodoStatus, updateTodo, deleteTodo } from '../../services/api'

/**
 * Bảng Kanban Todo — 3 cột: Đang chờ · Đang làm · Xong.
 *
 * Drag & drop giữa 3 cột + thùng rác.
 * Card đổi màu theo mức độ khẩn cấp dựa trên thời hạn (dueAt).
 * Calendar picker ngày + giờ + phút.
 * Responsive: desktop 3 cột, mobile 1 cột (tab chuyển).
 */

const COLUMNS = [
  { key: 'PENDING', label: 'Đang chờ', icon: '⏳', color: 'blue' },
  { key: 'IN_PROGRESS', label: 'Đang làm', icon: '🔄', color: 'indigo' },
  { key: 'DONE', label: 'Xong', icon: '✅', color: 'teal' },
]

const pad = n => String(n).padStart(2, '0')

const fmtDateTime = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fmtRelative = ts => {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = d - now
  if (diff < 0) return 'Quá hạn'
  if (diff < 60000) return 'Dưới 1 phút'
  if (diff < 3600000) return `${Math.ceil(diff / 60000)} phút`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`
  return `${Math.floor(diff / 86400000)} ngày`
}

/** Màu card dựa vào thời hạn */
function urgencyClass(dueAt, status) {
  if (status === 'DONE') return 'border-teal-300 bg-teal-50/60'
  if (status === 'CANCELLED') return 'border-gray-300 bg-gray-100/60'
  if (status === 'IN_PROGRESS') return 'border-blue-300 bg-blue-50/60'
  if (!dueAt) return 'border-gray-200 bg-white'
  const remain = dueAt - Date.now()
  if (remain < 0) return 'border-red-400 bg-red-50/80'               // quá hạn
  if (remain < 15 * 60 * 1000) return 'border-red-400 bg-red-50/60'  // < 15 phút
  if (remain < 60 * 60 * 1000) return 'border-orange-400 bg-orange-50/60' // < 1 giờ
  if (remain < 24 * 60 * 60 * 1000) return 'border-yellow-400 bg-yellow-50/60' // < 1 ngày
  return 'border-gray-200 bg-white'
}

function startOfWeek(d = new Date()) {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const start = new Date(d)
  start.setDate(diff)
  start.setHours(0, 0, 0, 0)
  return start
}
function endOfWeek(d = new Date()) {
  const s = startOfWeek(d)
  const e = new Date(s)
  e.setDate(e.getDate() + 6)
  e.setHours(23, 59, 59, 999)
  return e
}

const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export default function TodoBoard({ onNotify }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showTrash, setShowTrash] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editItem, setEditItem] = useState(null)

  // Filters
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('')
  const [fromDate, setFromDate] = useState(toDateInput(startOfWeek()))
  const [toDate, setToDate] = useState(toDateInput(endOfWeek()))
  const [showFilters, setShowFilters] = useState(false)

  // Drag
  const dragItem = useRef(null)
  const [dragOver, setDragOver] = useState(null)

  // Mobile: active column tab
  const [mobileCol, setMobileCol] = useState('PENDING')

  const searchTimer = useRef(null)
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setQuery(search), 400)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filters = {}
      if (query) filters.q = query
      if (creatorFilter) filters.creator = creatorFilter
      if (fromDate) filters.from = new Date(fromDate + 'T00:00:00').getTime()
      if (toDate) filters.to = new Date(toDate + 'T23:59:59').getTime()
      if (showTrash) filters.status = 'CANCELLED'

      const res = await listTodos(0, 200, filters)
      const env = res.data
      const d = env?.data ?? env
      setItems(d.content || [])
    } catch (e) {
      onNotify?.(e.message || 'Không tải được danh sách todo', false)
    } finally {
      setLoading(false)
    }
  }, [query, creatorFilter, fromDate, toDate, showTrash, onNotify])

  useEffect(() => { load() }, [load])

  // Refresh urgency colors every 30s
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(k => k + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const handleCreate = async (data) => {
    try {
      await createTodo(data)
      onNotify?.('Đã tạo todo')
      setShowCreate(false)
      load()
    } catch (e) {
      onNotify?.(e.message || 'Tạo todo thất bại', false)
    }
  }

  const handleStatusChange = async (id, status) => {
    try {
      await updateTodoStatus(id, status)
      setItems(prev => prev.map(it => it.id === id ? { ...it, status, updatedAt: Date.now() } : it))
    } catch {
      onNotify?.('Cập nhật thất bại', false)
    }
  }

  const handleExtend = async (id) => {
    setEditItem(items.find(it => it.id === id) || null)
  }

  const handleSaveEdit = async (data) => {
    try {
      await updateTodo(editItem.id, data)
      onNotify?.('Đã cập nhật')
      setEditItem(null)
      load()
    } catch {
      onNotify?.('Cập nhật thất bại', false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteTodo(id)
      setItems(prev => prev.filter(it => it.id !== id))
      onNotify?.('Đã xóa')
    } catch {
      onNotify?.('Xóa thất bại', false)
    }
  }

  // Drag handlers
  const onDragStart = (e, item) => {
    dragItem.current = item
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e, colKey) => {
    e.preventDefault()
    setDragOver(colKey)
  }
  const onDragLeave = () => setDragOver(null)
  const onDrop = (e, colKey) => {
    e.preventDefault()
    setDragOver(null)
    if (dragItem.current && dragItem.current.status !== colKey) {
      handleStatusChange(dragItem.current.id, colKey)
    }
    dragItem.current = null
  }

  const pending = items.filter(i => i.status === 'PENDING')
  const inProgress = items.filter(i => i.status === 'IN_PROGRESS')
  const done = items.filter(i => i.status === 'DONE')
  const cancelled = items.filter(i => i.status === 'CANCELLED')

  const colItems = { PENDING: pending, IN_PROGRESS: inProgress, DONE: done }

  return (
    <div className="space-y-3">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowCreate(true)}
          className="h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-bold
            hover:bg-blue-700 active:scale-95 transition shrink-0">
          ＋ Tạo mới
        </button>
        <button onClick={() => { setShowTrash(t => !t) }}
          className={`h-10 px-4 rounded-xl text-sm font-semibold border transition shrink-0
            ${showTrash ? 'bg-gray-700 text-white border-gray-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          🗑 {showTrash ? 'Đang xem thùng rác' : 'Thùng rác'}
        </button>
        <button onClick={() => setShowFilters(f => !f)}
          className={`h-10 px-4 rounded-xl text-sm font-semibold border transition shrink-0
            ${showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>
          🔍 Tìm kiếm
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          {items.length} việc · {fromDate} → {toDate}
        </span>
      </div>

      {/* ── Filters ── */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 p-3 bg-white border border-gray-100 rounded-xl">
          <div className="flex-1 min-w-[180px]">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Nội dung</label>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Từ khóa..." className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="min-w-[140px]">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Người tạo</label>
            <input value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}
              placeholder="Tên..." className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="min-w-[140px]">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Từ ngày</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="min-w-[140px]">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Đến ngày</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400" />
          </div>
        </div>
      )}

      {/* ── Trash view ── */}
      {showTrash ? (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-500">🗑 Thùng rác ({cancelled.length})</h3>
          {cancelled.length === 0 && <p className="text-xs text-gray-300 py-8 text-center">Trống</p>}
          {cancelled.map(it => (
            <TodoCard key={it.id} item={it}
              onRestore={() => handleStatusChange(it.id, 'PENDING')}
              onDelete={() => handleDelete(it.id)} />
          ))}
        </div>
      ) : (
        <>
          {/* ── Mobile tabs ── */}
          <div className="flex lg:hidden gap-1">
            {COLUMNS.map(col => (
              <button key={col.key} onClick={() => setMobileCol(col.key)}
                className={`flex-1 h-9 rounded-lg text-xs font-semibold transition
                  ${mobileCol === col.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {col.icon} {col.label} ({colItems[col.key].length})
              </button>
            ))}
          </div>

          {/* ── Desktop 3-column Kanban ── */}
          <div className="hidden lg:grid lg:grid-cols-3 gap-3">
            {COLUMNS.map(col => (
              <KanbanColumn key={col.key} col={col} items={colItems[col.key]}
                dragOver={dragOver === col.key}
                onDragOver={e => onDragOver(e, col.key)}
                onDragLeave={onDragLeave}
                onDrop={e => onDrop(e, col.key)}
                onDragStart={onDragStart}
                onStatusChange={handleStatusChange}
                onExtend={handleExtend}
                onCancel={id => handleStatusChange(id, 'CANCELLED')} />
            ))}
          </div>

          {/* ── Mobile single column ── */}
          <div className="lg:hidden space-y-2">
            {colItems[mobileCol]?.length === 0 && (
              <p className="text-xs text-gray-300 py-8 text-center">Chưa có việc nào</p>
            )}
            {colItems[mobileCol]?.map(it => (
              <TodoCard key={it.id} item={it} draggable
                onDragStart={e => onDragStart(e, it)}
                onStatusChange={handleStatusChange}
                onExtend={() => handleExtend(it.id)}
                onCancel={() => handleStatusChange(it.id, 'CANCELLED')} />
            ))}
          </div>

          {/* ── Trash drop zone (desktop) ── */}
          <div className="hidden lg:block">
            <div
              onDragOver={e => onDragOver(e, 'CANCELLED')}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e, 'CANCELLED')}
              className={`h-14 rounded-xl border-2 border-dashed flex items-center justify-center gap-2
                text-sm font-semibold transition-colors
                ${dragOver === 'CANCELLED'
                  ? 'border-red-400 bg-red-50 text-red-600'
                  : 'border-gray-200 text-gray-300'}`}>
              🗑 Kéo vào đây để hủy
            </div>
          </div>
        </>
      )}

      {/* ── Modals ── */}
      {showCreate && (
        <TodoFormModal title="Tạo việc mới" onClose={() => setShowCreate(false)} onSave={handleCreate} />
      )}
      {editItem && (
        <TodoFormModal title="Sửa / Gia hạn" item={editItem} onClose={() => setEditItem(null)} onSave={handleSaveEdit} />
      )}
    </div>
  )
}

function KanbanColumn({ col, items, dragOver, onDragOver, onDragLeave, onDrop, onDragStart, onStatusChange, onExtend, onCancel }) {
  const headerColors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    teal: 'bg-teal-50 text-teal-700 border-teal-200',
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`rounded-xl border transition-colors min-h-[200px]
        ${dragOver ? 'border-blue-400 bg-blue-50/30' : 'border-gray-100 bg-gray-50/50'}`}>
      <div className={`px-3 py-2.5 rounded-t-xl border-b font-bold text-sm flex items-center gap-2 ${headerColors[col.color]}`}>
        <span>{col.icon}</span> {col.label}
        <span className="ml-auto text-xs font-normal opacity-60">{items.length}</span>
      </div>
      <div className="p-2 space-y-2 min-h-[100px]">
        {items.length === 0 && (
          <p className="text-xs text-gray-300 py-6 text-center">Kéo thả vào đây</p>
        )}
        {items.map(it => (
          <TodoCard key={it.id} item={it} draggable
            onDragStart={e => onDragStart(e, it)}
            onStatusChange={onStatusChange}
            onExtend={() => onExtend(it.id)}
            onCancel={() => onCancel(it.id)} />
        ))}
      </div>
    </div>
  )
}

function TodoCard({ item, draggable, onDragStart, onStatusChange, onExtend, onCancel, onRestore, onDelete }) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`p-3 rounded-xl border-l-4 shadow-sm cursor-grab active:cursor-grabbing
        transition-colors ${urgencyClass(item.dueAt, item.status)}`}>
      <p className="text-sm text-gray-800 font-medium leading-snug">{item.content}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
        {item.dueAt && (
          <span title={fmtDateTime(item.dueAt)}>
            ⏰ {fmtDateTime(item.dueAt)}
            {item.status !== 'DONE' && item.status !== 'CANCELLED' && (
              <span className="ml-1 text-gray-500">({fmtRelative(item.dueAt)})</span>
            )}
          </span>
        )}
        <span>👤 {item.creator}</span>
        {item.updatedAt && item.updatedAt !== item.createdAt && (
          <span>✏️ {fmtDateTime(item.updatedAt)}</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {item.status === 'CANCELLED' ? (
          <>
            {onRestore && (
              <MiniBtn onClick={onRestore} color="blue">↩ Khôi phục</MiniBtn>
            )}
            {onDelete && (
              <MiniBtn onClick={onDelete} color="red">✕ Xóa vĩnh viễn</MiniBtn>
            )}
          </>
        ) : (
          <>
            {item.status === 'PENDING' && (
              <MiniBtn onClick={() => onStatusChange?.(item.id, 'IN_PROGRESS')} color="indigo">▶ Bắt đầu</MiniBtn>
            )}
            {item.status === 'IN_PROGRESS' && (
              <MiniBtn onClick={() => onStatusChange?.(item.id, 'DONE')} color="teal">✓ Xong</MiniBtn>
            )}
            {item.status === 'DONE' && (
              <MiniBtn onClick={() => onStatusChange?.(item.id, 'PENDING')} color="gray">↩ Mở lại</MiniBtn>
            )}
            {onExtend && (
              <MiniBtn onClick={onExtend} color="amber">✏️ Sửa/Gia hạn</MiniBtn>
            )}
            {onCancel && item.status !== 'DONE' && (
              <MiniBtn onClick={onCancel} color="red">✕ Hủy</MiniBtn>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MiniBtn({ onClick, color, children }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100',
    indigo: 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
    teal: 'bg-teal-50 text-teal-600 hover:bg-teal-100',
    amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100',
    red: 'bg-red-50 text-red-600 hover:bg-red-100',
    gray: 'bg-gray-100 text-gray-600 hover:bg-gray-200',
  }
  return (
    <button onClick={onClick}
      className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-colors ${colors[color] || colors.gray}`}>
      {children}
    </button>
  )
}

/** Modal tạo/sửa todo với date + time picker */
function TodoFormModal({ title, item, onClose, onSave }) {
  const [content, setContent] = useState(item?.content || '')
  const [creator, setCreator] = useState(item?.creator || '')
  const [hasDue, setHasDue] = useState(!!item?.dueAt)

  const initDate = item?.dueAt ? new Date(item.dueAt) : new Date(Date.now() + 3600000)
  const [dateStr, setDateStr] = useState(toDateInput(initDate))
  const [hour, setHour] = useState(initDate.getHours())
  const [minute, setMinute] = useState(initDate.getMinutes())

  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!content.trim() || !creator.trim()) return
    setSaving(true)
    const data = {
      content: content.trim(),
      creator: creator.trim(),
      dueAt: hasDue ? new Date(`${dateStr}T${pad(hour)}:${pad(minute)}:00`).getTime() : null,
    }
    await onSave(data)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4">
        <h2 className="font-bold text-gray-900 text-base">{title}</h2>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Nội dung *</label>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={3}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 resize-none"
            placeholder="Việc cần làm..." />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Người tạo *</label>
          <input value={creator} onChange={e => setCreator(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400"
            placeholder="Tên..." />
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-500 mb-2 cursor-pointer">
            <input type="checkbox" checked={hasDue} onChange={e => setHasDue(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600" />
            Có thời hạn
          </label>
          {hasDue && (
            <div className="p-3 border border-gray-200 rounded-xl space-y-3 bg-gray-50/50">
              {/* Date */}
              <div>
                <label className="text-[11px] font-semibold text-gray-400 mb-1 block">Ngày</label>
                <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 bg-white" />
              </div>
              {/* Time */}
              <div>
                <label className="text-[11px] font-semibold text-gray-400 mb-1 block">Giờ</label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <NumberSpinner value={hour} min={0} max={23} onChange={setHour} />
                    <span className="text-lg font-bold text-gray-300">:</span>
                    <NumberSpinner value={minute} min={0} max={59} onChange={setMinute} />
                  </div>
                  <span className="ml-2 text-xs text-gray-400 tabular-nums">
                    {pad(hour)}:{pad(minute)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            Hủy
          </button>
          <button onClick={handleSubmit} disabled={saving || !content.trim() || !creator.trim()}
            className="flex-1 h-10 rounded-xl bg-blue-600 text-white text-sm font-bold
              hover:bg-blue-700 disabled:opacity-40 transition">
            {saving ? '...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Spinner giờ/phút dạng cuộn như ảnh mẫu */
function NumberSpinner({ value, min, max, onChange }) {
  const inc = () => onChange(value >= max ? min : value + 1)
  const dec = () => onChange(value <= min ? max : value - 1)

  return (
    <div className="flex flex-col items-center">
      <button onClick={inc} className="w-10 h-8 flex items-center justify-center rounded-t-lg
        border border-gray-200 bg-white text-gray-400 hover:bg-gray-50 text-xs">▲</button>
      <div className="w-10 h-10 flex items-center justify-center border-x border-gray-200
        bg-white text-lg font-bold text-gray-800 tabular-nums">
        {pad(value)}
      </div>
      <button onClick={dec} className="w-10 h-8 flex items-center justify-center rounded-b-lg
        border border-gray-200 bg-white text-gray-400 hover:bg-gray-50 text-xs">▼</button>
    </div>
  )
}