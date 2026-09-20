import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { listTodo, deleteTodo } from '../../services/todoApi'
import {
  TaskFormModal, TaskCompleteModal, TaskExtendModal,
  TaskCancelModal, TaskDetailModal
} from './TaskActionModals'

/**
 * ── TodoTab ─────────────────────────────────────────────
 * Calendar 7 ngày (today + 6 ngày sau) dạng cột dọc + thang giờ 6h-23h.
 *
 * ── 2026-09-20 rework theo feedback ────────────────────
 *   1) Popup action: đo chiều cao POPUP THẬT bằng useLayoutEffect →
 *      nếu spaceBelow < popupHeight → tự flip lên trên. Animation
 *      scale+opacity mượt.
 *   2) Calendar dùng 1 grid duy nhất (header + body chung 1 scroll
 *      container). Sticky top cho header ngày → scroll ngang là
 *      header ngày trôi theo cột. Sticky left cho thang giờ.
 *   3) Nút "+ Thêm task" là floating action button (fixed bottom-right).
 *   4) Bỏ header "Todo / Lịch 7 ngày..." (nội dung dư).
 *   5) NowLine dùng {@code tick} prop (parent update 1s) → re-render
 *      mỗi giây, position bám sát thời gian thực.
 *   6) Badge "deadline gần nhất" ở TOP-RIGHT của TodoTab (absolute).
 *   7) Cột ngày có width động = max(180, lanes × 180)px. Ngày nào
 *      có task chồng nhau → cột ngày đó dãn ra, không đè sang ngày khác.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_START = 6
const HOUR_END = 23
const HOUR_HEIGHT = 60
const DAY_MIN_WIDTH = 180

export default function TodoTab({ onTasksChanged }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [modal, setModal] = useState(null)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const [rangeStart, rangeEnd] = useMemo(() => {
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    return [start, start + 7 * DAY_MS]
  }, [])

  const days = useMemo(() => {
    const arr = []
    const today = new Date(rangeStart)
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      arr.push(d)
    }
    return arr
  }, [rangeStart])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listTodo(rangeStart, rangeEnd)
      if (res.data?.error) throw new Error(res.data.message)
      setTasks(res.data?.data || [])
    } catch (e) {
      toast.error(e.message || 'Không tải được task')
    } finally {
      setLoading(false)
    }
  }, [rangeStart, rangeEnd])

  useEffect(() => { load() }, [load])

  // ── 2026-09-20: sau MỌI thao tác thay đổi task, gọi cả load (refresh
  // TodoTab) + onTasksChanged (refresh badge trên tab bar). Trước chỉ
  // gọi load → badge stale 30s. ──
  const refreshAll = useCallback(() => {
    load()
    if (onTasksChanged) onTasksChanged()
  }, [load, onTasksChanged])

  const onSaved = () => { refreshAll(); setEditing(null); setShowForm(false) }
  const onActionDone = () => { refreshAll(); setModal(null) }

  const tasksByDay = useMemo(() => {
    const map = new Map()
    for (const d of days) map.set(dayStart(d), [])
    for (const t of tasks) {
      const key = dayStart(new Date(t.deadline))
      if (map.has(key)) map.get(key).push(t)
    }
    return map
  }, [tasks, days])

  const handleCardAction = (type, task) => {
    if (task.status !== 'PENDING') {
      toast.error('Task này không thể thao tác nữa')
      return
    }
    setModal({ type, task })
  }

  return (
    <div className="relative">
      {/* ── Nút thêm task — fixed dưới tab bar, luôn nổi trên UI ── */}
      {/* 2026-09-20: dùng fixed thay absolute vì absolute vào TodoTab
          bị calendar container "nuốt" (dù z-index cao). Fixed top-24
          nằm ngay dưới header + tab bar (~80px), lệch phải, luôn thấy. */}
      <button type="button" onClick={() => { setEditing(null); setShowForm(true) }}
        title="Thêm task mới"
        className="fixed top-24 right-6 z-40 px-4 py-2 rounded-full
                   bg-gradient-to-br from-blue-600 to-indigo-600 text-white
                   text-sm font-semibold shadow-lg shadow-blue-500/40
                   hover:scale-105 active:scale-95 transition-transform
                   flex items-center gap-1">
        <span className="text-lg leading-none">+</span>
        <span>Thêm task</span>
      </button>

      {/* ── Calendar ─────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-10 text-gray-400">Đang tải…</div>
      ) : (
        <CalendarGrid days={days} tasksByDay={tasksByDay} tick={tick}
          onCardAction={handleCardAction}
          onCardClick={(task) => setModal({ type: 'detail', task })}
          onEditPending={(task) => { setEditing(task); setShowForm(true) }}
          onDelete={async (task) => {
            if (!confirm(`Xóa task "${task.unitName}"?`)) return
            try { await deleteTodo(task.id); toast.success('Đã xóa'); refreshAll() }
            catch (e) { toast.error(e.message || 'Xóa thất bại') }
          }}
        />
      )}

      {/* Modals */}
      <TaskFormModal open={showForm} initial={editing}
        onClose={() => { setShowForm(false); setEditing(null) }} onSaved={onSaved} />
      <TaskCompleteModal open={modal?.type === 'complete'} task={modal?.task}
        onClose={() => setModal(null)} onDone={onActionDone} />
      <TaskExtendModal open={modal?.type === 'extend'} task={modal?.task}
        onClose={() => setModal(null)} onDone={onActionDone} />
      <TaskCancelModal open={modal?.type === 'cancel'} task={modal?.task}
        onClose={() => setModal(null)} onDone={onActionDone} />
      <TaskDetailModal open={modal?.type === 'detail'} task={modal?.task}
        onClose={() => setModal(null)} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  CALENDAR GRID
// ══════════════════════════════════════════════════════════════

function CalendarGrid({ days, tasksByDay, tick, onCardAction, onCardClick, onEditPending, onDelete }) {
  // Layout tasks + tính maxLane cho mỗi ngày → dùng làm chiều rộng cột
  const perDay = useMemo(() => {
    const m = new Map()
    for (const d of days) {
      const dt = tasksByDay.get(dayStart(d)) || []
      const positioned = layoutTasks(dt)
      const maxLane = positioned.length > 0 ? positioned[0].laneTotal : 1
      m.set(dayStart(d), { positioned, maxLane })
    }
    return m
  }, [days, tasksByDay])

  // Grid columns: cột đầu là thang giờ (60px), 7 cột ngày CHIA ĐỀU.
  // ── 2026-09-20 fix ────────────────────────────────────
  // Trước: mỗi ngày width riêng theo maxLane của ngày đó → cột không đều,
  //        thừa hết space bên phải khi ngày nào cũng ít task.
  // Nay: lấy MAX lanes qua tất cả ngày → min width chung, dùng minmax(min, 1fr)
  //      → tất cả cột đều nhau + tự dãn ra để lấp đầy container.
  const maxLanesAllDays = Math.max(1, ...days.map(d => perDay.get(dayStart(d))?.maxLane || 1))
  const dayMinWidth = Math.max(DAY_MIN_WIDTH, maxLanesAllDays * DAY_MIN_WIDTH)
  const gridTemplateColumns = `60px repeat(7, minmax(${dayMinWidth}px, 1fr))`

  const bodyHeight = (HOUR_END - HOUR_START + 1) * HOUR_HEIGHT

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-auto"
      style={{ maxHeight: 'calc(100vh - 140px)' }}>
      <div className="grid relative"
        style={{ gridTemplateColumns, gridTemplateRows: 'auto 1fr' }}>

        {/* ── Row 1: header ── */}
        {/* Corner cell — sticky cả top và left, z cao nhất */}
        <div className="sticky top-0 left-0 z-40 bg-gray-50 border-b border-r border-gray-200
                        px-3 py-3 text-[10px] text-gray-500 font-semibold text-right">
          Giờ
        </div>
        {/* Day headers — sticky top */}
        {days.map(d => (
          <div key={d.getTime()}
            className="sticky top-0 z-30 bg-gray-50 border-b border-l border-gray-200">
            <DayHeader day={d} count={tasksByDay.get(dayStart(d))?.length || 0} />
          </div>
        ))}

        {/* ── Row 2: body ── */}
        {/* Time labels — sticky left */}
        <div className="sticky left-0 z-20 bg-white border-r border-gray-100"
          style={{ height: bodyHeight }}>
          {range(HOUR_START, HOUR_END + 1).map(h => (
            <div key={h} className="text-[11px] text-gray-500 font-mono text-right pr-3 pt-2 flex items-start"
              style={{ height: HOUR_HEIGHT }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {/* Day columns */}
        {days.map(d => {
          const { positioned, maxLane } = perDay.get(dayStart(d)) || { positioned: [], maxLane: 1 }
          return (
            <DayColumn key={d.getTime()} day={d}
              positioned={positioned}
              maxLane={maxLane}
              height={bodyHeight}
              tick={tick}
              onCardAction={onCardAction}
              onCardClick={onCardClick}
              onEditPending={onEditPending}
              onDelete={onDelete}
            />
          )
        })}
      </div>
    </div>
  )
}

function DayHeader({ day, count }) {
  const isToday = isSameDay(day, new Date())
  const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][day.getDay()]
  return (
    <div className={`p-2 text-center ${isToday ? 'bg-blue-50' : ''}`}>
      <div className="text-[11px] text-gray-500 font-semibold">{wd}</div>
      <div className={`text-base font-bold ${isToday ? 'text-blue-700' : 'text-gray-800'}`}>{day.getDate()}</div>
      <div className="text-[10px] text-gray-400">{day.getMonth() + 1}/{day.getFullYear()}</div>
      {count > 0 && (
        <div className="text-[10px] mt-1 inline-block px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">
          {count} task
        </div>
      )}
    </div>
  )
}

function DayColumn({ day, positioned, maxLane, height, tick, onCardAction, onCardClick, onEditPending, onDelete }) {
  const isToday = isSameDay(day, new Date())
  return (
    <div className={`relative border-l border-gray-100 ${isToday ? 'bg-blue-50/20' : ''}`}
      style={{ height }}>
      {range(HOUR_START, HOUR_END + 1).map(h => (
        <div key={h} className="border-b border-gray-100" style={{ height: HOUR_HEIGHT }} />
      ))}
      {isToday && <NowLine tick={tick} />}
      {positioned.map(({ task, lane, laneTotal }) => (
        <TaskCard key={task.id} task={task} tick={tick} lane={lane} laneTotal={laneTotal}
          onAction={onCardAction} onClick={onCardClick}
          onEdit={onEditPending} onDelete={onDelete} />
      ))}
    </div>
  )
}

function NowLine({ tick }) {
  // tick từ parent update 1s → hàm này re-render mỗi giây → position update
  void tick
  const now = new Date()
  const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  if (h < HOUR_START || h > HOUR_END + 1) return null
  const pos = (h - HOUR_START) * HOUR_HEIGHT
  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: pos }}>
      <div className="h-0.5 bg-rose-500 shadow-sm shadow-rose-500/50" />
      <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm" />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  TASK CARD
// ══════════════════════════════════════════════════════════════

function TaskCard({ task, tick, lane, laneTotal, onAction, onClick, onEdit, onDelete }) {
  const [showActions, setShowActions] = useState(false)
  const [anchorRect, setAnchorRect] = useState(null)
  const pressTimer = useRef(null)
  const cardRef = useRef(null)

  const startPress = () => {
    if (task.status !== 'PENDING') return
    pressTimer.current = setTimeout(() => {
      const rect = cardRef.current?.getBoundingClientRect()
      if (rect) setAnchorRect({
        top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
      })
      setShowActions(true)
      if (navigator.vibrate) navigator.vibrate(15)
    }, 500)
  }
  const cancelPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current) }

  const handleClick = () => {
    if (showActions) return
    onClick(task)
  }

  const d = new Date(task.deadline)
  const h = d.getHours() + d.getMinutes() / 60
  const top = Math.max(0, (h - HOUR_START) * HOUR_HEIGHT - 24)
  const width = 100 / Math.max(1, laneTotal)
  const left = width * lane

  void tick // ép re-render mỗi giây → countdown update
  const remainMs = task.deadline - Date.now()
  const nearDeadline = task.status === 'PENDING' && remainMs > 0 && remainMs < 2 * 60 * 60 * 1000
  const overdue = task.status === 'PENDING' && remainMs <= 0

  const bg =
      task.status === 'COMPLETED' ? 'bg-emerald-100 border-emerald-300'
    : task.status === 'CANCELLED' ? 'bg-gray-100 border-gray-300 opacity-60'
    : overdue                     ? 'bg-rose-100 border-rose-400 animate-pulse'
    : nearDeadline                ? 'bg-teal-100 border-teal-400 animate-pulse'
    : 'bg-blue-50 border-blue-300'

  return (
    <div className="absolute" style={{ top, left: `${left}%`, width: `${width}%`, padding: '2px 4px', zIndex: 10 }}>
      <div
        ref={cardRef}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onClick={handleClick}
        className={`relative rounded-lg border-2 p-2 cursor-pointer transition-transform hover:scale-[1.02] hover:shadow-md ${bg}`}
        style={{ minHeight: 66, touchAction: 'manipulation' }}>
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
            task.status === 'COMPLETED' ? 'bg-emerald-600 text-white'
            : task.status === 'CANCELLED' ? 'bg-gray-600 text-white'
            : overdue ? 'bg-rose-600 text-white'
            : 'bg-blue-600 text-white'
          }`}>
            {String(d.getHours()).padStart(2,'0')}:{String(d.getMinutes()).padStart(2,'0')}
          </span>
          {task.status === 'PENDING' && (
            <span className={`text-[9px] font-mono font-bold ${overdue ? 'text-rose-700' : nearDeadline ? 'text-teal-700' : 'text-gray-500'}`}>
              {formatCountdown(remainMs)}
            </span>
          )}
        </div>
        <div className="text-[11px] font-bold text-gray-800 truncate">{task.unitName}</div>
        {task.description && (
          <div className="text-[10px] text-gray-600 line-clamp-2 leading-tight">{task.description}</div>
        )}
        {task.status === 'COMPLETED' && <div className="text-[10px] text-emerald-700 mt-1">✓ Đã hoàn thành</div>}
        {task.status === 'CANCELLED' && <div className="text-[10px] text-gray-600 mt-1">✕ Đã hủy</div>}
      </div>

      {showActions && task.status === 'PENDING' && anchorRect && (
        <ActionPopup
          task={task}
          anchorRect={anchorRect}
          onClose={() => { setShowActions(false); setAnchorRect(null) }}
          onAction={(type) => { setShowActions(false); setAnchorRect(null); onAction(type, task) }}
          onEdit={() => { setShowActions(false); setAnchorRect(null); onEdit(task) }}
          onDelete={() => { setShowActions(false); setAnchorRect(null); onDelete(task) }}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  ACTION POPUP — portal + measure-before-position
// ══════════════════════════════════════════════════════════════

function ActionPopup({ task, anchorRect, onClose, onAction, onEdit, onDelete }) {
  const popupRef = useRef(null)
  // Render invisible lần đầu → useLayoutEffect đo kích thước thật → set vị trí
  const [style, setStyle] = useState({ top: -9999, left: -9999, visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!popupRef.current || !anchorRect) return
    const rect = popupRef.current.getBoundingClientRect()
    const vh = window.innerHeight
    const vw = window.innerWidth
    const GAP = 6
    const popupH = rect.height
    const popupW = rect.width

    // Space thật SAU khi biết popupH: nếu dưới không đủ → flip lên trên
    const spaceBelow = vh - anchorRect.bottom
    const flipAbove = spaceBelow < popupH + GAP + 8

    const top = flipAbove
      ? Math.max(8, anchorRect.top - popupH - GAP)
      : Math.min(vh - popupH - 8, anchorRect.bottom + GAP)

    const anchorCx = (anchorRect.left + anchorRect.right) / 2
    let left = anchorCx - popupW / 2
    left = Math.max(8, Math.min(vw - popupW - 8, left))

    setStyle({ top, left, visibility: 'visible' })
  }, [anchorRect])

  // Đóng khi scroll (page, calendar internal) hoặc resize — anchorRect sẽ lệch
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div ref={popupRef}
        style={{ position: 'fixed', ...style, width: 260 }}
        className="z-[9999] bg-white rounded-xl shadow-2xl border border-gray-200 p-2 animate-popup-in">
        <div className="text-[10px] text-gray-500 font-semibold px-1 mb-1 truncate">{task.unitName}</div>
        <div className="grid grid-cols-3 gap-1 mb-1">
          <button onClick={() => onAction('complete')}
            className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition">
            <span className="text-lg">✓</span>
            <span className="text-[9px] font-bold">Hoàn thành</span>
          </button>
          <button onClick={() => onAction('extend')}
            className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition">
            <span className="text-lg">🕒</span>
            <span className="text-[9px] font-bold">Gia hạn</span>
          </button>
          <button onClick={() => onAction('cancel')}
            className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition">
            <span className="text-lg">✕</span>
            <span className="text-[9px] font-bold">Hủy</span>
          </button>
        </div>
        <div className="flex gap-1 border-t border-gray-100 pt-1">
          <button onClick={onEdit}
            className="flex-1 text-[10px] py-1 rounded hover:bg-gray-100 text-gray-600">✎ Sửa</button>
          <button onClick={onDelete}
            className="flex-1 text-[10px] py-1 rounded hover:bg-rose-50 text-rose-600">🗑 Xóa</button>
        </div>
      </div>
      <style>{`
        @keyframes popup-in {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }
        .animate-popup-in { animation: popup-in 0.14s cubic-bezier(0.16, 1, 0.3, 1); transform-origin: top center; }
      `}</style>
    </>,
    document.body
  )
}

// ══════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════

function range(from, to) { const a = []; for (let i = from; i < to; i++) a.push(i); return a }
function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
function isSameDay(a, b) { return dayStart(a) === dayStart(b) }

function formatCountdown(ms) {
  if (ms <= 0) return 'Quá hạn'
  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** 2+ task cách nhau <45p coi như chồng khung giờ → xếp sang lane khác. */
function layoutTasks(tasks) {
  const sorted = [...tasks].sort((a, b) => a.deadline - b.deadline)
  const OVERLAP_MS = 45 * 60 * 1000
  const lanes = []
  const out = []
  for (const t of sorted) {
    let laneIdx = -1
    for (let i = 0; i < lanes.length; i++) {
      const last = lanes[i]
      if (t.deadline - last.deadline >= OVERLAP_MS) { laneIdx = i; lanes[i] = t; break }
    }
    if (laneIdx < 0) { laneIdx = lanes.length; lanes.push(t) }
    out.push({ task: t, lane: laneIdx })
  }
  const laneTotal = lanes.length
  return out.map(o => ({ ...o, laneTotal }))
}