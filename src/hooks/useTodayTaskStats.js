import { useEffect, useState, useCallback } from 'react'
import { listTodo } from '../services/todoApi'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Stats task trong 7 ngày (today + 6 next days) — poll BE 30s, tick 1s.
 *
 * ── 2026-09-20 rework theo yêu cầu ──────────────────────
 * Trước: gọi `/stats/today` → chỉ đếm task trong NGÀY hôm nay.
 * Nay: gọi `listTodo(today, today+7d)` để lấy toàn bộ, rồi compute client-side:
 *   - pendingCount     : SỐ TASK PENDING (bao gồm cả quá hạn) trong 7 ngày.
 *                        VD: 4 task PENDING, trong đó 2 đã quá hạn → count = 4.
 *   - nearestDeadline  : deadline gần nhất của task PENDING chưa quá hạn.
 *                        Task quá hạn KHÔNG tính vào cái này.
 *                        VD: có 1 task 21h31m nữa và 1 task 2d 23h nữa → 21h31m.
 *   - countdownLabel   : format countdown → "21h31m" / "2d 23h" / "45m" / "30s".
 *
 * Tên hàm giữ nguyên useTodayTaskStats để không phải sửa import ở VmbPage
 * (tên hơi lệch nhưng nội hàm rộng ra thôi, không phá contract).
 */
export default function useTodayTaskStats() {
  const [tasks, setTasks] = useState([])
  const [tick, setTick] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const today = new Date()
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
      const end = start + 7 * DAY_MS
      const res = await listTodo(start, end)
      if (!res.data?.error) setTasks(res.data?.data || [])
    } catch { /* silent — không quấy rối user với error toast ở tab bar */ }
  }, [])

  useEffect(() => {
    refresh()
    const poll = setInterval(refresh, 30000)
    const tickId = setInterval(() => setTick(t => t + 1), 1000)
    return () => { clearInterval(poll); clearInterval(tickId) }
  }, [refresh])

  // ── Compute ──
  // ── 2026-09-20 fix ────────────────────────────────────
  // Yêu cầu: chỉ đếm task ĐANG LÀM. Task hoàn thành / hủy / quá hạn KHÔNG
  // tính vào pendingCount. "Đang làm" = status PENDING + deadline chưa qua.
  const now = Date.now()
  const activeTasks = tasks.filter(t => t.status === 'PENDING' && t.deadline > now)
  const pendingCount = activeTasks.length

  // nearestDeadline lấy từ activeTasks (đã lọc future rồi)
  const nearestDeadline = activeTasks.length > 0
    ? Math.min(...activeTasks.map(t => t.deadline))
    : null

  void tick // trigger re-render mỗi giây → countdown update
  const countdownLabel = nearestDeadline
    ? formatCountdown(nearestDeadline - Date.now())
    : null

  return { pendingCount, nearestDeadline, countdownLabel, refresh }
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Quá hạn'
  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}