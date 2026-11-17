import { useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../../common/Modal'
import { createFinanceExpense } from '../../../services/vmbApi'
import { parseAmount, formatMoney } from '../../../lib/money'

/**
 * Modal tạo phiếu chi.
 *
 * Luồng:
 *   1. Chọn tài khoản nguồn (Tiền mặt / HD / VCB).
 *   2. Chọn người thụ hưởng:
 *       • "Khác" → nhập tên tự do. Số dư nguồn giảm đúng số tiền.
 *       • "Công nợ HNH" → nguồn giảm, HNH_DEBT giảm (trả bớt công nợ).
 *       • "Ký quỹ VJ"   → nguồn giảm, VJ_DEPOSIT tăng (nạp thêm ký quỹ).
 *   3. Nhập số tiền, nhấn Xác nhận.
 */
export default function ExpenseModal({ accounts, onClose, onSaved }) {
  const spendable = (accounts || []).filter(a => !a.isVirtual)

  const [sourceCode, setSourceCode] = useState(spendable[0]?.code || 'CASH')
  const [beneficiaryKind, setBeneficiaryKind] = useState('FREE') // FREE | HNH_DEBT | VJ_DEPOSIT
  const [beneficiary, setBeneficiary] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const source = spendable.find(a => a.code === sourceCode)
  const bal = parseAmount(source?.balance) || 0

  const submit = async (e) => {
    e?.preventDefault?.()
    const n = parseAmount(amount)
    if (!(n > 0)) return toast.error('Số tiền phải > 0')
    if (!sourceCode) return toast.error('Chưa chọn tài khoản chi')

    let beneficiaryCode = null
    let beneficiaryName = beneficiary.trim()
    if (beneficiaryKind === 'HNH_DEBT') {
      beneficiaryCode = 'HNH_DEBT'
      if (!beneficiaryName) beneficiaryName = 'Thanh toán công nợ HNH'
    } else if (beneficiaryKind === 'VJ_DEPOSIT') {
      beneficiaryCode = 'VJ_DEPOSIT'
      if (!beneficiaryName) beneficiaryName = 'Nạp ký quỹ VJ'
    } else {
      if (!beneficiaryName) return toast.error('Chưa nhập người thụ hưởng')
    }

    setBusy(true)
    try {
      await createFinanceExpense({
        sourceCode,
        amount,
        beneficiary: beneficiaryName,
        beneficiaryCode,
        note,
      })
      toast.success('Đã lưu phiếu chi')
      onSaved?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} title="Phiếu chi" size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200">Hủy</button>
          <button type="submit" form="expense-form" disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : 'Xác nhận chi'}
          </button>
        </div>
      }>
      <form id="expense-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Chi từ</label>
          <div className="grid grid-cols-3 gap-2">
            {spendable.map(a => (
              <button key={a.id} type="button"
                onClick={() => setSourceCode(a.code)}
                className={`px-2 py-2 rounded-lg text-xs font-semibold border transition
                  ${sourceCode === a.code
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-rose-300'}`}>
                {a.name}
                <div className="mt-0.5 font-mono text-[10px] opacity-80">{a.balance || '0'}</div>
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Số dư hiện tại: <b className="font-mono">{source?.balance || '0'}</b>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Chi cho</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { k: 'FREE',        label: 'Khác (nhập tên)' },
              { k: 'HNH_DEBT',    label: 'Công nợ HNH' },
              { k: 'VJ_DEPOSIT',  label: 'Ký quỹ VJ' },
            ].map(opt => (
              <button key={opt.k} type="button"
                onClick={() => setBeneficiaryKind(opt.k)}
                className={`px-2 py-2 rounded-lg text-xs font-semibold border transition
                  ${beneficiaryKind === opt.k
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">
            {beneficiaryKind === 'FREE' ? 'Tên người thụ hưởng' : 'Diễn giải (tùy chọn)'}
          </label>
          <input type="text" value={beneficiary}
            onChange={e => setBeneficiary(e.target.value)}
            placeholder={beneficiaryKind === 'FREE' ? 'Nguyễn Văn A' : 'VD: nạp bổ sung tháng 11'}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Số tiền (VND)</label>
          <input type="text" inputMode="numeric"
            value={amount}
            onChange={e => {
              // 2026-11-17: Format NGAY khi gõ (thêm/bớt ký tự) — chỉ giữ chữ số
              //   rồi chèn dấu chấm phân cách nghìn, không chờ blur.
              const digits = e.target.value.replace(/[^\d]/g, '')
              setAmount(digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '')
            }}
            placeholder="VD: 500.000"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 font-mono text-lg" required />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Ghi chú</label>
          <input type="text" value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Tùy chọn"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
        </div>
      </form>
    </Modal>
  )
}
