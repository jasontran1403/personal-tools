/**
 * Thin wrappers cho tất cả endpoint /api/tools/vmb/**.
 *
 * ── 2026-09-19 refactor ────────────────────────────────────────
 * - THÊM: listFeeTypes  (dropdown loại phí VN)
 * - THÊM: uploadBookingProof / deleteBookingProof  (file bằng chứng)
 * - SỬA:  createInvoice / updateInvoice — thay {ticketId single} bằng
 *         {ticketIds: []}. Empty array = chung cả booking.
 *   Trên FE truyền {ticketIds: [1,2,3]}; hoặc omit hẳn cho create/update
 *   nghĩa là không đổi. updateInvoice để chuyển sang "chung" thì gửi
 *   {clearTicketIds: true}.
 */
import api from './api'

// ── FEE TYPES (dropdown) ─────────────────────────────────────

export const listFeeTypes = () =>
  api.get('/api/tools/vmb/fee-types')

// ── BOOKINGS ─────────────────────────────────────────────────

export const listBookings = (params = {}) =>
  api.get('/api/tools/vmb/bookings', { params })

export const totalsBookings = (params = {}) =>
  api.get('/api/tools/vmb/bookings/totals', { params })

export const getBooking = (id) =>
  api.get(`/api/tools/vmb/bookings/${id}`)

export const createBooking = (body) =>
  api.post('/api/tools/vmb/bookings', body)

export const updateBooking = (id, body) =>
  api.put(`/api/tools/vmb/bookings/${id}`, body)

export const deleteBooking = (id) =>
  api.delete(`/api/tools/vmb/bookings/${id}`)

// ── MẶT VÉ (Ticket face — 2 scope) ─────────────────────────

export const uploadBookingFace = (bookingId, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/api/tools/vmb/bookings/${bookingId}/face`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const deleteBookingFace = (bookingId) =>
  api.delete(`/api/tools/vmb/bookings/${bookingId}/face`)

export const uploadTicketFace = (ticketId, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/api/tools/vmb/tickets/${ticketId}/face`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const deleteTicketFace = (ticketId) =>
  api.delete(`/api/tools/vmb/tickets/${ticketId}/face`)

// ── BOOKING PROOFS (file bằng chứng) ─────────────────────────
//
// Independent of sharedTicketFace. ticketId null = chung; not null = riêng khách.

export const uploadBookingProof = (bookingId, file, ticketId = null) => {
  const fd = new FormData()
  fd.append('file', file)
  if (ticketId != null) fd.append('ticketId', String(ticketId))
  return api.post(`/api/tools/vmb/bookings/${bookingId}/proofs`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const deleteBookingProof = (proofId) =>
  api.delete(`/api/tools/vmb/proofs/${proofId}`)

// ── INVOICES ─────────────────────────────────────────────────

export const replaceInvoiceFile = (invoiceId, slot, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.put(`/api/tools/vmb/invoices/${invoiceId}/files/${slot}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const deleteInvoiceFile = (invoiceId, slot) =>
  api.delete(`/api/tools/vmb/invoices/${invoiceId}/files/${slot}`)

export const setTicketPaid = (ticketId, status) =>
  api.patch(`/api/tools/vmb/tickets/${ticketId}/paid`, { status })

/**
 * Tạo hóa đơn.
 * @param bookingId
 * @param opts.status       'DRAFT' | 'ISSUED' | 'ADJUSTED'
 * @param opts.note         string
 * @param opts.ticketIds    number[]  — empty [] = chung cả booking
 * @param opts.draftFile / issuedFile / adjustmentFile / adjustmentRecordFile : File
 */
export const createInvoice = (bookingId, { status, note, ticketIds = [], ...files } = {}) => {
  const fd = new FormData()
  fd.append('status', status)
  if (note) fd.append('note', note)
  for (const tid of ticketIds) fd.append('ticketIds', String(tid))
  for (const [k, v] of Object.entries(files)) {
    if (v instanceof File) fd.append(k, v)
  }
  return api.post(`/api/tools/vmb/bookings/${bookingId}/invoices`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

/**
 * Update hóa đơn.
 *   - Truyền {ticketIds: [1,2]} để đổi sang subset đó.
 *   - Truyền {clearTicketIds: true} để đổi thành "chung cả booking" (empty).
 *   - Không truyền cả hai → giữ nguyên ticket scope hiện tại.
 */
export const updateInvoice = (invoiceId, { status, note, ticketIds, clearTicketIds, ...files } = {}) => {
  const fd = new FormData()
  if (status) fd.append('status', status)
  if (note != null) fd.append('note', note)
  if (clearTicketIds) fd.append('clearTicketIds', '1')
  else if (Array.isArray(ticketIds)) {
    for (const tid of ticketIds) fd.append('ticketIds', String(tid))
  }
  for (const [k, v] of Object.entries(files)) {
    if (v instanceof File) fd.append(k, v)
  }
  return api.put(`/api/tools/vmb/invoices/${invoiceId}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const deleteInvoice = (invoiceId) =>
  api.delete(`/api/tools/vmb/invoices/${invoiceId}`)

// ── COMPANIES & PASSENGERS & MEMBERSHIP ──────────────────────

export const listCompanies = () =>
  api.get('/api/tools/vmb/companies')

export const createCompany = (body) =>
  api.post('/api/tools/vmb/companies', body)

export const createCompanyBranch = (parentId, body) =>
  api.post(`/api/tools/vmb/companies/${parentId}/branches`, body)

export const updateCompany = (id, body) =>
  api.put(`/api/tools/vmb/companies/${id}`, body)

export const deleteCompany = (id) =>
  api.delete(`/api/tools/vmb/companies/${id}`)

export const listPassengers = (params = {}) =>
  api.get('/api/tools/vmb/passengers', { params })

export const getPassenger = (id) =>
  api.get(`/api/tools/vmb/passengers/${id}`)

export const createPassenger = (body) =>
  api.post('/api/tools/vmb/passengers', body)

export const updatePassenger = (id, body) =>
  api.put(`/api/tools/vmb/passengers/${id}`, body)

export const deletePassenger = (id) =>
  api.delete(`/api/tools/vmb/passengers/${id}`)

export const upsertPassengerDocument = (passengerId, type, fields = {}, file = null) => {
  const fd = new FormData()
  if (fields.docNumber   != null) fd.append('docNumber',   fields.docNumber)
  if (fields.nationality != null) fd.append('nationality', fields.nationality)
  if (fields.issueDate   != null) fd.append('issueDate',   fields.issueDate)
  if (fields.expiryDate  != null) fd.append('expiryDate',  fields.expiryDate)
  if (file instanceof File)       fd.append('file', file)
  return api.put(`/api/tools/vmb/passengers/${passengerId}/documents/${type}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const deletePassengerDocument = (passengerId, type) =>
  api.delete(`/api/tools/vmb/passengers/${passengerId}/documents/${type}`)

export const listMembershipCards = (passengerId) =>
  api.get(`/api/tools/vmb/passengers/${passengerId}/membership-cards`)

export const createMembershipCard = (passengerId, body) =>
  api.post(`/api/tools/vmb/passengers/${passengerId}/membership-cards`, body)

export const updateMembershipCard = (cardId, body) =>
  api.put(`/api/tools/vmb/membership-cards/${cardId}`, body)

export const deleteMembershipCard = (cardId) =>
  api.delete(`/api/tools/vmb/membership-cards/${cardId}`)

// ── LOOKUP + 2FA ─────────────────────────────────────────────

export const listLookup = (params = {}) =>
  api.get('/api/tools/vmb/lookup', { params })

export const createLookup = (body) =>
  api.post('/api/tools/vmb/lookup', body)

export const updateLookup = (id, body) =>
  api.put(`/api/tools/vmb/lookup/${id}`, body)

export const deleteLookup = (id) =>
  api.delete(`/api/tools/vmb/lookup/${id}`)

export const revealLookupPassword = (id, code) =>
  api.post(`/api/tools/vmb/lookup/${id}/reveal`, { code })

export const lookupStatus = () =>
  api.get('/api/tools/vmb/lookup/status')

export const adminUnlockLookup = () =>
  api.post('/api/tools/vmb/admin/lookup/unlock')

// ══════════════════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════════════════

export const recordPayment = (bookingId, { amount, note, file } = {}) => {
  const fd = new FormData()
  fd.append('amount', amount)
  if (note) fd.append('note', note)
  if (file instanceof File) fd.append('file', file)
  return api.post(`/api/tools/vmb/bookings/${bookingId}/payments`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const batchPay = ({ bookingIds, note, file } = {}) => {
  const fd = new FormData()
  for (const id of bookingIds) fd.append('bookingIds', String(id))
  if (note) fd.append('note', note)
  if (file instanceof File) fd.append('file', file)
  return api.post('/api/tools/vmb/bookings/pay-batch', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const listPayments = (bookingId) =>
  api.get(`/api/tools/vmb/bookings/${bookingId}/payments`)

export const deletePayment = (paymentId) =>
  api.delete(`/api/tools/vmb/payments/${paymentId}`)