import { useMemo } from 'react'
import { parseRoute, prettyRoute } from '../../lib/routeParse'
import { zoneOf, utcMsToLocalWall, localWallToUtcMs } from '../../lib/airportTz'
import DatePicker from '../common/DatePicker'
import TimePicker from '../common/TimePicker'

/**
 * Ô nhập hành trình + giờ khởi hành cho từng chặng.
 *
 * ── 2026-10-16: Hỗ trợ dấu "//" cho đa chặng không liên tục ─
 * User gõ "SGNHAN//HPHSGN" → 2 nhóm chặng độc lập, có divider trực quan giữa
 * các nhóm. Giờ bay chặng đầu của nhóm 2+ KHÔNG bị ràng buộc minDate theo
 * chặng cuối của nhóm trước (vì có thể là ngày trước đó, hoặc không liên quan).
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
          Hành trình (mã IATA liền nhau — dùng <code>//</code> cho đa chặng không liên tục)
        </label>
        <input
          type="text"
          value={routeStr}
          onChange={e => updateRoute(e.target.value.toUpperCase())}
          placeholder="VD: SGNHNDKMJHNDSGN  hoặc  SGNHAN//HPHSGN"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm
            font-mono uppercase focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
        />
        <div className="mt-1 flex items-center gap-2 text-xs">
          {parsed.valid ? (
            <span className="text-green-700 font-medium">✓ {prettyRoute(routeStr)}</span>
          ) : parsed.error && routeStr ? (
            <span className="text-rose-600">{parsed.error}</span>
          ) : (
            <span className="text-gray-400">
              Mỗi mã sân bay 3 chữ. VD: <code>SGNHAN//HPHSGN</code> = 2 chặng rời SGN→HAN và HPH→SGN.
            </span>
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

            // minDate luôn áp từ chặng ngay trước đó, kể cả khi là chặng
            // rời (nhóm mới). Chuyến bay chỉ có thể diễn ra tuần tự theo
            // thời gian — chặng sau phải SAU chặng trước.
            const prevSeg = parsed.segments[i - 1]
            const prevWall = prevSeg && segments[i - 1]?.departLocalMs
              ? utcMsToLocalWall(segments[i - 1].departLocalMs, prevSeg.from)
              : null
            const minDateStr = prevWall?.date || ''

            // Divider trước chặng đầu của nhóm mới (nhóm thứ 2 trở đi).
            const showDivider = seg.isGroupStart && seg.groupIdx > 0

            return (
              <div key={i}>
                {showDivider && (
                  <div className="flex items-center gap-2 my-1.5" aria-hidden>
                    <div className="flex-1 border-t border-dashed border-amber-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      Chặng rời — nhóm {seg.groupIdx + 1}
                    </span>
                    <div className="flex-1 border-t border-dashed border-amber-400" />
                  </div>
                )}
                <div
                  className={`grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr] gap-2 items-start
                    p-2 rounded-lg border border-gray-100 ${
                      seg.groupIdx > 0 ? 'bg-amber-50/40' : 'bg-gray-50'
                    }`}>
                  <div className="text-sm pt-2">
                    <span className="font-bold text-gray-900">{seg.from}</span>
                    <span className="text-gray-400 mx-1">→</span>
                    <span className="font-bold text-gray-900">{seg.to}</span>
                  </div>
                  <DatePicker
                    value={wall.date}
                    minDate={minDateStr}
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