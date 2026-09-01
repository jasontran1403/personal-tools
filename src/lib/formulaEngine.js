import * as F from '@formulajs/formulajs'

/**
 * Bộ tính công thức cho bảng tính.
 *
 * VÌ SAO TỰ VIẾT thay vì dùng thư viện có sẵn:
 *   • HyperFormula mạnh nhưng cấp phép GPLv3 — dính vào là cả dự án phải mở
 *     mã nguồn, không dùng cho phần mềm nội bộ của công ty được.
 *   • Handsontable (kèm sẵn engine) cũng là giấy phép thương mại.
 * @formulajs/formulajs là MIT và đã có sẵn hơn 300 hàm Excel; phần còn thiếu
 * chỉ là bộ đọc công thức và giải phụ thuộc giữa các ô — đó là những gì file
 * này làm.
 *
 * Hỗ trợ: tham chiếu A1 / $A$1, vùng A1:B10, toán tử + - * / ^ & % và so sánh,
 * lồng hàm, và mọi hàm formulajs (SUM, IF, VLOOKUP, HLOOKUP, COUNTIF, ...).
 */

// ═══════════════════════════════════════════════════════════════════
// Địa chỉ ô
// ═══════════════════════════════════════════════════════════════════

export const colToLetter = c => {
  let s = ''
  let n = c
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

export const letterToCol = s => {
  let n = 0
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export const cellKey = (r, c) => `${r},${c}`
export const cellLabel = (r, c) => `${colToLetter(c)}${r + 1}`

/**
 * Cùng một thứ với cellLabel, giữ hai tên vì hai nơi gọi quen hai cách:
 * bộ tính công thức nói "nhãn ô", còn giao diện bảng tính nói "địa chỉ ô".
 * Định nghĩa MỘT lần ở đây để hai file không trôi lệch nhau.
 */
export const addressOf = cellLabel

/** "$B$7" → { r: 6, c: 1 } */
const parseRef = text => {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(text)
  if (!m) return null
  return { c: letterToCol(m[1]), r: parseInt(m[2], 10) - 1 }
}

// ═══════════════════════════════════════════════════════════════════
// Lỗi
// ═══════════════════════════════════════════════════════════════════

export const ERR = {
  DIV0:  '#DIV/0!',
  VALUE: '#VALUE!',
  REF:   '#REF!',
  NAME:  '#NAME?',
  NA:    '#N/A',
  CYCLE: '#VÒNG LẶP!',
  PARSE: '#CÚ PHÁP!',
}

const ERROR_SET = new Set(Object.values(ERR))
export const isError = v => typeof v === 'string' && ERROR_SET.has(v)

class FormulaError extends Error {
  constructor(code) { super(code); this.code = code }
}

// ═══════════════════════════════════════════════════════════════════
// Tách token
// ═══════════════════════════════════════════════════════════════════

const T = { NUM: 'num', STR: 'str', BOOL: 'bool', REF: 'ref', FUNC: 'func', OP: 'op', PUNC: 'punc' }

function tokenize(src) {
  const out = []
  let i = 0

  while (i < src.length) {
    const ch = src[i]

    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue }

    // Chuỗi: "abc", hai dấu nháy liền nhau là một dấu nháy trong nội dung
    if (ch === '"') {
      let j = i + 1, val = ''
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { val += '"'; j += 2; continue }
          break
        }
        val += src[j++]
      }
      if (j >= src.length) throw new FormulaError(ERR.PARSE)
      out.push({ t: T.STR, v: val })
      i = j + 1
      continue
    }

    // Số
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i))
      out.push({ t: T.NUM, v: parseFloat(m[0]) })
      i += m[0].length
      continue
    }

    // Tham chiếu, tên hàm, TRUE/FALSE
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i))
      const word = m[0]
      let j = i + word.length
      while (src[j] === ' ') j++   // "SUM (A1:A5)" vẫn phải chạy

      if (src[j] === '(') {
        out.push({ t: T.FUNC, v: word.toUpperCase() })
        i = j
        continue
      }
      const upper = word.toUpperCase()
      if (upper === 'TRUE' || upper === 'FALSE') {
        out.push({ t: T.BOOL, v: upper === 'TRUE' })
      } else if (parseRef(word)) {
        out.push({ t: T.REF, v: word })
      } else {
        // Tên không phải ô cũng không phải hàm — để evaluator báo #NAME?
        out.push({ t: T.FUNC, v: upper, bare: true })
      }
      i += word.length
      continue
    }

    // Toán tử hai ký tự phải thử TRƯỚC một ký tự, không thì "<=" bị đọc thành "<"
    const two = src.slice(i, i + 2)
    if (['<=', '>=', '<>'].includes(two)) { out.push({ t: T.OP, v: two }); i += 2; continue }

    if ('+-*/^&=<>%'.includes(ch)) { out.push({ t: T.OP, v: ch }); i++; continue }
    if ('(),:;'.includes(ch))      { out.push({ t: T.PUNC, v: ch === ';' ? ',' : ch }); i++; continue }

    throw new FormulaError(ERR.PARSE)
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════
// Phân tích cú pháp → cây
// ═══════════════════════════════════════════════════════════════════

/**
 * Độ ưu tiên theo đúng Excel, từ chặt tới lỏng:
 *   %  →  ^  →  * /  →  + -  →  &  →  so sánh
 */
function parse(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const eat = () => tokens[pos++]
  const expect = v => {
    const t = tokens[pos]
    if (!t || t.v !== v) throw new FormulaError(ERR.PARSE)
    pos++
  }

  const parseComparison = () => {
    let left = parseConcat()
    while (peek()?.t === T.OP && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
      const op = eat().v
      left = { type: 'binary', op, left, right: parseConcat() }
    }
    return left
  }

  const parseConcat = () => {
    let left = parseAdditive()
    while (peek()?.t === T.OP && peek().v === '&') {
      eat()
      left = { type: 'binary', op: '&', left, right: parseAdditive() }
    }
    return left
  }

  const parseAdditive = () => {
    let left = parseMultiplicative()
    while (peek()?.t === T.OP && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v
      left = { type: 'binary', op, left, right: parseMultiplicative() }
    }
    return left
  }

  const parseMultiplicative = () => {
    let left = parsePower()
    while (peek()?.t === T.OP && (peek().v === '*' || peek().v === '/')) {
      const op = eat().v
      left = { type: 'binary', op, left, right: parsePower() }
    }
    return left
  }

  // ^ kết hợp phải: 2^3^2 = 2^(3^2)
  const parsePower = () => {
    const left = parseUnary()
    if (peek()?.t === T.OP && peek().v === '^') {
      eat()
      return { type: 'binary', op: '^', left, right: parsePower() }
    }
    return left
  }

  const parseUnary = () => {
    if (peek()?.t === T.OP && (peek().v === '-' || peek().v === '+')) {
      const op = eat().v
      return { type: 'unary', op, operand: parseUnary() }
    }
    return parsePostfix()
  }

  const parsePostfix = () => {
    let node = parsePrimary()
    while (peek()?.t === T.OP && peek().v === '%') {
      eat()
      node = { type: 'percent', operand: node }
    }
    return node
  }

  const parsePrimary = () => {
    const tok = peek()
    if (!tok) throw new FormulaError(ERR.PARSE)

    if (tok.t === T.NUM)  { eat(); return { type: 'literal', value: tok.v } }
    if (tok.t === T.STR)  { eat(); return { type: 'literal', value: tok.v } }
    if (tok.t === T.BOOL) { eat(); return { type: 'literal', value: tok.v } }

    if (tok.t === T.PUNC && tok.v === '(') {
      eat()
      const inner = parseComparison()
      expect(')')
      return inner
    }

    if (tok.t === T.REF) {
      eat()
      // Vùng: A1:B10
      if (peek()?.t === T.PUNC && peek().v === ':' && tokens[pos + 1]?.t === T.REF) {
        eat()
        const end = eat()
        return { type: 'range', from: tok.v, to: end.v }
      }
      return { type: 'ref', ref: tok.v }
    }

    if (tok.t === T.FUNC) {
      eat()
      if (tok.bare) throw new FormulaError(ERR.NAME)
      expect('(')
      const args = []
      if (!(peek()?.t === T.PUNC && peek().v === ')')) {
        do {
          // Đối số bỏ trống: IF(A1>0,,"x") — Excel coi là 0/rỗng
          if (peek()?.t === T.PUNC && (peek().v === ',' || peek().v === ')')) {
            args.push({ type: 'literal', value: null })
          } else {
            args.push(parseComparison())
          }
        } while (peek()?.t === T.PUNC && peek().v === ',' && (eat(), true))
      }
      expect(')')
      return { type: 'call', name: tok.v, args }
    }

    throw new FormulaError(ERR.PARSE)
  }

  const ast = parseComparison()
  if (pos < tokens.length) throw new FormulaError(ERR.PARSE)
  return ast
}

/** Nhớ lại cây đã phân tích — cùng một công thức bị tính lại rất nhiều lần */
const astCache = new Map()

function astOf(formula) {
  if (astCache.has(formula)) return astCache.get(formula)
  let ast
  try {
    ast = parse(tokenize(formula))
  } catch (e) {
    ast = { type: 'error', code: e.code || ERR.PARSE }
  }
  if (astCache.size > 5000) astCache.clear()   // chặn rò rỉ khi mở nhiều file
  astCache.set(formula, ast)
  return ast
}

// ═══════════════════════════════════════════════════════════════════
// Ép kiểu
// ═══════════════════════════════════════════════════════════════════

const toNumber = v => {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  if (isError(v)) throw new FormulaError(v)

  const s = String(v).trim().replace(/,/g, '')
  if (s === '') return 0
  const n = Number(s)
  if (Number.isNaN(n)) throw new FormulaError(ERR.VALUE)
  return n
}

const toText = v => {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

/** Ô rỗng so sánh với "" phải bằng nhau, còn với số thì bằng 0 */
const compare = (a, b) => {
  const an = a == null || a === ''
  const bn = b == null || b === ''
  if (an && bn) return 0
  if (typeof a === 'number' || typeof b === 'number') {
    const x = toNumber(a), y = toNumber(b)
    return x < y ? -1 : x > y ? 1 : 0
  }
  const x = toText(a).toLowerCase(), y = toText(b).toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

// ═══════════════════════════════════════════════════════════════════
// Bộ tính
// ═══════════════════════════════════════════════════════════════════

/**
 * @param getRaw  (r, c) => giá trị thô của ô: chuỗi người dùng gõ, hoặc null.
 *                Chuỗi bắt đầu bằng "=" là công thức.
 *
 * Mỗi lần bảng đổi thì tạo Engine mới — cách này đơn giản và đủ nhanh cho bảng
 * vài nghìn ô, khỏi phải dựng đồ thị phụ thuộc rồi tính lại từng nhánh.
 */
export class Engine {
  constructor(getRaw) {
    this.getRaw = getRaw
    this.cache = new Map()      // key ô → giá trị đã tính
    this.visiting = new Set()   // đang tính dở → phát hiện tham chiếu vòng
  }

  /** Giá trị hiển thị của một ô */
  value(r, c) {
    const key = cellKey(r, c)
    if (this.cache.has(key)) return this.cache.get(key)

    if (this.visiting.has(key)) return ERR.CYCLE
    this.visiting.add(key)

    let result
    try {
      result = this.compute(r, c)
    } catch (e) {
      result = e instanceof FormulaError ? e.code : ERR.VALUE
    } finally {
      this.visiting.delete(key)
    }

    this.cache.set(key, result)
    return result
  }

  compute(r, c) {
    const raw = this.getRaw(r, c)
    if (raw == null || raw === '') return ''
    if (typeof raw === 'number' || typeof raw === 'boolean') return raw

    const s = String(raw)
    if (!s.startsWith('=')) return parseLiteral(s)

    const ast = astOf(s.slice(1))
    return this.eval(ast)
  }

  eval(node) {
    switch (node.type) {
      case 'error':
        throw new FormulaError(node.code)

      case 'literal':
        return node.value

      case 'ref': {
        const ref = parseRef(node.ref)
        if (!ref) throw new FormulaError(ERR.REF)
        const v = this.value(ref.r, ref.c)
        if (isError(v)) throw new FormulaError(v)
        return v
      }

      case 'range':
        return this.rangeValues(node)

      case 'unary': {
        const v = this.eval(node.operand)
        return node.op === '-' ? -toNumber(v) : toNumber(v)
      }

      case 'percent':
        return toNumber(this.eval(node.operand)) / 100

      case 'binary': {
        const l = this.eval(node.left)
        const r = this.eval(node.right)
        switch (node.op) {
          case '+': return toNumber(l) + toNumber(r)
          case '-': return toNumber(l) - toNumber(r)
          case '*': return toNumber(l) * toNumber(r)
          case '/': {
            const d = toNumber(r)
            if (d === 0) throw new FormulaError(ERR.DIV0)
            return toNumber(l) / d
          }
          case '^': return Math.pow(toNumber(l), toNumber(r))
          case '&': return toText(l) + toText(r)
          case '=':  return compare(l, r) === 0
          case '<>': return compare(l, r) !== 0
          case '<':  return compare(l, r) < 0
          case '>':  return compare(l, r) > 0
          case '<=': return compare(l, r) <= 0
          case '>=': return compare(l, r) >= 0
          default:   throw new FormulaError(ERR.PARSE)
        }
      }

      case 'call':
        return this.call(node)

      default:
        throw new FormulaError(ERR.PARSE)
    }
  }

  /** Vùng → mảng 2 chiều, đúng dạng VLOOKUP/SUMIF của formulajs cần */
  rangeValues(node) {
    const a = parseRef(node.from)
    const b = parseRef(node.to)
    if (!a || !b) throw new FormulaError(ERR.REF)

    const r1 = Math.min(a.r, b.r), r2 = Math.max(a.r, b.r)
    const c1 = Math.min(a.c, b.c), c2 = Math.max(a.c, b.c)

    // Chặn vùng khổng lồ kiểu A1:A1048576 làm treo trình duyệt
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 200000) throw new FormulaError(ERR.REF)

    const grid = []
    for (let r = r1; r <= r2; r++) {
      const row = []
      for (let c = c1; c <= c2; c++) {
        const v = this.value(r, c)
        row.push(isError(v) ? v : (v === '' ? null : v))
      }
      grid.push(row)
    }
    return grid
  }

  call(node) {
    const fn = F[node.name]
    if (typeof fn !== 'function') throw new FormulaError(ERR.NAME)

    // IF phải tính LƯỜI: IF(A1=0, 0, 100/A1) mà tính cả hai nhánh thì
    // nhánh chia cho 0 sẽ ném lỗi dù nó không được chọn.
    if (node.name === 'IF') {
      const cond = truthy(this.eval(node.args[0]))
      const branch = cond ? node.args[1] : node.args[2]
      if (!branch) return cond
      const v = this.eval(branch)
      return v == null ? (cond ? true : false) : v
    }
    if (node.name === 'IFERROR' || node.name === 'IFNA') {
      try {
        const v = this.eval(node.args[0])
        return isError(v) ? this.eval(node.args[1]) : v
      } catch {
        return node.args[1] ? this.eval(node.args[1]) : ''
      }
    }

    const args = node.args.map(a => this.eval(a))
    const out = fn(...args)

    if (out instanceof Error) throw new FormulaError(ERR.VALUE)
    // formulajs trả về chuỗi lỗi Excel cho một số hàm — chuyển thành lỗi thật
    if (isError(out)) throw new FormulaError(out)
    if (typeof out === 'number' && !Number.isFinite(out)) throw new FormulaError(ERR.DIV0)
    return out
  }
}

const truthy = v => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v == null || v === '') return false
  const s = String(v).trim().toUpperCase()
  if (s === 'TRUE') return true
  if (s === 'FALSE') return false
  return Boolean(s)
}

/**
 * Chuỗi người dùng gõ vào ô thường: nhận diện số, phần trăm, boolean.
 * Không đụng tới chuỗi có số 0 đứng đầu ("007", "0123456789") — đó gần như
 * luôn là mã số hoặc số điện thoại, biến thành số là mất dữ liệu.
 */
export function parseLiteral(s) {
  const t = s.trim()
  if (t === '') return ''

  const upper = t.toUpperCase()
  if (upper === 'TRUE')  return true
  if (upper === 'FALSE') return false

  if (/^-?\d+(\.\d+)?%$/.test(t)) return parseFloat(t) / 100
  if (/^0\d+$/.test(t)) return s

  const n = Number(t.replace(/,/g, ''))
  if (!Number.isNaN(n) && /^[-+]?[\d.,]+(e[-+]?\d+)?$/i.test(t)) return n

  return s
}

/**
 * Giá trị hiển thị. Số thực bị cắt bớt đuôi nhị phân (0.1+0.2 = 0.30000000000000004)
 * — đây là thứ khiến bảng tính tự viết trông nghiệp dư nhất.
 */
export function formatValue(v, numFmt) {
  if (v == null || v === '') return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return v.toLocaleDateString('vi-VN')

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ERR.DIV0
    const rounded = Math.round(v * 1e10) / 1e10

    if (numFmt === 'percent')  return (rounded * 100).toFixed(2).replace(/\.00$/, '') + '%'
    if (numFmt === 'currency') return rounded.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' ₫'
    if (numFmt === 'number')   return rounded.toLocaleString('vi-VN')

    return String(rounded)
  }
  return String(v)
}