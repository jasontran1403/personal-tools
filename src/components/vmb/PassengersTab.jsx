import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ConfirmModal from '../common/ConfirmModal'
import PassengerFormModal from './PassengerFormModal'
import CopyPassengerModal from './CopyPassengerModal'
import MembershipCardsModal from './MembershipCardsModal'
import CompaniesModal from './CompaniesModal'
import IdPresentationModal from './IdPresentationModal'
import CompanySearchSelect, { companyOptions, isWalkInCompany } from '../common/CompanySearchSelect'
import { listPassengers, listCompanies, deletePassenger, getPassenger } from '../../services/vmbApi'
import { expiryStatus, monthsUntil, formatDateVn } from '../../lib/expiry'

/**
 * Tab Thông tin khách.
 *
 * ── 2026-09-15 ──────────────────────────────────────────────
 * Chuyển sang data model mới:
 *   - passenger.documents (list) thay cho các cột phẳng cccdNo/passportNo/...
 *   - passenger.nearestExpiry (BE tính sẵn) thay cho passenger.expiryDate
 *     — dùng cho màu dòng cảnh báo hạn.
 */
export default function PassengersTab() {
  const [rows, setRows]           = useState([])
  // 2026-11-11: BE xếp danh sách theo tên công ty A→Z rồi tên khách, nên khách
  //   lẻ (bắt đầu bằng K) không nằm ở trang đầu. Fetch RIÊNG khách lẻ để luôn
  //   hiện nhóm này ngay khi mở tab, không phụ thuộc vị trí trong infinite
  //   scroll. Khi vé đã lọc theo công ty hoặc có từ khóa tìm → bỏ qua.
  const [walkInRows, setWalkInRows] = useState([])
  const [companies, setCompanies] = useState([])
  const [loading, setLoading]     = useState(true)       // lần tải đầu
  const [loadingMore, setLoadingMore] = useState(false)  // lần tải nối tiếp

  const [q, setQ]                 = useState('')
  const [companyId, setCompanyId] = useState('')
  // 2026-11-11: phân trang cuộn (infinite scroll) thay cho nút trước/sau.
  //   rows nối dồn qua các lần fetch; nextPage là trang kế để fetch; hasMore
  //   = còn trang nữa.
  const [nextPage, setNextPage]   = useState(0)
  const [hasMore, setHasMore]     = useState(true)
  const [total, setTotal]         = useState(0)

  // 2026-11-11: Mặc định MỌI công ty đều thu gọn; set này giữ các công ty mà
  //   user đã bấm mở. Khi đang tìm kiếm thì mở hết, nếu không kết quả bị giấu.
  const [expandedCompanies, setExpandedCompanies] = useState(new Set())

  const [form, setForm]           = useState(null)
  const [cardsFor, setCardsFor]   = useState(null)
  const [presenting, setPresenting] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  // 2026-11-11: khách đang được copy sang công ty khác
  const [copyFor, setCopyFor]     = useState(null)
  const [showCompanies, setShowCompanies] = useState(false)

  const loadCompanies = useCallback(async () => {
    try {
      const res = await listCompanies()
      setCompanies(res.data?.data || [])
    } catch (e) {
      toast.error('Không tải được danh sách công ty')
    }
  }, [])

  // 2026-11-11: Mỗi lần đổi ô tìm kiếm / chọn công ty, reset về trang 0 và
  //   bỏ sạch rows. Thao tác cuộn gần hết sẽ bơm thêm trang kế qua loadMore.
  const fetchingRef = useRef(false)
  const loadPage = useCallback(async (pageIdx, replace) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    if (replace) setLoading(true)
    else setLoadingMore(true)
    try {
      // Reset: song song fetch trang 0 + khách lẻ (nếu đang xem "tất cả").
      //   Không lọc công ty / không tìm kiếm → cần ghim nhóm khách lẻ lên đầu.
      const mainP = listPassengers({
        q: q || undefined,
        companyId: companyId || undefined,
        page: pageIdx, size: 100,
      })
      const walkInP = (replace && !q && !companyId)
        ? listPassengers({ walkInOnly: true, size: 100 })
        : null
      const res = await mainP
      if (walkInP) {
        try {
          const wr = await walkInP
          setWalkInRows(wr.data?.data?.content || [])
        } catch { setWalkInRows([]) }
      } else if (replace) {
        // lọc hoặc tìm kiếm → bỏ nhóm khách lẻ ghim.
        setWalkInRows([])
      }
      const d = res.data?.data
      const chunk = d?.content || []
      setRows(prev => replace ? chunk : [...prev, ...chunk])
      const totalPages = d?.totalPages || 1
      setHasMore(pageIdx + 1 < totalPages)
      setNextPage(pageIdx + 1)
      setTotal(d?.totalElements || 0)
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải được danh sách khách')
    } finally {
      if (replace) setLoading(false)
      else setLoadingMore(false)
      fetchingRef.current = false
    }
  }, [q, companyId])

  // Khi q hoặc companyId đổi → reload từ đầu.
  useEffect(() => { loadPage(0, true) }, [loadPage])

  // Alias cũ: reload lại từ đầu sau khi tạo/sửa/xóa khách.
  const load = useCallback(() => loadPage(0, true), [loadPage])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  const qTimer = useRef(null)
  const onSearch = (v) => {
    if (qTimer.current) clearTimeout(qTimer.current)
    qTimer.current = setTimeout(() => setQ(v), 300)
  }

  // ── Infinite scroll: khi cuộn xuống gần cuối thì tự fetch trang tiếp theo ──
  const scrollerRef = useRef(null)
  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el || loadingMore || !hasMore) return
    // Còn ít hơn 400px đến đáy → bơm tiếp.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
      loadPage(nextPage, false)
    }
  }, [loadPage, nextPage, hasMore, loadingMore])

  const flatCompanies = useMemo(() => companyOptions(companies || []), [companies])

  // 2026-11-11: Khách lẻ LUÔN đứng đầu; các công ty khác giữ nguyên thứ tự
  //   đến từ BE (tên công ty A→Z). Khi fetch thêm trang tiếp thì gộp vào
  //   đúng nhóm, không xé rời theo trang nữa.
  const groups = useMemo(() => {
    if (companyId) return null
    const walkInIds = new Set((companies || []).filter(isWalkInCompany).map(c => c.id))
    // Dedupe: khách lẻ có thể vừa nằm trong rows (khi cuộn tới đoạn id khách lẻ)
    //   vừa trong walkInRows ghim đầu → ưu tiên bản ở rows, loại bớt khỏi
    //   walkInRows.
    const seen = new Set(rows.map(p => p.id))
    const extraWalkIn = walkInRows.filter(p => !seen.has(p.id))
    const merged = [...extraWalkIn, ...rows]
    const map = new Map()
    let walkInKey = null
    for (const p of merged) {
      const key = p.companyId || 'none'
      if (!map.has(key)) map.set(key, { companyName: p.companyName || '—', companyId: p.companyId, items: [] })
      map.get(key).items.push(p)
      if (walkInIds.has(p.companyId) || p.companyId === 1) walkInKey = key
    }
    const list = Array.from(map.entries())
    if (walkInKey != null) {
      const idx = list.findIndex(([k]) => k === walkInKey)
      if (idx > 0) {
        const [item] = list.splice(idx, 1)
        list.unshift(item)
      }
    }
    return list.map(([, v]) => ({ ...v, isWalkIn: walkInIds.has(v.companyId) || v.companyId === 1 }))
  }, [rows, walkInRows, companyId, companies])

  const toggleCompany = (id) => {
    setExpandedCompanies(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const expandAll  = () => setExpandedCompanies(new Set((groups || []).map(g => g.companyId || 'none')))
  const collapseAll = () => setExpandedCompanies(new Set())

  return (
    // 2026-10-10: Layout flex column — toolbar fixed, danh sách khách cuộn.
    <div className="w-full h-full flex flex-col">
      <div className="shrink-0 flex flex-col sm:flex-row gap-2 mb-3">
        <input
          defaultValue={q}
          onChange={e => onSearch(e.target.value)}
          placeholder="Tìm theo tên, số CCCD, hộ chiếu…"
          className="flex-1 min-w-0 px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-sm
            focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
        />
        <div className="min-w-[240px] sm:w-72">
          <CompanySearchSelect
            value={companyId ? Number(companyId) : null}
            options={flatCompanies}
            onChange={(id) => setCompanyId(id == null ? '' : String(id))}
            placeholder="— Tất cả công ty —"
            noneLabel="— Tất cả công ty —"
            allowNone={true}
          />
        </div>
        <button type="button" onClick={() => setShowCompanies(true)}
          className="px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-700
            hover:bg-gray-50 shrink-0 font-medium">
          🏢 Công ty
        </button>
        {groups && groups.length > 0 && (
          <button type="button"
            onClick={expandedCompanies.size ? collapseAll : expandAll}
            className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700
              hover:bg-gray-50 shrink-0 font-medium">
            {expandedCompanies.size ? '▲ Thu gọn hết' : '▼ Mở hết'}
          </button>
        )}
        <button type="button" onClick={() => setForm({ mode: 'create' })}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white
            text-sm font-semibold shadow-md shadow-blue-500/20 hover:from-blue-700 hover:to-indigo-700 shrink-0">
          + Thêm khách
        </button>
      </div>

      {/* 2026-10-10: Wrapper flex-1 overflow-auto để chỉ danh sách khách cuộn.
          2026-11-11: gắn ref + onScroll cho infinite scroll. */}
      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-auto">
      {loading ? (
        <div className="bg-white rounded-2xl shadow border border-gray-100 py-16 text-center text-gray-400 text-sm">
          Đang tải…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow border border-gray-100 py-16 text-center text-gray-400 text-sm">
          {q || companyId ? 'Không tìm thấy khách phù hợp' : 'Chưa có hành khách nào. Bấm "Thêm khách" để tạo.'}
        </div>
      ) : groups ? (
        <div className="space-y-3">
          {groups.map(g => {
            const collapsed = !(expandedCompanies.has(g.companyId || 'none') || !!q.trim())
            return (
              <div key={g.companyId || 'none'}
                className={`rounded-2xl shadow overflow-hidden border ${
                  g.isWalkIn
                    ? 'bg-blue-50 border-blue-200'    // 2026-11-11: nhóm Khách lẻ nền xanh nhạt
                    : 'bg-white border-gray-100'
                }`}>
                <button type="button" onClick={() => toggleCompany(g.companyId || 'none')}
                  className={`w-full flex items-center gap-2 px-4 py-3 text-left transition ${
                    g.isWalkIn
                      ? 'bg-gradient-to-r from-blue-100 to-sky-100 hover:from-blue-200 hover:to-sky-200'
                      : 'bg-gradient-to-r from-slate-50 to-blue-50 hover:from-slate-100 hover:to-blue-100'
                  }`}>
                  <span className="text-gray-500 text-sm">{collapsed ? '▶' : '▼'}</span>
                  {/* 2026-11-16: Nhóm Khách lẻ nền xanh → ép chữ màu tối bằng
                      arbitrary value để dark-theme không override thành chữ sáng. */}
                  <span className={`font-bold text-sm ${g.isWalkIn ? 'text-[#1e3a8a]' : 'text-gray-900'}`}>
                    {g.isWalkIn && '👤 '}{g.companyName}
                  </span>
                  {/* 2026-11-16: Badge tròn đều hơn (py-1 + leading-none + inline-flex). */}
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border leading-none whitespace-nowrap inline-flex items-center ${
                    g.isWalkIn
                      ? 'bg-white text-[#1d4ed8] border-blue-200'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}>
                    {g.items.length} khách
                  </span>
                </button>
                {!collapsed && (
                  <PassengerList
                    items={g.items}
                    onEdit={p => setForm({ mode: 'edit', passengerId: p.id })}
                    onCards={setCardsFor}
                    onCopy={setCopyFor}
                    onPresent={setPresenting}
                    onDelete={setConfirmDel}
                  />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
          <PassengerList
            items={rows}
            onEdit={p => setForm({ mode: 'edit', passengerId: p.id })}
            onCards={setCardsFor}
            onCopy={setCopyFor}
            onPresent={setPresenting}
            onDelete={setConfirmDel}
          />
        </div>
      )}

      {/* 2026-11-11: Thay nút trước/sau bằng chỉ báo cuối danh sách. */}
      <div className="py-4 text-center text-xs text-gray-400">
        {loadingMore
          ? 'Đang tải thêm…'
          : !hasMore && rows.length > 0
            ? `${total} khách`
            : null}
      </div>
      </div>{/* /flex-1 overflow-auto */}

      {form && (
        <PassengerFormModal
          mode={form.mode}
          passengerId={form.passengerId}
          companies={companies}
          onClose={() => setForm(null)}
          onSaved={async (res) => {
            setForm(null)
            loadCompanies()
            // 2026-11-12: SỬA khách → patch TẠI CHỖ đúng khách đó, KHÔNG reload
            //   cả danh sách (giữ nguyên vị trí cuộn, không nhảy lên đầu trang).
            if (res?.mode === 'edit' && res.id != null) {
              try {
                const r = await getPassenger(res.id)
                const fresh = r.data?.data
                if (fresh) {
                  const patch = (list) => list.map(p => (p.id === fresh.id ? { ...p, ...fresh } : p))
                  setRows(patch)
                  setWalkInRows(patch)
                  return
                }
              } catch { /* fetch lỗi → fallback reload bên dưới */ }
            }
            // Tạo mới / xoá / fetch lỗi → reload từ đầu như cũ.
            load()
          }}
        />
      )}

      {/* 2026-11-11: copy khách sang công ty khác */}
      {copyFor && (
        <CopyPassengerModal
          passenger={copyFor}
          companies={companies}
          onClose={() => setCopyFor(null)}
          onDone={() => { load(); loadCompanies() }}
        />
      )}
      {cardsFor && (
        <MembershipCardsModal
          passenger={cardsFor}
          onClose={() => setCardsFor(null)}
          onDirty={load}
        />
      )}

      {presenting && (
        <IdPresentationModal
          passenger={presenting}
          onClose={() => setPresenting(null)}
        />
      )}

      {showCompanies && (
        <CompaniesModal
          onClose={() => setShowCompanies(false)}
          onDirty={() => { loadCompanies(); load() }}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          open
          title="Xóa hành khách"
          message={`Xóa "${confirmDel.fullName}" và toàn bộ thẻ thành viên, file giấy tờ đính kèm?`}
          confirmLabel="Xóa"
          danger
          onConfirm={async () => {
            try {
              await deletePassenger(confirmDel.id)
              toast.success('Đã xóa')
              setConfirmDel(null)
              load()
            } catch (e) {
              toast.error(e?.response?.data?.message || 'Xóa thất bại')
            }
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════

function PassengerList({ items, onEdit, onCards, onCopy, onPresent, onDelete }) {
  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-[10px]">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Họ tên</th>
              <th className="text-right px-3 py-2 font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.map(p => {
              const cccd = findDoc(p, 'CCCD')
              const pp   = findDoc(p, 'PASSPORT')
              const st = expiryStatus(p.nearestExpiry)
              const rowCls =
                  st === 'expired' ? 'bg-rose-50 hover:bg-rose-100'
                : st === 'soon'    ? 'bg-amber-50 hover:bg-amber-100'
                : 'hover:bg-blue-50/40'
              return (
                <tr key={p.id} className={`${rowCls} border-b border-gray-100 transition-colors`}>
                  <td className="px-3 py-2">
                    {/* 2026-11-07: hiển thị in HOA cho đồng nhất với form (kể cả user
                        nhập chữ thường). Copy/edit vẫn giữ nguyên dữ liệu gốc. */}
                    <div className="font-semibold text-gray-900 uppercase">{p.fullName}</div>
                  </td>
                  {/* 2026-10-08: Cột "Thẻ thành viên" (chỉ có 1 nút Xuất trình) được
                      dời sang Thao tác dạng icon 💳 để gọn hàng, giảm số cột. */}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => onCards(p)}
                        title="Thẻ thành viên — Xuất trình"
                        className="w-7 h-7 rounded-md text-gray-600 hover:bg-blue-100 hover:text-blue-700 flex items-center justify-center">
                        💳
                      </button>
                      <button type="button" onClick={() => onPresent(p)}
                        title="Xuất trình giấy tờ (CCCD / Hộ chiếu)"
                        className="w-7 h-7 rounded-md text-gray-600 hover:bg-amber-100 hover:text-amber-700 flex items-center justify-center">
                        🪪
                      </button>
                      {/* 2026-11-11: copy khách sang công ty khác */}
                      <button type="button" onClick={() => onCopy(p)}
                        title="Copy khách sang công ty khác"
                        className="w-7 h-7 rounded-md text-gray-600 hover:bg-indigo-100 hover:text-indigo-700 flex items-center justify-center">
                        ⧉
                      </button>
                      <button type="button" onClick={() => onEdit(p)}
                        title="Sửa" className="w-7 h-7 rounded-md text-gray-600 hover:bg-gray-200 flex items-center justify-center">
                        ✎
                      </button>
                      <button type="button" onClick={() => onDelete(p)}
                        title="Xóa" className="w-7 h-7 rounded-md text-gray-600 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center">
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-gray-100">
        {items.map(p => {
          const cccd = findDoc(p, 'CCCD')
          const pp   = findDoc(p, 'PASSPORT')
          const st = expiryStatus(p.nearestExpiry)
          const bg =
              st === 'expired' ? 'bg-rose-50'
            : st === 'soon'    ? 'bg-amber-50'
            : 'bg-white'
          return (
            <div key={p.id} className={`p-3 ${bg}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  {/* 2026-11-07: hiển thị in HOA. */}
                  <div className="font-semibold text-gray-900 truncate uppercase">{p.fullName}</div>
                  <div className="text-[11px] text-gray-500">
                    {genderLabel(p.gender)}{p.dob && ` · ${formatDateVn(p.dob)}`}
                  </div>
                </div>
                <button onClick={() => onCards(p)}
                  className="text-xs px-2 py-1 rounded-md bg-gray-100 font-semibold text-gray-700 shrink-0">
                  {p.membershipCount || 0} thẻ
                </button>
              </div>
              {(cccd?.docNumber || pp?.docNumber) && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {cccd?.docNumber && (
                    <span className="px-2 py-0.5 rounded bg-gray-100 font-mono">
                      CCCD {cccd.docNumber} {cccd.fileUrl && '📎'}
                    </span>
                  )}
                  {pp?.docNumber && (
                    <span className="px-2 py-0.5 rounded bg-gray-100 font-mono">
                      PP {pp.docNumber} {pp.nationality && `[${pp.nationality}]`} {pp.fileUrl && '📎'}
                    </span>
                  )}
                </div>
              )}
              {p.nearestExpiry && (
                <div className="mt-2"><ExpiryLabel status={st} date={p.nearestExpiry} /></div>
              )}
              <div className="mt-2 flex gap-1">
                <button onClick={() => onPresent(p)}
                  title="Xuất trình giấy tờ"
                  className="h-8 px-2 rounded-md text-xs font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200">
                  🪪
                </button>
                <button onClick={() => onCopy(p)}
                  title="Copy khách sang công ty khác"
                  className="h-8 px-2 rounded-md text-xs font-semibold bg-indigo-100 text-indigo-700 hover:bg-indigo-200">
                  ⧉
                </button>
                <button onClick={() => onEdit(p)}
                  className="flex-1 h-8 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200">
                  ✎ Sửa
                </button>
                <button onClick={() => onDelete(p)}
                  className="flex-1 h-8 rounded-md text-xs font-semibold bg-rose-100 text-rose-700 hover:bg-rose-200">
                  🗑 Xóa
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function findDoc(p, type) {
  return (p?.documents || []).find(d => d.type === type) || null
}

function ExpiryLabel({ status, date }) {
  const months = monthsUntil(date)
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-600 text-white text-[11px] font-bold">
        ⚠ Hết hạn · {formatDateVn(date)}
      </span>
    )
  }
  if (status === 'soon') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500 text-white text-[11px] font-bold">
        ⚠ Còn {months} tháng · {formatDateVn(date)}
      </span>
    )
  }
  return <span className="text-xs tabular-nums text-gray-700">{formatDateVn(date)}</span>
}

function FileIcon() {
  return <span title="Có file đính kèm" className="text-[10px] text-blue-600">📎</span>
}

function genderLabel(g) {
  return { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' }[g] || '—'
}