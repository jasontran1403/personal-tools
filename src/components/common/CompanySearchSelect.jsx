import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * CompanySearchSelect — combobox typeahead cho công ty, dùng chung cho:
 *   - Form booking (BookingFormModal)
 *   - Form hành khách (PassengerFormModal)
 *   - Bộ lọc Thông tin khách (PassengersTab)
 *
 * ── 2026-10-08 refactor ─────────────────────────────────────
 * Trước đây logic này nằm chôn trong BookingFormModal. Nay tách ra common để
 * tất cả nơi chọn công ty đều có input search (yêu cầu: thay `<select>` thuần
 * ở bộ lọc Thông tin khách).
 *
 * Props:
 *   value       — id công ty (number | null), null = "— Khách lẻ —"
 *   options     — mảng { id, label, isBranch? } đã flatten từ company tree
 *   onChange    — (id | null) => void
 *   placeholder — chữ hiện khi chưa chọn gì
 *   allowNone   — có cho chọn "— Khách lẻ / Tất cả —" không. Default: true.
 *   noneLabel   — nhãn cho option none, default "— Khách lẻ —"
 *   size        — 'sm' | 'md'
 *   className   — thêm class vào wrapper
 */
export default function CompanySearchSelect({
  value,
  options,
  onChange,
  placeholder = '— Khách lẻ —',
  allowNone = true,
  noneLabel = '— Khách lẻ —',
  size = 'md',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [query, options])

  useEffect(() => { setActiveIdx(0) }, [open, query])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  const selected = useMemo(
    () => options.find(o => String(o.id) === String(value)) || null,
    [options, value]
  )

  const pick = (opt) => {
    onChange(opt ? opt.id : null)
    setOpen(false)
    setQuery('')
  }

  // Index 0 = none (nếu allowNone), các option khác bắt đầu từ index 1
  const noneOffset = allowNone ? 1 : 0
  const totalCount = noneOffset + filtered.length

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(totalCount - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (allowNone && activeIdx === 0) pick(null)
      else pick(filtered[activeIdx - noneOffset])
    }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQuery('') }
  }

  const btnPad = size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button type="button"
        onClick={() => setOpen(o => !o)}
        className={`${btnPad} w-full inline-flex items-center justify-between gap-2 rounded-lg
          border border-gray-300 bg-white text-left transition
          hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none`}
        aria-haspopup="listbox" aria-expanded={open}>
        <span className={`truncate ${selected ? 'text-gray-900' : 'text-gray-400 italic'}`}>
          {selected ? selected.label.replace(/^\s+↳\s/, '↳ ') : placeholder}
        </span>
        <span className="text-gray-400 text-xs shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg bg-white shadow-lg border border-gray-200 overflow-hidden">
          <div className="p-1.5 border-b border-gray-100 bg-gray-50">
            <input ref={inputRef}
              type="text" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Tìm công ty…"
              className="w-full px-2 py-1.5 rounded-md border border-gray-200 bg-white text-sm
                focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none" />
          </div>

          <div ref={listRef} className="max-h-56 overflow-y-auto py-0.5">
            {allowNone && (
              <OptionRow
                idx={0} activeIdx={activeIdx} setActiveIdx={setActiveIdx}
                onPick={() => pick(null)}
                isSelected={value == null || value === ''}
                label={noneLabel} italic
              />
            )}

            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 italic text-center">
                Không tìm thấy công ty phù hợp
              </div>
            ) : filtered.map((o, i) => (
              <OptionRow
                key={o.id}
                idx={i + noneOffset} activeIdx={activeIdx} setActiveIdx={setActiveIdx}
                onPick={() => pick(o)}
                isSelected={String(o.id) === String(value)}
                label={o.label}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OptionRow({ idx, activeIdx, setActiveIdx, onPick, isSelected, label, italic }) {
  const isActive = idx === activeIdx
  return (
    <button type="button"
      data-idx={idx}
      onMouseEnter={() => setActiveIdx(idx)}
      onClick={onPick}
      className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition
        ${isActive ? 'bg-blue-50 text-blue-900' : 'text-gray-800 hover:bg-gray-50'}
        ${italic ? 'italic text-gray-500' : ''}`}>
      <span className="flex-1 truncate whitespace-pre">{label}</span>
      {isSelected && <span className="text-blue-600 text-xs">✓</span>}
    </button>
  )
}

/**
 * Flatten company tree (có parent/branch) thành list phẳng với branch được
 * indent "  ↳ ". Dùng cho options của CompanySearchSelect.
 */
export function companyOptions(companies) {
  const roots = companies.filter(c => !c.parentId).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const byParent = new Map()
  for (const c of companies) {
    if (c.parentId) {
      if (!byParent.has(c.parentId)) byParent.set(c.parentId, [])
      byParent.get(c.parentId).push(c)
    }
  }
  const out = []
  for (const r of roots) {
    out.push({ id: r.id, label: r.name, isBranch: false })
    const branches = (byParent.get(r.id) || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    for (const b of branches) {
      out.push({ id: b.id, label: `  ↳ ${b.name}`, isBranch: true })
    }
  }
  return out
}
