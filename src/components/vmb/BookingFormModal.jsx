import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import RouteInput from './RouteInput'
import PriceInput from './PriceInput'
import { getBooking, createBooking, updateBooking, listCompanies, listFeeTypes, listBookings, getPassenger, getLatestRate } from '../../services/vmbApi'
import { parseAmount, formatMoney } from '../../lib/money'
import TicketFeesEditor from './TicketFeesEditor'
import CompanySearchSelect, { companyOptions } from '../common/CompanySearchSelect'
import PassengerSearchSelect from '../common/PassengerSearchSelect'
import PassengerIdPickerModal from './PassengerIdPickerModal'

/**
 * Form thêm/sửa BOOKING (kèm segments + N tickets).
 *
 * ── 2026-09-15 refactor ────────────────────────────────────
 * - Thêm cờ {@code sharedTicketFace}.
 * - Bỏ quản lý file mặt vé trong form này — chuyển sang {@code TicketFaceModal}.
 *
 * ── 2026-09-15 chiều ────────────────────────────────────────
 * - Cty là {@code CompanySearchSelect} (searchable dropdown thay vì {@code <select>}).
 * - Nút "+ Thêm vé" sao chép các field DÙNG CHUNG từ vé TRƯỚC ĐÓ.
 *
 * ── 2026-09-19 refactor ────────────────────────────────────
 * - BỎ trường serviceFee đơn. Thay bằng list {@code fees} chi tiết với 10
 *   loại phí. UI dùng {@link TicketFeesEditor}.
 * - "+ Thêm vé" KHÔNG copy fees (mỗi khách có phí phát sinh khác nhau).
 *
 * ── 2026-09-21 gross-tracking cho Giá gốc + Phí thu hộ ────
 * User workflow:
 *   1. Paste "tổng tiền vé từ vendor" (VD 4.124.362) vào Giá gốc.
 *   2. Paste liên tục các phí thu hộ (sumOnPaste) → cộng dồn.
 *   3. Giá gốc TỰ ĐỘNG = tổng - phí thu hộ, giữ invariant
 *      "gross = basePrice + collectionFee" constant.
 *   4. Xóa phí → giá gốc quay về gross ban đầu.
 *
 * Cách track: ticket có field ẨN {@code _originalTotal} (Number) = gross.
 * - {@link setBasePrice}: user commit basePrice → cập nhật _originalTotal =
 *   basePrice + collectionFee hiện tại (baseline mới).
 * - {@link setCollectionFee}: user commit collectionFee → nếu _originalTotal
 *   đã set → basePrice = _originalTotal - collectionFee mới.
 *
 * _originalTotal KHÔNG bao giờ được gửi lên BE (bị strip trong submit).
 */
// ── 2026-11-07: Autosave draft khi đang tạo mới ──────────────
//   LocalStorage key dùng chung cho mọi user trên máy này. Chỉ áp cho
//   mode === 'create': người dùng click ra ngoài / tắt modal / đổi tab
//   không bị mất data đã nhập. Mở lại → tự load draft.
const DRAFT_KEY = 'vmb.bookingForm.draft.v1'
const INITIAL_FORM = () => ({
  kind: 'NEW',
  airlineCode: '',
  bookingCode: '',
  routeStr: '',
  currency: 'VND',
  exchangeRate: '',
  note: '',
  referrerName: '',   // 2026-11-07: Người giới thiệu (khách lẻ)
  sharedTicketFace: false,
  segments: [],
  tickets: [newTicket()],
  linkedBookingCode: '',
  invoiceGroupId: null,
  isInvoiceGroupOwner: false,
  ownerBookingCode: null,
  linkedBookings: [],
  clearInvoiceGroup: false,
  // ── 2026-11-12 Link theo hành khách ──────────────────────────
  // IDs các vé trong booking này sẽ link sang chủ.
  linkedTicketIds: [],
})

/** True nếu form khác default (có data user đã nhập). Dùng để quyết định autosave. */
function isFormDirty(f) {
  if (!f) return false
  if (f.airlineCode || f.bookingCode || f.routeStr || f.note) return true
  if (f.linkedBookingCode) return true
  if (f.sharedTicketFace) return true
  if (f.currency && f.currency !== 'VND') return true
  if (f.exchangeRate) return true
  if ((f.segments || []).length > 0) return true
  const t = (f.tickets || [])[0]
  if (!t) return (f.tickets || []).length > 1
  if ((f.tickets || []).length > 1) return true
  if (t.passengerName || t.ticketNumber || t.basePrice || t.collectionFee ||
      t.issuanceFee || t.hnhFee || t.note || t.companyId != null ||
      (t.fees || []).length > 0) return true
  return false
}

export default function BookingFormModal({ mode = 'create', bookingId, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const [loading, setLoading] = useState(isEdit)
  const [busy, setBusy] = useState(false)
  const [companies, setCompanies] = useState([])
  const [feeTypes, setFeeTypes] = useState([])
  // ── 2026-11-07: flag đánh dấu đã khôi phục từ draft (để show badge nhẹ) ──
  const [restoredFromDraft, setRestoredFromDraft] = useState(false)

  useEffect(() => {
    listCompanies()
      .then(res => setCompanies(res.data?.data || []))
      .catch(() => { })
    listFeeTypes()
      .then(res => setFeeTypes(res.data?.data || []))
      .catch(() => { })
  }, [])

  // ── 2026-11-07: Init form — nếu create mode và có draft trong localStorage
  //   thì khôi phục. Edit mode luôn khởi tạo trống rồi load từ BE.
  const [form, setForm] = useState(() => {
    if (!isEdit && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            // Trả về draft, nhưng vẫn merge với default để chắc có đủ field
            return { ...INITIAL_FORM(), ...parsed }
          }
        }
      } catch (_) { /* ignore corrupt draft */ }
    }
    return INITIAL_FORM()
  })

  // ── 2026-11-07: Sau khi state đã khởi tạo, set flag nếu khôi phục được ──
  useEffect(() => {
    if (!isEdit && isFormDirty(form)) setRestoredFromDraft(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 2026-11-07: Autosave draft mỗi khi form đổi (create mode, không
  //   đang loading). Clear draft nếu form rỗng (user Reset).
  useEffect(() => {
    if (isEdit) return
    if (loading) return
    try {
      if (isFormDirty(form)) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
      } else {
        localStorage.removeItem(DRAFT_KEY)
      }
    } catch (_) { /* quota/etc → im lặng */ }
  }, [form, isEdit, loading])

  // Reset về INITIAL_FORM + clear draft.
  const resetForm = () => {
    setForm(INITIAL_FORM())
    setRestoredFromDraft(false)
    try { localStorage.removeItem(DRAFT_KEY) } catch (_) {}
  }

  useEffect(() => {
    if (!isEdit) return
    ;(async () => {
      try {
        const res = await getBooking(bookingId)
        const b = res.data?.data
        if (!b) throw new Error('Không tìm thấy')
        setForm({
          kind: b.kind || 'NEW',
          airlineCode: b.airlineCode || '',
          bookingCode: b.bookingCode || '',
          routeStr: b.routeStr || '',
          currency: b.currency || 'VND',
          exchangeRate: b.exchangeRate || '',
          note: b.note || '',
          referrerName: b.referrerName || '',
          sharedTicketFace: !!b.sharedTicketFace,
          linkedBookingCode: '',
          invoiceGroupId: b.invoiceGroupId || null,
          isInvoiceGroupOwner: !!b.isInvoiceGroupOwner,
          ownerBookingCode: b.ownerBookingCode || null,
          linkedBookings: b.linkedBookings || [],
          clearInvoiceGroup: false,
          // ── 2026-11-12 Link theo hành khách ──────────────────────
          //   t.linkedBookingId từ BE: vé nào đang link, chủ nào.
          //   Preselect các vé đã link sang chính chủ hiện tại (nếu có).
          linkedTicketIds: (b.tickets || [])
            .filter(t => t.linkedBookingId && t.linkedBookingId === b.invoiceGroupId
                         && !b.isInvoiceGroupOwner)
            .map(t => t.id),
          segments: (b.segments || []).map(s => ({
            fromCode: s.fromCode, toCode: s.toCode,
            departLocalMs: s.departLocalMs, segOrder: s.segOrder,
          })),
          tickets: (b.tickets || []).map(t => ({
            id: t.id,
            passengerName: t.passengerName || '',
            companyId: t.companyId || null,
            passengerId: t.passengerId || null,
            passengerDocumentType: t.passengerDocumentType || null,
            invoiceBuyer: !!t.invoiceBuyer,   // 2026-11-20: vé chọn làm bên mua HĐ
            // 2026-11-12: Link vé qua chủ
            linkedBookingId: t.linkedBookingId || null,
            linkedBookingCode: t.linkedBookingCode || null,
            // 2026-11-20 (mới): IDs các vé của BOOKING CHỦ mà vé này nằm cùng hoá đơn.
            //   Rỗng = link toàn bộ. Có giá trị = link theo nhóm cụ thể (tách HĐ).
            linkedTicketIds: Array.isArray(t.linkedTicketIds) ? [...t.linkedTicketIds] : [],
            ticketNumber: t.ticketNumber || '',
            basePrice: t.basePrice || '',
            collectionFee: t.collectionFee || '',
            issuanceFee: t.issuanceFee || '',
            hnhFee: t.hnhFee || '',
            commission: t.commission || '',               // 2026-11-16
            commissionAmount: t.commissionAmount || '',    // 2026-11-16
            costAmount: t.costAmount || '',                // 2026-11-17
            paidStatus: t.paidStatus || 'PENDING',
            note: t.note || '',
            fees: (t.fees || []).map(f => ({
              id: f.id,
              feeType: f.feeType,
              feeTypeLabel: f.feeTypeLabel,
              amount: f.amount || '',
              // 2026-10-12: Giữ currency riêng của mỗi dòng phí. BE trả null
              // khi là data cũ → fallback booking.currency ở TicketFeesEditor.
              currency: f.currency || b.currency || 'VND',
              note: f.note || '',
              // 2026-11-07: Số vé riêng của dịch vụ (optional) — round-trip.
              ticketNumber: f.ticketNumber || '',
              orderIdx: f.orderIdx ?? 0,
            })),
            // Load lên với _originalTotal = null → chưa track. User paste
            // basePrice mới thì mới bắt đầu track (baseline mới).
            _originalTotal: null,
          })),
        })
      } catch (e) {
        toast.error(e?.response?.data?.message || 'Không tải được booking')
        onClose()
      } finally {
        setLoading(false)
      }
    })()
    // KHÔNG đưa onClose vào deps: parent (TicketsTab) re-render mỗi giây do
    // VmbPage tick countdown → onClose là arrow inline nên đổi ref mỗi giây,
    // sẽ khiến effect này chạy lại và ghi đè state form (mất phần user đang gõ).
    // onClose ở đây chỉ dùng trong nhánh lỗi fallback → dùng ref hơi cũ vẫn OK.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, bookingId])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setTicket = (i, patch) => setForm(f => ({
    ...f, tickets: f.tickets.map((t, idx) => idx === i ? { ...t, ...patch } : t),
  }))
  // 2026-11-20: chọn 1 vé làm bên mua hóa đơn (radio — loại trừ nhau).
  const setInvoiceBuyer = (i) => setForm(f => ({
    ...f, tickets: f.tickets.map((t, idx) => ({ ...t, invoiceBuyer: idx === i })),
  }))

  // ── 2026-11-19: Tỷ giá ──────────────────────────────────────
  const fmtRate = (r) => String(r || '').replace(/[^0-9]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')

  // Đổi đồng tiền: chuyển sang USD mà chưa có tỷ giá → tự lấy tỷ giá USD mới nhất.
  const onCurrencyChange = async (v) => {
    setField('currency', v)
    if (v === 'USD') {
      setForm(f => {
        if (f.exchangeRate) return f
        getLatestRate('USD').then(res => {
          const rate = res.data?.data?.rate
          if (rate) setForm(ff => ff.exchangeRate ? ff : { ...ff, exchangeRate: fmtRate(rate) })
        }).catch(() => {})
        return f
      })
    }
  }

  // Ghi chú: gõ "/tygiaUSD" (hoặc /tygiacny…) → thay bằng tỷ giá hôm nay (đã format).
  const onNoteChange = (e) => {
    const v = e.target.value
    setField('note', v)
    const m = v.match(/\/tygia([a-zA-Z]{3})/)
    if (!m) return
    const cur = m[1].toUpperCase()
    getLatestRate(cur).then(res => {
      const rate = res.data?.data?.rate
      if (!rate) return
      const formatted = fmtRate(rate)
      setForm(f => {
        const mm = (f.note || '').match(/\/tygia([a-zA-Z]{3})/)
        return mm ? { ...f, note: f.note.replace(mm[0], formatted) } : f
      })
    }).catch(() => {})
  }

  // ── 2026-10-16: ID presentation picker ──
  // Khi user chọn 1 passenger qua PassengerSearchSelect → mở modal với mode
  // "picker". Lưu { ticketIdx, passenger } vào state. Confirm → cập nhật ticket.
  const [idPicker, setIdPicker] = useState(null)  // { ticketIdx, passenger } | null

  // ── 2026-11-20: Cache booking chủ theo mã (dùng khi link vé theo nhóm) ──
  //   key = bookingCode uppercase. Value: { loading, booking, error, ts }.
  //   Khi user nhập linkedBookingCode cho 1 vé → debounce 400ms → listBookings
  //   với q = code, lấy booking khớp chính xác bookingCode, cache lại.
  //   UI render checkbox các vé của booking chủ để user chọn nhóm hoá đơn.
  const [linkedBookingsCache, setLinkedBookingsCache] = useState({})
  // Danh sách các code đang được request để tránh gọi trùng.
  const pendingLookupsRef = useMemo(() => ({ current: new Set() }), [])

  // Lookup booking chủ theo mã — debounced bên trong useEffect.
  useEffect(() => {
    // Lấy danh sách unique code từ tất cả vé.
    const codes = new Set()
    for (const t of (form.tickets || [])) {
      const c = (t.linkedBookingCode || '').trim().toUpperCase()
      if (c) codes.add(c)
    }
    if (codes.size === 0) return
    const ownCode = (form.bookingCode || '').trim().toUpperCase()
    // Debounce 400ms.
    const h = setTimeout(async () => {
      for (const code of codes) {
        if (code === ownCode) continue       // không link với chính mình
        if (linkedBookingsCache[code]) continue  // đã có
        if (pendingLookupsRef.current.has(code)) continue
        pendingLookupsRef.current.add(code)
        setLinkedBookingsCache(prev => ({ ...prev, [code]: { loading: true } }))
        try {
          const res = await listBookings({ q: code, size: 20 })
          const content = res.data?.data?.content || []
          // Khớp chính xác bookingCode (listBookings dùng fuzzy search).
          const found = content.find(b => (b.bookingCode || '').toUpperCase() === code)
          if (found) {
            setLinkedBookingsCache(prev => ({ ...prev, [code]: { loading: false, booking: found } }))
          } else {
            setLinkedBookingsCache(prev => ({ ...prev, [code]: { loading: false, error: 'Không tìm thấy booking này' } }))
          }
        } catch (e) {
          setLinkedBookingsCache(prev => ({ ...prev, [code]: { loading: false, error: 'Lỗi tải booking chủ' } }))
        } finally {
          pendingLookupsRef.current.delete(code)
        }
      }
    }, 400)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.tickets.map(t => (t.linkedBookingCode || '').trim().toUpperCase()).join('|'), form.bookingCode])

  // earliestDepartMs: epoch chặng đi đầu tiên (dùng để check expiry 6 tháng)
  const earliestDepartMs = useMemo(() => {
    const ms = (form.segments || [])
      .map(s => s.departLocalMs)
      .filter(x => x != null && x > 0)
    return ms.length ? Math.min(...ms) : null
  }, [form.segments])

  // isInternational: có bất kỳ chặng nào tiếp xúc sân bay không phải VN
  const isInternational = useMemo(() => {
    const VN_AIRPORTS = new Set([
      'SGN','HAN','DAD','CXR','HPH','VII','UIH','HUI','PQC','VCA',
      'VCL','VCS','VKG','DIN','THD','TBB','VDH','BMV','DLI','VDO',
      'DAD','VVU','VKG',
    ])
    for (const s of form.segments || []) {
      if (s.fromCode && !VN_AIRPORTS.has(s.fromCode)) return true
      if (s.toCode && !VN_AIRPORTS.has(s.toCode)) return true
    }
    return false
  }, [form.segments])

  const openPickerForTicket = async (ticketIdx, passenger) => {
    try {
      // Fetch full passenger để lấy documents + URL ảnh
      const res = await getPassenger(passenger.id)
      const full = res.data?.data || passenger
      setIdPicker({ ticketIdx, passenger: full })
    } catch {
      setIdPicker({ ticketIdx, passenger })
    }
  }

  const confirmIdPick = ({ type, doc }) => {
    if (!idPicker) return
    const { ticketIdx, passenger } = idPicker
    setTicket(ticketIdx, {
      // 2026-11-08: Luôn viết HOA tên khách khi lưu / chọn.
      passengerName: (passenger.fullName || '').toUpperCase(),
      passengerId: passenger.id,
      passengerDocumentType: type,
      // Nếu passenger thuộc 1 company cụ thể và vé chưa có companyId → gán luôn
      companyId: form.tickets[ticketIdx].companyId ?? passenger.companyId ?? null,
    })
    setIdPicker(null)
  }

  const cancelIdPick = () => {
    if (!idPicker) return
    const { ticketIdx } = idPicker
    // Xóa khách khỏi ô input vé đã chọn
    setTicket(ticketIdx, {
      passengerName: '',
      passengerId: null,
      passengerDocumentType: null,
    })
    setIdPicker(null)
  }

  // ── 2026-09-21: Auto lookup mã booking cũ khi kind là EXCHANGE/REFUND/SERVICE ──
  // Chỉ áp dụng ở CREATE mode (không lookup khi sửa vé đã tồn tại).
  // Debounce 500ms để tránh gọi mỗi phím user gõ.
  // Nếu tìm được booking cùng mã → tự fill routeStr + segments + airlineCode
  //   NHƯNG chỉ khi các field đó còn TRỐNG (không đè lên input user đã sửa).
  // Toast báo cho user biết đã tự điền.
  const [lookedUpCode, setLookedUpCode] = useState('') // để không lookup lặp lại cùng mã

  useEffect(() => {
    if (isEdit) return
    if (form.kind === 'NEW') return
    const code = (form.bookingCode || '').trim()
    if (!code || code.length < 3) return
    if (code === lookedUpCode) return

    const timer = setTimeout(async () => {
      try {
        const res = await listBookings({ q: code, size: 10 })
        const found = (res.data?.data?.content || []).find(b => (b.bookingCode || '').toUpperCase() === code.toUpperCase())
        if (!found) return

        setLookedUpCode(code)

        // Fill route + segments nếu chưa có
        // Fill airlineCode + currency + exchangeRate nếu chưa có
        setForm(f => {
          const nextRouteStr = f.routeStr ? f.routeStr : (found.routeStr || '')
          const nextSegments = (f.segments && f.segments.length > 0)
            ? f.segments
            : (found.segments || []).map(s => ({
                fromCode: s.fromCode, toCode: s.toCode,
                departLocalMs: s.departLocalMs, segOrder: s.segOrder,
              }))
          const nextAirline = f.airlineCode ? f.airlineCode : (found.airlineCode || '')
          const nextCurrency = f.currency
          const nextRate = f.exchangeRate ? f.exchangeRate : (found.exchangeRate || '')
          return {
            ...f,
            routeStr: nextRouteStr,
            segments: nextSegments,
            airlineCode: nextAirline,
            currency: nextCurrency,
            exchangeRate: nextRate,
          }
        })

        const kindLabel = { EXCHANGE: 'đổi vé', REFUND: 'hoàn vé', SERVICE: 'dịch vụ' }[form.kind] || 'giao dịch'
        toast.success(
          `Tìm thấy booking cũ ${code}. Đã điền hành trình / hãng.` +
          (form.kind === 'EXCHANGE' ? ' Nhớ sửa giờ bay mới nếu có.' : ''),
          { duration: 4000 }
        )
      } catch { /* silent — user không cần biết lỗi API */ }
    }, 500)

    return () => clearTimeout(timer)
  }, [form.bookingCode, form.kind, isEdit, lookedUpCode])

  // Nếu user đổi kind về NEW hoặc clear code → reset lookup state
  useEffect(() => {
    if (form.kind === 'NEW' || !form.bookingCode) {
      setLookedUpCode('')
    }
  }, [form.kind, form.bookingCode])

  /**
   * Set basePrice + đồng thời reset gross baseline.
   * Sau mỗi lần user commit basePrice (paste hoặc blur):
   *   _originalTotal = basePrice + collectionFee (current)
   * → gross invariant reset về mốc mới. Fee thay đổi tiếp theo sẽ shift base.
   */
  const setBasePrice = (i, val) => setForm(f => ({
    ...f,
    tickets: f.tickets.map((t, idx) => {
      if (idx !== i) return t
      const newBaseNum = parseAmount(val)
      const currFeeNum = parseAmount(t.collectionFee)
      const gross = (Number.isFinite(newBaseNum) ? newBaseNum : 0)
                  + (Number.isFinite(currFeeNum) ? currFeeNum : 0)
      return { ...t, basePrice: val, _originalTotal: gross }
    }),
  }))

  /**
   * Set collectionFee + đồng thời recompute basePrice từ gross.
   *   Nếu _originalTotal chưa set → chỉ set collectionFee bình thường.
   *   Nếu set rồi → basePrice = _originalTotal - collectionFee (clamp ≥ 0).
   */
  const setCollectionFee = (i, val) => setForm(f => ({
    ...f,
    tickets: f.tickets.map((t, idx) => {
      if (idx !== i) return t
      const patched = { ...t, collectionFee: val }
      if (t._originalTotal != null) {
        const newFeeNum = parseAmount(val)
        const newBase = Math.max(0, t._originalTotal - (Number.isFinite(newFeeNum) ? newFeeNum : 0))
        patched.basePrice = formatMoney(newBase, f.currency, { withUnit: false })
      }
      return patched
    }),
  }))

  const MAX_TICKETS = 9

  const addTicket = () => setForm(f => {
    if (f.tickets.length >= MAX_TICKETS) {
      toast.error(`Mỗi booking tối đa ${MAX_TICKETS} vé`)
      return f
    }
    const first = f.tickets[0] || newTicket()
    return {
      ...f,
      tickets: [{
        ...newTicket(),
        companyId: first.companyId ?? null,
        // 2026-11-07: Copy basePrice = basePrice gốc + HNH fee (giá bán dành
        //   cho vé mới đã bao gồm phần HNH thu tay). HNH fee KHÔNG copy sang
        //   (vé mới chưa thu HNH).
        basePrice: addMoney(first.basePrice, first.hnhFee, f.currency),
        collectionFee: first.collectionFee || '',
        issuanceFee: first.issuanceFee || '',
        hnhFee: '',
        // Copy gross tracking từ vé đầu tiên — vé mới cũng ăn theo cùng gross.
        // Nếu user muốn khác, họ tự paste giá gốc mới → baseline reset.
        _originalTotal: first._originalTotal ?? null,
      }, ...f.tickets],
    }
  })

  const removeTicket = (i) => setForm(f => ({
    ...f,
    tickets: f.tickets.length <= 1 ? f.tickets : f.tickets.filter((_, idx) => idx !== i),
  }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.tickets[0]?.passengerName?.trim()) {
      return toast.error('Vé đầu tiên cần có tên khách hàng')
    }
    if (form.currency === 'USD' && !form.exchangeRate) {
      return toast.error('Vé USD cần nhập tỷ giá')
    }
    if (form.tickets.length > 9) {
      return toast.error('Mỗi booking tối đa 9 vé')
    }

    setBusy(true)
    try {
      // ── Strip _originalTotal (chỉ dùng ở client) trước khi gửi BE ──
      // ── Strip các field hiển thị thuần (BE tự tính lại) ──
      const {
        invoiceGroupId, linkedBookings, isInvoiceGroupOwner, ownerBookingCode,
        ...rest
      } = form
      const body = {
        ...rest,
        segments: (form.segments || []).map((s, i) => ({ ...s, segOrder: i })),
        tickets: form.tickets.map(t => {
          const { _originalTotal, ...cleanT } = t
          // 2026-11-08: Force HOA cho passengerName khi save (phòng trường hợp
          //   tên chèn vào trước đây đang lowercase ở DB).
          if (cleanT.passengerName) cleanT.passengerName = cleanT.passengerName.toUpperCase()
          // 2026-11-20: Chuẩn hoá linkedBookingCode + linkedTicketIds (per-ticket).
          //   - Không link → bỏ cả 2 field.
          //   - Có link nhưng chưa chọn vé cụ thể → gửi linkedTicketIds = [] (BE
          //     coi là link toàn bộ, backward compatible).
          if (cleanT.linkedBookingCode) {
            cleanT.linkedBookingCode = cleanT.linkedBookingCode.trim().toUpperCase()
            if (!Array.isArray(cleanT.linkedTicketIds)) cleanT.linkedTicketIds = []
          } else {
            delete cleanT.linkedBookingCode
            delete cleanT.linkedTicketIds
          }
          return cleanT
        }),
      }
      // linkedBookingCode: chỉ gửi khi user nhập mã mới (trim).
      if (body.linkedBookingCode) body.linkedBookingCode = body.linkedBookingCode.trim().toUpperCase()
      else delete body.linkedBookingCode
      // clearInvoiceGroup: chỉ gửi khi user tick bỏ link.
      if (!body.clearInvoiceGroup) delete body.clearInvoiceGroup
      // 2026-11-12: linkedTicketIds chỉ có ý nghĩa khi có linkedBookingCode.
      //   Rỗng + có code = link toàn bộ vé của booking (shortcut).
      if (!body.linkedBookingCode) delete body.linkedTicketIds
      if (isEdit) {
        await updateBooking(bookingId, body)
        toast.success('Đã cập nhật')
      } else {
        await createBooking(body)
        toast.success('Đã tạo booking')
        // ── 2026-11-07: Tạo thành công → xoá draft trong localStorage ──
        try { localStorage.removeItem(DRAFT_KEY) } catch (_) {}
      }
      onSaved()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Lưu thất bại')
    } finally {
      setBusy(false)
    }
  }

  const flatCompanies = useMemo(() => companyOptions(companies), [companies])

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={isEdit ? 'Sửa booking' : 'Thêm booking mới'}
      size="xl"
      closeOnBackdrop={!busy}
      footer={
        <div className="flex items-center gap-2">
          {/* ── 2026-11-07: badge báo đã khôi phục draft + nút Reset ── */}
          {!isEdit && restoredFromDraft && (
            <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">
              📝 Đã khôi phục bản nháp
            </span>
          )}
          <div className="flex-1" />
          {!isEdit && (
            <button type="button" onClick={() => {
              if (!isFormDirty(form)) return
              if (!window.confirm('Xoá hết dữ liệu đã nhập và bắt đầu lại?')) return
              resetForm()
            }} disabled={busy}
              title="Xoá toàn bộ data đã nhập, bắt đầu lại từ đầu"
              className="px-4 py-2 text-sm rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50 font-semibold">
              🔄 Reset
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
          <button type="submit" form="bf-form" disabled={busy || loading}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
                       hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : (isEdit ? 'Lưu thay đổi' : 'Tạo booking')}
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="py-10 text-center text-gray-400 text-sm">Đang tải…</div>
      ) : (
        <form id="bf-form" onSubmit={submit} className="space-y-4">
          <Section title="Thông tin chung">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Loại giao dịch" span={2}>
                <select value={form.kind} onChange={e => setField('kind', e.target.value)}
                  className="input">
                  <option value="NEW">Mua mới</option>
                  <option value="EXCHANGE">Đổi vé</option>
                  <option value="REFUND">Hoàn vé</option>
                  <option value="SERVICE">Dịch vụ</option>
                </select>
              </Field>
              <Field label="Hãng bay">
                {/* 2026-11-07: max 2 ký tự IATA (VJ, VN…). Ký tự thứ 3 bị chặn. */}
                <input type="text" value={form.airlineCode} maxLength={2}
                  onChange={e => setField('airlineCode',
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2))}
                  placeholder="VJ, VN" className="input font-mono uppercase" />
              </Field>
              <Field label="Mã booking">
                {/* 2026-11-07: max 6 ký tự PNR, viết hoa, chỉ A-Z/0-9. */}
                <input type="text" value={form.bookingCode} maxLength={6}
                  onChange={e => setField('bookingCode',
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  placeholder="ABC123" className="input font-mono uppercase" />
              </Field>
            </div>

            <div className="mt-3">
              <RouteInput
                routeStr={form.routeStr}
                segments={form.segments}
                onChange={({ routeStr, segments }) => setForm(f => ({ ...f, routeStr, segments }))}
              />
            </div>

            {/* 2026-11-07 (rev): Đồng tiền → toggle VND/USD; USD mới hiện tỷ giá */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <Field label="Đồng tiền">
                <CurrencyToggle value={form.currency}
                  onChange={onCurrencyChange} />
              </Field>
              {form.currency === 'USD' && (
                <Field label="Tỷ giá (1 USD = ? VND)" span={3}>
                  <PriceInput value={form.exchangeRate} currency="VND"
                    onChange={v => setField('exchangeRate', v)} />
                </Field>
              )}
            </div>

            <div className="mt-3 p-3 rounded-xl bg-amber-50/50 border border-amber-200">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form.sharedTicketFace}
                  onChange={e => setField('sharedTicketFace', e.target.checked)}
                  className="mt-1 rounded" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">
                    Mặt vé CHUNG cho cả booking
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    {form.sharedTicketFace
                      ? '✓ Cả booking dùng chung 1 file mặt vé (VD Vietjet, VNA nội địa).'
                      : 'Mỗi hành khách trong booking có mặt vé riêng (VD VNA quốc tế). Đây là mặc định.'}
                  </div>
                  {isEdit && (
                    <div className="text-[10px] text-amber-700 mt-1">
                      ⚠ Đổi cờ này khi sửa sẽ XÓA các file mặt vé thuộc scope cũ.
                      Upload lại sau khi lưu.
                    </div>
                  )}
                </div>
              </label>
            </div>

            {/* ── 2026-10-16: Gộp hóa đơn với booking khác (invoice group) ── */}
            {/* ── 2026-11-12 Link theo HÓA ĐƠN cụ thể ở booking chủ ── */}
            <InvoiceLinkSection
              form={form} setField={setField} setForm={setForm} isEdit={isEdit}
            />

            <Field label={<span>Ghi chú chung (booking) <span className="text-[10px] font-normal text-gray-500">— gõ <b>/tygiausd</b> để chèn tỷ giá USD hôm nay</span></span>}>
              <textarea rows={2} value={form.note}
                onChange={onNoteChange}
                className="input resize-none" placeholder="Ghi chú tùy chọn cho cả booking · /tygiausd" />
            </Field>

            {/* 2026-11-07: Người giới thiệu — chỉ cần cho booking khách lẻ,
                nhưng cứ hiển thị luôn vì nhẹ. Free text, VD: "Tiểu Hà (Zalo)
                thuộc Create Medic". */}
            <Field label="Người giới thiệu (khách lẻ)">
              <input type="text" value={form.referrerName}
                onChange={e => setField('referrerName', e.target.value)}
                className="input"
                placeholder='VD: "Tiểu Hà (Zalo) thuộc Create Medic" — bỏ trống nếu không có' />
            </Field>
          </Section>

          <Section title={`Vé (${form.tickets.length})`}
            action={<button type="button" onClick={addTicket}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800">
              + Thêm vé (copy từ vé cuối)
            </button>}
          >
            <div className="text-[11px] text-gray-500 mb-2">
              💡 Sau khi lưu, click mã booking / số vé ở bảng để tải mặt vé lên.
              Vé thêm mới tự copy công ty + các giá / phí từ vé cuối để nhập nhanh.
            </div>
            {form.tickets.length > 1 && (
              <div className="text-[11px] text-indigo-700 mb-2 bg-indigo-50 border border-indigo-200 rounded-md p-2">
                🧾 <b>Bên mua HĐ</b>: chọn 1 hành khách để lấy đúng thông tin người đó
                (tên + CCCD/Hộ chiếu) lên <b>hóa đơn khách lẻ</b>. Không chọn → hệ thống tự
                lấy người có giấy tờ. (Hóa đơn công ty không dùng mục này.)
              </div>
            )}
            <div className="text-[11px] text-blue-700 mb-2 bg-blue-50 border border-blue-200 rounded-md p-2">
              💰 <b>Mẹo nhập nhanh</b>: paste tổng tiền vé vào <b>Giá gốc</b> trước, sau đó paste
              các phí thu hộ (chuỗi kiểu <code>"79000AX"</code>, <code>"36362C4"</code>…) → hệ
              thống tự cộng dồn Phí thu hộ và giảm Giá gốc tương ứng. Xóa phí → Giá gốc quay lại.
            </div>
            <div className="space-y-3">
              {form.tickets.map((t, i) => {
                return (
                  <div key={i} className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="text-xs font-bold text-gray-700">Vé #{i + 1}</div>
                      <div className="flex items-center gap-3">
                        {form.tickets.length > 1 && (
                          <label className={`flex items-center gap-1 text-[11px] font-semibold cursor-pointer select-none
                            ${t.invoiceBuyer ? 'text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                            title="Lấy thông tin hành khách này lên hóa đơn (khách lẻ)">
                            <input type="radio" name="invoiceBuyer"
                              checked={!!t.invoiceBuyer}
                              onChange={() => setInvoiceBuyer(i)}
                              className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer" />
                            🧾 Bên mua HĐ
                          </label>
                        )}
                        {form.tickets.length > 1 && (
                          <button type="button" onClick={() => removeTicket(i)}
                            className="text-xs text-rose-600 hover:text-rose-800 font-semibold">
                            × Bỏ vé này
                          </button>
                        )}
                      </div>
                    </div>

                    <Field label="Công ty">
                      {/* 2026-11-19: Bỏ allowNone (mục "Khách lẻ" ảo) — công ty
                          "Khách lẻ" THẬT đã nằm trong options nên không còn trùng. */}
                      <CompanySearchSelect
                        value={t.companyId}
                        options={flatCompanies}
                        onChange={(id) => setTicket(i, { companyId: id })}
                        placeholder="— Khách lẻ —"
                        allowNone={false}
                      />
                    </Field>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                      <Field label={<>Tên khách hàng {t.passengerDocumentType && (
                        <span className="ml-1 text-[10px] font-bold text-indigo-700">
                          · {t.passengerDocumentType === 'CCCD' ? '🪪 CCCD' : '📘 HC'}
                        </span>
                      )}</>}>
                        {/* 2026-10-16: Dropdown search thay vì input thuần.
                            Lọc theo t.companyId. Chọn → mở IdPresentationModal. */}
                        <PassengerSearchSelect
                          value={t.passengerName}
                          companyId={t.companyId}
                          // 2026-11-19: KHÔNG format/UPPERCASE khi đang gõ — làm hỏng
                          //   bỏ dấu Telex (IME). Lưu raw; hiển thị HOA bằng CSS; chuẩn
                          //   hóa lúc blur + tự UPPERCASE khi submit (xem onBlurText + submit).
                          onChangeText={text => setTicket(i, {
                            passengerName: text,
                            // User gõ tay sửa name → clear link cũ
                            passengerId: null, passengerDocumentType: null,
                          })}
                          onBlurText={text => setTicket(i, { passengerName: formatPaxName(text) })}
                          onPick={(p) => {
                            if (!p) {
                              // Clear
                              setTicket(i, { passengerName: '', passengerId: null, passengerDocumentType: null })
                            } else {
                              openPickerForTicket(i, p)
                            }
                          }}
                        />
                      </Field>
                      <Field label="Số vé">
                        <input type="text" value={t.ticketNumber}
                          onChange={e => {
                            const raw = e.target.value || ''
                            const normalized = raw.replace(/[\s-]/g, '')
                            setTicket(i, { ticketNumber: normalized })
                          }}
                          className="input font-mono" placeholder="738-1234567890 (có thể để trống)" />
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                      <Field label="Giá gốc (chưa thu hộ)">
                        <PriceInput value={t.basePrice} currency={form.currency}
                          onChange={v => setBasePrice(i, v)} />
                      </Field>
                      <Field label="Phí thu hộ">
                        <PriceInput value={t.collectionFee} currency={form.currency}
                          onChange={v => setCollectionFee(i, v)}
                          sumOnPaste />
                      </Field>
                      <Field label="Phí xuất vé">
                        <PriceInput value={t.issuanceFee} currency={form.currency}
                          onChange={v => setTicket(i, { issuanceFee: v })} />
                      </Field>
                    </div>

                    {/* 2026-11-07: Phí xuất vé của HNH — luôn VND, optional.
                        Được cộng vào Giá bán (copy giá gốc = basePrice + hnhFee). */}
                    <div className="mt-2">
                      <Field label={
                        <span>Phí xuất vé của HNH <span className="text-[10px] text-gray-500 font-normal">(VND, tùy chọn — cộng vào giá bán)</span></span>
                      }>
                        <PriceInput value={t.hnhFee || ''} currency="VND"
                          onChange={v => setTicket(i, { hnhFee: v })} />
                      </Field>
                    </div>

                    {/* 2026-11-16: Hoa hồng (%) + Số tiền hoa hồng — user tự nhập. */}
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Field label={
                        <span>Hoa hồng (%) <span className="text-[10px] text-gray-500 font-normal">(0 - 100)</span></span>
                      }>
                        <CommissionPercentInput
                          value={t.commission || ''}
                          onChange={v => setTicket(i, { commission: v })}
                        />
                      </Field>
                      <Field label={
                        <span>Số tiền hoa hồng <span className="text-[10px] text-gray-500 font-normal">(VND, 1 - 999.999.999)</span></span>
                      }>
                        <CommissionAmountInput
                          value={t.commissionAmount || ''}
                          onChange={v => setTicket(i, { commissionAmount: v })}
                        />
                      </Field>
                    </div>

                    {/* 2026-11-17: Giá vốn (VND) — để trống = tự tính theo thành tiền. */}
                    <div className="mt-2">
                      <Field label={
                        <span>Giá vốn <span className="text-[10px] text-gray-500 font-normal">(VND — để trống = tự tính theo thành tiền, quy đổi nếu ngoại tệ)</span></span>
                      }>
                        <PriceInput value={t.costAmount || ''} currency="VND"
                          onChange={v => setTicket(i, { costAmount: v })} />
                      </Field>
                    </div>

                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-gray-600 mb-1">Các loại phí phát sinh</div>
                      <TicketFeesEditor
                        value={t.fees || []}
                        onChange={fees => setTicket(i, { fees })}
                        currency={form.currency}
                        feeTypes={feeTypes}
                      />
                    </div>

                    <Field label="Ghi chú vé">
                      <input type="text" value={t.note}
                        onChange={e => setTicket(i, { note: e.target.value })}
                        className="input" placeholder="Ghi chú tùy chọn" />
                    </Field>

                    {/* 2026-11-19: Link RIÊNG từng vé sang booking chủ (chủ xuất HĐ hộ).
                        Mỗi vé link độc lập → 1 booking n vé có thể link đi n booking khác.
                        2026-11-20: Thêm checkbox chọn vé CỤ THỂ của booking chủ để link
                        theo hoá đơn tách (nếu bỏ chọn hết = link TOÀN BỘ vé chủ như cũ). */}
                    <div className="mt-2">
                      <Field label={
                        <span>🔗 Link sang booking <span className="text-[10px] text-gray-500 font-normal">(mã booking chủ — để trống = không link; mỗi vé link riêng)</span></span>
                      }>
                        <input type="text"
                          value={t.linkedBookingCode || ''}
                          onChange={e => {
                            const code = e.target.value.toUpperCase().replace(/\s/g, '')
                            // Đổi code → clear target ticket IDs cũ (vì chúng thuộc booking cũ).
                            setTicket(i, { linkedBookingCode: code, linkedTicketIds: [] })
                          }}
                          className="input font-mono uppercase" placeholder="VD: QCZ5RR (để trống nếu không link)" />
                      </Field>
                      {(t.linkedBookingCode || '').trim() && (() => {
                        const code = (t.linkedBookingCode || '').trim().toUpperCase()
                        const cache = linkedBookingsCache[code]
                        return (
                          <>
                            <div className="mt-1 text-[11px] text-emerald-700 font-semibold">
                              ✓ Vé này sẽ được <span className="font-mono">{code}</span> xuất hóa đơn hộ
                            </div>
                            <LinkedTicketsPicker
                              code={code}
                              cache={cache}
                              selectedIds={t.linkedTicketIds || []}
                              onChange={(ids) => setTicket(i, { linkedTicketIds: ids })}
                            />
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          <style>{`
            .input {
              width: 100%;
              padding: 0.5rem 0.75rem;
              border-radius: 0.5rem;
              border: 1px solid #d1d5db;
              background: #fff;
              font-size: 0.875rem;
              outline: none;
              transition: border-color .15s, box-shadow .15s;
            }
            .input:focus {
              border-color: #3b82f6;
              box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
            }
          `}</style>
        </form>
      )}

      {/* 2026-10-16: Compact ID picker (modal nhỏ, không preview ảnh) */}
      {idPicker && (
        <PassengerIdPickerModal
          passenger={idPicker.passenger}
          isInternational={isInternational}
          earliestDepartMs={earliestDepartMs}
          onConfirm={confirmIdPick}
          onCancel={cancelIdPick}
        />
      )}
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * 2026-11-07: Cộng 2 chuỗi tiền theo VN format, trả về chuỗi đã format lại.
 * Dùng khi copy giá gốc = basePrice + hnhFee (HNH luôn VND) sang vé mới.
 * Nếu currency != VND thì bỏ qua HNH (không tự quy đổi ở FE).
 */
function addMoney(aStr, bStr, currency) {
  const a = parseAmount(aStr) || 0
  const b = parseAmount(bStr) || 0
  if (!b) return aStr || ''
  if (currency && currency !== 'VND') return aStr || ''
  const sum = a + b
  return formatMoney(sum, 'VND', { withUnit: false })
}

function newTicket() {
  return {
    passengerName: '', companyId: null, ticketNumber: '',
    basePrice: '', collectionFee: '', issuanceFee: '',
    hnhFee: '',    // 2026-11-07
    commission: '',        // 2026-11-16: % hoa hồng (0 < x < 100)
    commissionAmount: '',  // 2026-11-16: Số tiền hoa hồng (1 <= x < 999999999)
    costAmount: '',        // 2026-11-17: Giá vốn VNĐ (để trống = BE tự tính theo thành tiền)
    paidStatus: 'PENDING', note: '',
    fees: [],
    // 2026-10-16: Link tới Passenger khi chọn qua dropdown.
    passengerId: null,
    passengerDocumentType: null,
    // 2026-11-12: Link TOÀN BỘ hoặc 1 phần sang booking chủ.
    linkedBookingCode: '',
    // ── 2026-11-20 (mới) ─────────────────────────────────────
    //   Khi vé này link sang booking chủ (linkedBookingCode):
    //   - linkedTicketIds RỖNG → vé sẽ dùng chung hoá đơn với TOÀN BỘ vé chủ
    //     (hành vi cũ, backward compatible).
    //   - linkedTicketIds CÓ GIÁ TRỊ → chỉ dùng chung với các vé CỤ THỂ đã
    //     chọn trong booking chủ (link theo hóa đơn tách).
    linkedTicketIds: [],
    // Client-only: theo dõi "tổng tiền gốc từ vendor" để đồng bộ basePrice
    // với collectionFee. Bị strip trong submit.
    _originalTotal: null,
  }
}

/**
 * 2026-11-16: Input % hoa hồng — chỉ cho nhập số (và dấu thập phân), 0 < x < 100.
 * Khi blur ngoài khoảng, tự clamp về biên gần nhất.
 */
function CommissionPercentInput({ value, onChange }) {
  const handle = (e) => {
    // Chỉ cho nhập chữ số và dấu chấm/phẩy.
    const raw = e.target.value.replace(/[^\d.,]/g, '')
    onChange(raw)
  }
  const onBlur = () => {
    if (!value) return
    const n = parseFloat(String(value).replace(',', '.'))
    if (!Number.isFinite(n)) return onChange('')
    if (n <= 0)   return onChange('')
    if (n >= 100) return onChange('99.99')
    // Trong khoảng hợp lệ → giữ nguyên dạng user gõ.
  }
  return (
    <div className="relative">
      <input type="text" inputMode="decimal"
        value={value} onChange={handle} onBlur={onBlur}
        placeholder="VD: 5"
        className="input pr-7 font-mono" />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">%</span>
    </div>
  )
}

/**
 * 2026-11-16: Input số tiền hoa hồng — VND, 1 <= x < 999999999.
 * Auto-format VN (dấu chấm phân cách nghìn) khi blur.
 */
function CommissionAmountInput({ value, onChange }) {
  const handle = (e) => {
    onChange(e.target.value)
  }
  const onBlur = (e) => {
    if (!e.target.value) return
    const n = parseInt(String(e.target.value).replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(n)) return onChange('')
    if (n < 1) return onChange('1')
    if (n >= 999999999) return onChange(formatVNDInt(999999998))
    onChange(formatVNDInt(n))
  }
  return (
    <input type="text" inputMode="numeric"
      value={value} onChange={handle} onBlur={onBlur}
      placeholder="VD: 150.000"
      className="input font-mono" />
  )
}

function formatVNDInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function Section({ title, action, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function Field({ label, span, children }) {
  const spanClass = span === 2 ? 'sm:col-span-2' : span === 3 ? 'sm:col-span-3' : span === 4 ? 'sm:col-span-4' : ''
  return (
    <label className={`block ${spanClass}`}>
      <div className="text-[11px] font-semibold text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  )
}

/**
 * ── 2026-11-07 ────────────────────────────────────────────
 * Toggle 2 lựa chọn VND / USD. Thay <select> 2-option bằng 2 pill liền kề,
 * tap 1 phát là đổi. Height bằng chiều cao control chuẩn (h-10) để khớp với
 * các input xung quanh.
 */
function CurrencyToggle({ value, onChange }) {
  return (
    <div className="inline-flex h-10 w-full rounded-lg bg-gray-100 p-0.5 border border-gray-300">
      {['VND', 'USD'].map(cur => (
        <button key={cur} type="button" onClick={() => onChange(cur)}
          className={`flex-1 h-full rounded-md text-sm font-bold transition
            ${value === cur
              ? 'bg-white shadow text-blue-700'
              : 'text-gray-500 hover:text-gray-800'}`}>
          {cur}
        </button>
      ))}
    </div>
  )
}

// companyOptions đã được tách sang ../common/CompanySearchSelect (export cùng
// file với component), import ở trên.

/**
 * ── 2026-10-10 ─────────────────────────────────────────
 * Chuẩn hóa tên khách: đổi "/" thành khoảng trắng, gộp nhiều space thành 1,
 * trim 2 đầu. Dùng cho cả onChange (gõ) và onPaste (dán).
 * Ví dụ: "KUWABATA/YOSHIRO" → "KUWABATA YOSHIRO"
 *       "NGUYEN  VAN /  A" → "NGUYEN VAN A"
 */
function formatPaxName(raw) {
  if (!raw) return ''
  // 2026-11-07: hỗ trợ cả "/" và "," làm delimiter (và ";" bonus).
  //   "TRUONG/BA LAN"  → "TRUONG BA LAN"
  //   "TRUONG, BA LAN" → "TRUONG BA LAN"
  //   "TRUONG; BA LAN" → "TRUONG BA LAN"
  // 2026-11-08: Tự động viết HOA toàn bộ (giữ dấu tiếng Việt).
  return String(raw)
    .replace(/[/,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+/, '')
    .toUpperCase()
}
// ────────────────────────────────────────────────────────────────────
// ── 2026-11-12 Link = chọn HÀNH KHÁCH để chủ xuất hóa đơn hộ ────────
//
// Luồng (ở booking PHỤ, VD DZRAG7):
//   1) Nhập mã booking CHỦ (VD 5JW8XD).
//   2) Tick các hành khách (vé) của booking này muốn chủ xuất hóa đơn hộ.
//   3) Lưu → BE: ticket.linkedBookingId = chủ.id cho các vé đã tick.
//      Khi chủ upload hóa đơn, picker ở chủ sẽ thấy vé đã link; vé được
//      đưa vào hóa đơn thì booking phụ thấy hóa đơn đó qua cross-booking.
//   4) Không cần có hóa đơn ở phụ trước. Nếu phụ có hóa đơn riêng cho các vé
//      KHÔNG link, vẫn giữ nguyên.
//
// clearInvoiceGroup = true → clear link của mọi vé b đã link sang chủ hiện
// tại + clear b.invoice_group_id.
// ────────────────────────────────────────────────────────────────────
// 2026-11-19 (v2): 2 cách link:
//   Cách 1 — Link CẢ BOOKING: nhập 1 mã chủ ở card này → gán cho MỌI vé.
//   Cách 2 — Link TỪNG VÉ: nhập ở ô "🔗 Link sang booking" trong mỗi vé ở trên.
//   Cả 2 cùng ghi vào ticket.linkedBookingCode nên BE xử lý thống nhất theo vé.
function InvoiceLinkSection({ form, setField, setForm, isEdit }) {
  const isOwner = isEdit && form.isInvoiceGroupOwner
  const tickets = form.tickets || []
  const linkedTickets = tickets
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => (t.linkedBookingCode || '').trim())

  // Trạng thái "link cả booking": mọi vé cùng 1 mã chủ (không rỗng).
  const codes = tickets.map(t => (t.linkedBookingCode || '').trim().toUpperCase())
  const distinct = [...new Set(codes.filter(Boolean))]
  const allSame = tickets.length > 0 && codes.every(c => c) && distinct.length === 1
  const bookingCode = allSame ? distinct[0] : ''
  const isMixed = distinct.length > 1 || (distinct.length >= 1 && codes.some(c => !c))

  // Gán 1 mã cho TẤT CẢ vé (rỗng = gỡ link toàn bộ).
  const setAllTicketsLink = (code) => {
    const v = (code || '').toUpperCase().replace(/\s/g, '')
    setForm(f => ({ ...f, tickets: f.tickets.map(t => ({ ...t, linkedBookingCode: v })) }))
  }

  return (
    <div className="mt-3 p-3 rounded-xl bg-indigo-50 border border-indigo-200">
      <div className="text-sm font-semibold text-indigo-800 mb-1">
        🔗 Link vé sang booking chủ (chủ xuất hóa đơn hộ)
      </div>

      {/* ── Cách 1: Link CẢ BOOKING ── */}
      <div className="mb-2 p-2 rounded-lg bg-white border border-indigo-200">
        <div className="text-[11px] font-semibold text-indigo-800 mb-1">
          Cách 1 — Link cả booking (gán cho TẤT CẢ vé):
        </div>
        <input type="text"
          value={bookingCode}
          onChange={e => setAllTicketsLink(e.target.value)}
          placeholder={isMixed ? 'Đang link theo từng vé — gõ để gán CHUNG 1 chủ' : 'Mã booking chủ (VD: QCZ5RR)'}
          className="w-full px-3 py-2 rounded-lg bg-white border border-indigo-300
            text-slate-900 placeholder:text-slate-400 text-sm font-mono uppercase
            focus:border-indigo-500 focus:ring-2 focus:ring-indigo-400/30 outline-none" />
        {isMixed && (
          <div className="mt-1 text-[10px] text-amber-700 italic">
            ⚠ Các vé đang link khác nhau (xem danh sách dưới). Gõ mã ở đây sẽ gán CHUNG cho mọi vé.
          </div>
        )}
        {(allSame || isMixed) && (
          <button type="button" onClick={() => setAllTicketsLink('')}
            className="mt-1 text-[11px] text-rose-700 hover:text-rose-900 font-semibold">
            × Gỡ link cả booking
          </button>
        )}
      </div>

      {/* ── Cách 2: Link từng vé ── */}
      <div className="text-[11px] text-indigo-700 mb-2 leading-relaxed">
        <b>Cách 2 — Link từng vé:</b> nhập mã chủ ở ô “🔗 Link sang booking” trong
        từng vé bên trên. Các vé có thể link sang các booking chủ khác nhau. Khi chủ
        upload hóa đơn, vé đã link nằm trong hóa đơn của chủ — booking này thấy hóa đơn đó tự động.
      </div>

      {linkedTickets.length > 0 && (
        <div className="mb-2 space-y-1">
          <div className="text-[10px] font-semibold text-indigo-800">Các vé đang link:</div>
          {linkedTickets.map(({ t, idx }) => (
            <div key={t.id || idx} className="flex items-center gap-2 text-[11px]">
              <span className="font-medium text-slate-800">{t.passengerName || `Vé #${idx + 1}`}</span>
              <span className="text-slate-400">→</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full font-mono font-bold
                  bg-amber-100 text-amber-800 ring-1 ring-amber-300">
                {(t.linkedBookingCode || '').trim().toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}

      {isOwner && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold
              bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300">
            ⭐ Booking chủ
          </span>
          {(form.linkedBookings || []).map(lb => (
            <span key={lb.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold
                bg-indigo-100 text-indigo-800 ring-1 ring-indigo-300">
              {lb.bookingCode || `#${lb.id}`}
            </span>
          ))}
          <label className="inline-flex items-center gap-1 ml-auto text-[11px] text-rose-700 cursor-pointer">
            <input type="checkbox" checked={!!form.clearInvoiceGroup}
              onChange={e => setField('clearInvoiceGroup', e.target.checked)}
              className="accent-rose-500" />
            Gỡ toàn bộ vé đang link về booking này
          </label>
        </div>
      )}

      {form.clearInvoiceGroup && (
        <div className="mb-2 p-2 rounded-md bg-rose-50 border border-rose-300 text-[11px] text-rose-800">
          ⚠ Sau khi lưu: các vé của booking khác đang link về đây sẽ được gỡ.
          Hóa đơn đã xuất vẫn giữ nguyên (không tự chuyển ngược).
        </div>
      )}
    </div>
  )
}
// ═══════════════════════════════════════════════════════════════
//  2026-11-20: LinkedTicketsPicker
//  Hiển thị danh sách vé của BOOKING CHỦ dưới dạng checkbox để user
//  chọn các vé mà vé hiện tại sẽ dùng chung hoá đơn.
//  - Bỏ trống (không chọn gì) = link TOÀN BỘ vé chủ (hành vi cũ).
//  - Chọn 1+ vé = link theo nhóm cụ thể (hoá đơn tách theo nhóm).
// ═══════════════════════════════════════════════════════════════
function LinkedTicketsPicker({ code, cache, selectedIds, onChange }) {
  if (!cache || cache.loading) {
    return (
      <div className="mt-1 text-[11px] text-gray-400 italic">
        Đang tải vé của booking chủ <span className="font-mono">{code}</span>…
      </div>
    )
  }
  if (cache.error) {
    return (
      <div className="mt-1 text-[11px] text-rose-600">
        ⚠ {cache.error}
      </div>
    )
  }
  const bk = cache.booking
  const tickets = bk?.tickets || []
  if (tickets.length === 0) {
    return (
      <div className="mt-1 text-[11px] text-gray-400 italic">
        Booking chủ <span className="font-mono">{code}</span> chưa có vé nào.
      </div>
    )
  }

  const selectedSet = new Set(selectedIds || [])
  const toggle = (tid) => {
    const next = new Set(selectedSet)
    if (next.has(tid)) next.delete(tid); else next.add(tid)
    onChange([...next])
  }
  const clearAll = () => onChange([])
  const selectAll = () => onChange(tickets.map(t => t.id))

  const hasSelection = selectedSet.size > 0
  return (
    <div className="mt-2 p-2 rounded-lg border border-indigo-200 bg-indigo-50/50">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[11px] font-semibold text-indigo-900">
          Chọn vé của <span className="font-mono">{code}</span> dùng chung hoá đơn
          <span className="font-normal text-indigo-700">
            {' '}— bỏ chọn hết = link toàn bộ
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={selectAll}
            className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100">
            Chọn hết
          </button>
          <button type="button" onClick={clearAll}
            className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100">
            Bỏ chọn
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {tickets.map(tt => {
          const checked = selectedSet.has(tt.id)
          return (
            <label key={tt.id}
              className={`flex items-center gap-2 text-[11px] px-2 py-1 rounded cursor-pointer transition
                ${checked ? 'bg-indigo-100 text-indigo-900' : 'bg-white hover:bg-indigo-50 text-gray-700'}`}>
              <input type="checkbox" checked={checked}
                onChange={() => toggle(tt.id)}
                className="accent-indigo-600" />
              <span className="font-semibold truncate flex-1">
                {tt.passengerName || '(chưa có tên)'}
              </span>
              <span className="font-mono text-[10px] text-gray-500 shrink-0">
                {tt.ticketNumber || '—'}
              </span>
            </label>
          )
        })}
      </div>
      {hasSelection && (
        <div className="mt-1.5 text-[10px] text-indigo-700 italic">
          ✓ Đã chọn {selectedSet.size}/{tickets.length} vé — vé này sẽ nằm cùng hoá đơn với các vé đó.
        </div>
      )}
    </div>
  )
}