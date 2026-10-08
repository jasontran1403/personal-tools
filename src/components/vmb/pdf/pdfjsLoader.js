/**
 * Loader cho pdfjs-dist (v4+).
 *
 * ── Note Vite ──────────────────────────────────────────────
 * Vite import-analysis pre-resolve MỌI import() tĩnh ở build time, kể cả
 * các nhánh nằm trong try/catch. Nên pattern "thử nhiều path trong
 * try/catch" KHÔNG dùng được với Vite.
 *
 * Giải pháp: import tĩnh worker qua `?url` ở top-level. Vite copy file vào
 * bundle và trả URL hashed. pdfjs-dist v4+ chỉ có bản .mjs của worker,
 * không còn .js — nên có đúng 1 path cứng.
 *
 * (Nếu sau này cần hỗ trợ pdfjs-dist v3, đổi path thành
 *  'pdfjs-dist/build/pdf.worker.min.js?url'.)
 */

import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

let _promise = null

/**
 * Trả về module pdfjs (promise để API đồng nhất với bản dynamic trước đó —
 * callers chỉ cần `const pdfjs = await getPdfjs()`).
 */
export function getPdfjs() {
  if (!_promise) _promise = Promise.resolve(pdfjsLib)
  return _promise
}