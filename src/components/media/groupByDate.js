/**
 * Gom tài nguyên thành các nhóm có tiêu đề ngày tháng, giống gallery iPhone.
 *
 * Độ chi tiết của nhãn thay đổi theo tuổi của file — càng cuộn xuống (file càng
 * cũ) thì nhãn càng gom rộng:
 *   • Hôm nay        → theo GIỜ      "Hôm nay 14:00"
 *   • Trong 7 ngày   → theo NGÀY     "Thứ ba, 29/07"
 *   • Trong năm nay  → theo THÁNG    "Tháng 7"
 *   • Cũ hơn         → theo NĂM      "2025"
 *
 * Nhờ vậy phần đầu danh sách chi tiết tới từng giờ, còn phần cũ không bị vỡ vụn
 * thành hàng trăm nhóm một ảnh.
 */

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']

const pad = n => String(n).padStart(2, '0')

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Khoá nhóm + nhãn hiển thị cho một mốc thời gian */
export function groupOf(timestamp, now = Date.now()) {
  const d = new Date(timestamp)
  const today = startOfDay(now)
  const thatDay = startOfDay(d)
  const daysAgo = Math.round((today - thatDay) / DAY)

  // Hôm nay → theo giờ
  if (daysAgo === 0) {
    return {
      key: `h-${thatDay.getTime()}-${d.getHours()}`,
      label: `Hôm nay ${pad(d.getHours())}:00`,
    }
  }

  // Hôm qua → nhãn riêng cho dễ nhận
  if (daysAgo === 1) {
    return { key: `d-${thatDay.getTime()}`, label: 'Hôm qua' }
  }

  // Trong tuần → theo ngày
  if (daysAgo < 7) {
    return {
      key: `d-${thatDay.getTime()}`,
      label: `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
    }
  }

  // Trong năm nay → theo tháng
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return {
      key: `m-${d.getFullYear()}-${d.getMonth()}`,
      label: `Tháng ${d.getMonth() + 1}`,
    }
  }

  // Cũ hơn → theo năm
  return { key: `y-${d.getFullYear()}`, label: String(d.getFullYear()) }
}

/**
 * Gom theo ĐỘ CHI TIẾT cố định do người dùng chọn (nút Năm/Tháng/Ngày ở dưới).
 *   • 'year'  → "2026"
 *   • 'month' → "Tháng 7/2026"
 *   • 'day'   → "Thứ ba, 29/07/2026"
 */
function groupByGranularity(timestamp, gran) {
  const d = new Date(timestamp)
  if (gran === 'year') {
    return { key: `y-${d.getFullYear()}`, label: String(d.getFullYear()) }
  }
  if (gran === 'day') {
    return {
      key: `d-${startOfDay(d).getTime()}`,
      label: `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    }
  }
  // month (mặc định)
  return {
    key: `m-${d.getFullYear()}-${d.getMonth()}`,
    label: `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`,
  }
}

/**
 * @param items danh sách đã sắp xếp
 * @param granularity 'year' | 'month' | 'day' | 'auto'
 * @returns [{ key, label, items: [...] }]
 */
export function groupByDate(items, now = Date.now(), granularity = 'auto') {
  const groups = []
  let current = null

  for (const item of items) {
    const g = granularity === 'auto'
      ? groupOf(item.createdAt, now)
      : groupByGranularity(item.createdAt, granularity)
    if (!current || current.key !== g.key) {
      current = { key: g.key, label: g.label, items: [] }
      groups.push(current)
    }
    current.items.push(item)
  }
  return groups
}

/** Định dạng đầy đủ cho phần chi tiết: 14:32 · 02/08/2026 */
export function fmtFullTime(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return `${pad(d.getHours())}:${pad(d.getMinutes())} · ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
