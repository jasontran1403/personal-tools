import { useMemo } from 'react'
import { parseRoute, prettyRoute } from '../../lib/routeParse'
import { zoneOf, utcMsToLocalWall, localWallToUtcMs } from '../../lib/airportTz'
import DatePicker from '../common/DatePicker'
import TimePicker from '../common/TimePicker'

/**
 * Ô nhập hành trình + giờ khởi hành cho từng chặng.
 *
 * Người dùng gõ 1 chuỗi liền "SGNHNDKMJHNDSGN" → parse ra N chặng → render N
 * hàng, mỗi hàng có DatePicker + TimePicker. Giờ nhập là giờ ĐỊA PHƯƠNG của
 * sân bay khởi hành của chặng đó (caption ngay dưới: "Giờ Asia/Tokyo").
 *
 * ── Phase 2026-09-14 ────────────────────────────────────────
 * Chuyển từ native <input type="date/time"> sang DatePicker/TimePicker tự vẽ
 * cho đồng nhất phong cách + đỡ xấu trên các browser khác nhau.
 */
export default function RouteInput({ routeStr = '', segments = [], onChange }) {

  const parsed = useMemo(() => parseRoute(routeStr), [routeStr])

  const updateRoute = (nextStr) => {
    const p = parseRoute(nextStr)
    if (!p.valid) {
      onChange?.({ routeStr: nextStr, segments })
      return
    }
    const next = p.segments.map((s, i) => {
      const old = segments[i]
      const kept = old && old.fromCode === s.from && old.toCode === s.to
        ? old.departLocalMs : null
      return { fromCode: s.from, toCode: s.to, departLocalMs: kept, segOrder: i }
    })
    onChange?.({ routeStr: nextStr, segments: next })
  }

  const updateSegment = (i, patch) => {
    const next = segments.slice()
    next[i] = { ...next[i], ...patch, segOrder: i }
    onChange?.({ routeStr, segments: next })
  }

  return (
    <div className="space-y-3">
      {/* Ô nhập route */}
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">
          Hành trình (mã IATA liền nhau)
        </label>
        <input
          type="text"
          value={routeStr}
          onChange={e => updateRoute(e.target.value.toUpperCase())}
          placeholder="Ví dụ: SGNHNDKMJHNDSGN"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm
            font-mono uppercase focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
        />
        <div className="mt-1 flex items-center gap-2 text-xs">
          {parsed.valid ? (
            <span className="text-green-700 font-medium">✓ {prettyRoute(routeStr)}</span>
          ) : parsed.error && routeStr ? (
            <span className="text-rose-600">{parsed.error}</span>
          ) : (
            <span className="text-gray-400">Mỗi mã sân bay 3 chữ, viết liền nhau.</span>
          )}
        </div>
      </div>

      {/* Giờ khởi hành từng chặng */}
      {parsed.valid && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-600">
            Giờ khởi hành từng chặng (theo giờ SÂN BAY ĐI):
          </div>
          {parsed.segments.map((seg, i) => {
            const cur = segments[i]
            const zone = zoneOf(seg.from)
            const wall = utcMsToLocalWall(cur?.departLocalMs, seg.from)
            return (
              <div key={i}
                className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr] gap-2 items-start
                  p-2 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-sm pt-2">
                  <span className="font-bold text-gray-900">{seg.from}</span>
                  <span className="text-gray-400 mx-1">→</span>
                  <span className="font-bold text-gray-900">{seg.to}</span>
                </div>
                <DatePicker
                  value={wall.date}
                  size="sm"
                  onChange={(newDate) => {
                    const ms = localWallToUtcMs(newDate || todayStr(), wall.time || '00:00', seg.from)
                    updateSegment(i, { fromCode: seg.from, toCode: seg.to, departLocalMs: ms })
                  }}
                />
                <div>
                  <TimePicker
                    value={wall.time}
                    size="sm"
                    onChange={(newTime) => {
                      const ms = localWallToUtcMs(wall.date || todayStr(), newTime || '00:00', seg.from)
                      updateSegment(i, { fromCode: seg.from, toCode: seg.to, departLocalMs: ms })
                    }}
                  />
                  <div className="text-[10px] text-gray-400 mt-0.5 truncate">Giờ {zone}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
