import { watchBook, PAGE_SIZE, validateEntry } from '../shared/watch-model.js'

export const TOKEN_KEY = 'hardcover_token'
const SAFE_ERRORS = {
  INVALID_TOKEN: 'Your token is invalid. Replace it in Zepp app settings.',
  AUTH_ERROR: 'Hardcover authentication failed. Replace your token in Zepp app settings.',
  NOT_READING: 'Only Currently Reading books can be updated.',
  NO_ACTIVE_READ: 'Start a reading record in Hardcover before updating progress.',
  AMBIGUOUS_READ: 'Resolve multiple active reading records in Hardcover first.',
  UNKNOWN_TOTAL: 'Set the reading edition page count in Hardcover first.',
  INVALID_STATUS: 'Choose Currently Reading, Want to Read, or Read.',
  NOT_OWNED: 'This book is not in your library. Refresh the library and try again.',
  INVALID_BOOK: 'This book could not be identified. Refresh the library and try again.',
  INVALID_PROGRESS: 'Progress is outside the valid range for this edition.',
  UPDATE_FAILED: 'Hardcover did not confirm the update. Reopen the library before retrying.',
  STATUS_UPDATE_FAILED: 'Hardcover did not confirm the status change. Reopen the library to verify it.',
  WRITE_UNCONFIRMED: 'Could not confirm the update. Reopen the library and verify progress before trying again.'
}
function coverCacheKey(accountId, book) {
  const value = `${accountId || 'account'}:${book.userBookId}:${book.coverUrl || ''}`
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0
  return `c${hash.toString(36)}`
}
function accountCacheKey(accountId) { return coverCacheKey(accountId, { userBookId: 0, coverUrl: '' }) }

// Pure adapter: every platform operation is injected for Node integration tests.
export function createPhoneService({ createClient, getToken, request, download, convert, sendFile }) {
  let savedToken = null
  let client = null
  let sequence = 0
  let revision = 0
  let accountId = null
  const books = new Map()
  const coverTasks = new Map()
  function api() {
    const token = String(getToken() || '').trim()
    if (!token) throw new Error('SETUP')
    if (token !== savedToken) {
      revision++
      savedToken = token
      books.clear()
      coverTasks.clear()
      client = createClient({ request, token })
    }
    return client
  }
  return {
    async handle(method, params = {}) {
      try {
        const hardcover = api()
        const requestRevision = revision
        if (method === 'library') {
          if (params.all === true) {
            const statuses = [2, 1, 3]
            const [counts, batches] = await Promise.all([
              Promise.all(statuses.map(statusId => hardcover.getLibraryCount(statusId))),
              Promise.all(statuses.map(statusId => hardcover.getLibrary({ statusId, offset: 0, limit: PAGE_SIZE })))
            ])
            if (requestRevision !== revision || savedToken !== String(getToken() || '').trim()) throw new Error('SETTINGS_CHANGED')
            accountId = (await hardcover.authenticate?.())?.id ?? accountId
            books.clear()
            const groups = {}
            statuses.forEach((statusId, index) => {
              const batch = Array.isArray(batches[index]) ? batches[index] : batches[index]?.books
              if (!Array.isArray(batch)) throw new Error('RESPONSE')
              batch.forEach(book => books.set(String(book.userBookId), book))
              groups[statusId] = batch.map(book => ({ ...watchBook(book), coverKey: book.coverUrl ? coverCacheKey(accountId, book) : null }))
            })
            return { ok: true, groups, counts: { 2: counts[0], 1: counts[1], 3: counts[2] }, total: counts.reduce((sum, count) => sum + count, 0), accountKey: accountCacheKey(accountId) }
          }
          const { statusId, offset = 0 } = params
          if (![1, 2, 3].includes(statusId) || !Number.isInteger(offset) || offset < 0) {
            return { ok: false, error: 'Invalid library section.' }
          }
          const result = await hardcover.getLibrary({ statusId, offset, limit: PAGE_SIZE })
          if (requestRevision !== revision || savedToken !== String(getToken() || '').trim()) throw new Error('SETTINGS_CHANGED')
          // Also accepts { books } for a future pagination envelope.
          const batch = Array.isArray(result) ? result : result.books
          if (!Array.isArray(batch)) throw new Error('RESPONSE')
           batch.forEach(book => books.set(String(book.userBookId), book))
          accountId = (await hardcover.authenticate?.())?.id ?? accountId
          return { ok: true, books: batch.map(book => ({ ...watchBook(book), coverKey: book.coverUrl ? coverCacheKey(accountId, book) : null })), offset, hasMore: batch.length === PAGE_SIZE }
        }
        const key = String(params.userBookId)
        const book = books.get(key)
        if (!book) return { ok: false, error: 'Reopen the library, then try again.' }
        if (method === 'progress') {
          const value = validateEntry(book, params.mode, String(params.value))
          const updated = await hardcover.updateProgress({ userBookId: book.userBookId, mode: params.mode, value })
          if (requestRevision !== revision || savedToken !== String(getToken() || '').trim()) {
            return { ok: false, ambiguous: true, error: SAFE_ERRORS.WRITE_UNCONFIRMED }
          }
          const confirmed = { ...book, ...updated }
          books.set(key, confirmed)
          return {
            ok: true,
            book: { ...watchBook(confirmed), coverKey: confirmed.coverUrl ? coverCacheKey(accountId, confirmed) : null }
          }
        }
        if (method === 'status') {
          if (![1, 2, 3].includes(params.statusId)) return { ok: false, error: 'Choose Currently Reading, Want to Read, or Read.' }
          const updated = await hardcover.updateStatus({ userBookId: book.userBookId, statusId: params.statusId })
          if (requestRevision !== revision || savedToken !== String(getToken() || '').trim()) {
            return { ok: false, ambiguous: true, error: SAFE_ERRORS.STATUS_UPDATE_FAILED }
          }
          const confirmed = { ...book, ...updated }
          books.set(key, confirmed)
          return {
            ok: true,
            book: { ...watchBook(confirmed), coverKey: confirmed.coverUrl ? coverCacheKey(accountId, confirmed) : null }
          }
        }
        if (method === 'cover') {
          if (!book.coverUrl || !/^https:\/\//i.test(book.coverUrl)) {
            return { ok: false, error: 'No supported cover available.' }
          }
          // Watch never supplies a URL, and this download never receives the API token.
          const coverKey = coverCacheKey(accountId, book)
          if (!coverTasks.has(coverKey)) {
            const task = (async () => {
               const name = `cover-${coverKey}-${Date.now()}-${++sequence}.png`
              const input = await download(book.coverUrl, `source-${name}`)
              const output = await convert({ filePath: input, targetFilePath: `data://download/${name}` })
              if (requestRevision !== revision || savedToken !== String(getToken() || '').trim()) throw new Error('SETTINGS_CHANGED')
              const file = sendFile(output.targetFilePath, { kind: 'cover', userBookId: key, coverKey, accountKey: accountCacheKey(accountId) })
              if (!file) throw new Error('TRANSFER')
              file.on('change', event => {
                // Deduplicate only in-flight transfers. A refresh or reopened
                // watch page must be able to request the file again.
                if (['transferred', 'error', 'canceled'].includes(event.data.readyState)) coverTasks.delete(coverKey)
              })
              return { ok: true, queued: true }
            })()
            coverTasks.set(coverKey, task)
            task.catch(() => coverTasks.delete(coverKey))
          }
          return { ...(await coverTasks.get(coverKey)), coverKey }
        }
        return { ok: false, error: 'Unknown request.' }
      } catch (error) {
        // Never forward HTTP/GraphQL errors, which may contain headers or tokens.
        const knownFailure = Boolean(SAFE_ERRORS[error.code]) || ['SETUP', 'SETTINGS_CHANGED'].includes(error.message)
        const ambiguous = ['progress', 'status'].includes(method) && (!knownFailure ||
          error.code === 'UPDATE_FAILED' || error.code === 'STATUS_UPDATE_FAILED')
        return { ok: false, ambiguous, error: SAFE_ERRORS[error.code] || (ambiguous
          ? SAFE_ERRORS.WRITE_UNCONFIRMED : error.message === 'SETUP'
          ? 'Add your Hardcover token in Zepp app settings.'
          : method === 'cover' ? 'Cover unavailable. Reading still works.'
          : 'Request failed. Check your token and phone connection, then retry.') }
      }
    },
    clear() {
      revision++
      savedToken = null
      client = null
      books.clear()
      coverTasks.clear()
      accountId = null
    }
  }
}
