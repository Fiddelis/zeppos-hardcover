import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhoneService } from '../app-side/service.js'

function fixture(options = {}) {
  const calls = []
  let token = 'test-only-token'
  const book = { id: 4, userBookId: 8, title: 'A book', statusId: 2, coverUrl: 'https://example.invalid/a.png', currentPage: 30, totalPages: 300, percentage: 10, rating: 4.5 }
  const service = createPhoneService({
    getToken: () => token,
    request: async () => ({}),
    createClient: ({ token: credential }) => {
      calls.push(['client', credential])
      return {
        getLibrary: async params => { calls.push(['library', params]); return [book] },
        getLibraryCount: async statusId => statusId === 2 ? 1 : 0,
        authenticate: async () => ({ id: 42 }),
        updateProgress: async params => { calls.push(['update', params]); return { ...book, currentPage: params.value, percentage: params.value / 3 } },
        updateStatus: async params => { calls.push(['status', params]); return { ...book, statusId: params.statusId } }
      }
    },
    download: async (url, path) => { calls.push(['download', url, path]); return `data://download/${path}` },
    convert: async params => { calls.push(['convert', params]); return { targetFilePath: params.targetFilePath } },
    sendFile: (path, params) => { calls.push(['send', path, params]); return { on() {} } },
    ...options
  })
  return { service, calls, book, setToken: value => { token = value } }
}
test('missing phone token gives setup instructions without contacting API', async () => {
  const f = fixture(); f.setToken('')
  const result = await f.service.handle('library', { statusId: 2 })
  assert.equal(result.ok, false)
  assert.match(result.error, /Zepp app settings/)
  assert.equal(f.calls.length, 0)
})
test('library adapter fixes page size and removes remote cover URLs from watch output', async () => {
  const f = fixture()
  const result = await f.service.handle('library', { statusId: 2, offset: 10, limit: 999 })
  assert.equal(result.ok, true)
  assert.deepEqual(f.calls[1], ['library', { statusId: 2, offset: 10, limit: 10 }])
  assert.equal(result.books[0].coverUrl, undefined)
  assert.equal(result.books[0].hasCover, true)
  assert.equal(result.books[0].rating, 4.5)
})
test('all-section query gives status-ordered bounded batches with exact aggregate total and stable account/url cover key', async () => {
  const f = fixture()
  const result = await f.service.handle('library', { all: true })
  assert.equal(result.total, 1)
  assert.deepEqual(Object.keys(result.groups), ['1', '2', '3'])
  assert.equal(result.groups[2][0].coverKey, (await f.service.handle('library', { statusId: 2 })).books[0].coverKey)
  assert.equal(result.groups[2][0].coverUrl, undefined)
  const originalKey = result.groups[2][0].coverKey
  f.book.coverUrl = 'https://example.invalid/changed-cover.png'
  const changed = await f.service.handle('library', { all: true })
  assert.notEqual(changed.groups[2][0].coverKey, originalKey)
})
test('cover is downloaded, converted, then sent with book metadata, without credentials', async () => {
  const f = fixture()
  await f.service.handle('library', { statusId: 2 })
  const result = await f.service.handle('cover', { userBookId: 8, coverUrl: 'https://attacker.invalid/' })
  assert.equal(result.ok, true)
  assert.deepEqual(f.calls.slice(2).map(call => call[0]), ['download', 'convert', 'send'])
  assert.equal(f.calls[2][1], f.book.coverUrl)
  assert.equal(f.calls[4][2].userBookId, '8')
  assert.equal(f.calls[4][2].coverKey, result.coverKey)
  assert.equal(f.calls[4][2].accountKey, (await f.service.handle('library', { all: true })).accountKey)
  assert.ok(!JSON.stringify(f.calls.slice(2)).includes('test-only-token'))
  await f.service.handle('cover', { userBookId: 8 })
  assert.equal(f.calls.filter(call => call[0] === 'download').length, 1)
})
test('progress update passes an absolute value and rejects bad values', async () => {
  const f = fixture()
  await f.service.handle('library', { statusId: 2 })
  const updated = await f.service.handle('progress', { userBookId: 8, mode: 'pages', value: 31 })
  assert.equal(updated.ok, true)
  assert.equal(updated.book.currentPage, 31)
  assert.equal(updated.book.percentage, 31 / 3)
  assert.deepEqual(f.calls[2], ['update', { userBookId: 8, mode: 'pages', value: 31 }])
  assert.equal((await f.service.handle('progress', { userBookId: 8, mode: 'pages', value: 301 })).ok, false)
  assert.equal(f.calls.length, 3)
})
test('status RPC sends only record ID and validated status, returning sanitized confirmed book', async () => {
  const f = fixture()
  await f.service.handle('library', { statusId: 2 })
  const result = await f.service.handle('status', { userBookId: 8, statusId: 1 })
  assert.equal(result.ok, true)
  assert.equal(result.book.statusId, 1)
  assert.equal(result.book.coverUrl, undefined)
  assert.deepEqual(f.calls[2], ['status', { userBookId: 8, statusId: 1 }])
  assert.equal((await f.service.handle('status', { userBookId: 8, statusId: 4 })).error,
    'Choose Currently Reading, Want to Read, or Read.')
  assert.equal(f.calls.filter(([method]) => method === 'status').length, 1)
})
test('a settings revision during a progress write is reported as ambiguous, not retried', async () => {
  let finish
  const f = fixture({
    createClient: () => ({
      getLibrary: async () => [f.book],
      getLibraryCount: async () => 1,
      authenticate: async () => ({ id: 42 }),
      updateProgress: () => new Promise(resolve => { finish = resolve })
    })
  })
  await f.service.handle('library', { statusId: 2 })
  const pending = f.service.handle('progress', { userBookId: 8, mode: 'pages', value: 31 })
  f.service.clear()
  finish({ ...f.book, currentPage: 31, percentage: 10.333 })
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.ambiguous, true)
  assert.match(result.error, /verify progress/)
})
test('token replacement clears old books and cached covers', async () => {
  const f = fixture()
  await f.service.handle('library', { statusId: 2 })
  f.setToken('replacement-test-token')
  assert.equal((await f.service.handle('cover', { userBookId: 8 })).ok, false)
  assert.deepEqual(f.calls[2], ['client', 'replacement-test-token'])
})
test('raw errors and credentials never cross the phone/watch boundary', async () => {
  const f = fixture({ createClient: () => ({ getLibrary: async () => { throw new Error('sensitive request headers') } }) })
  const result = await f.service.handle('library', { statusId: 2 })
  assert.equal(result.ok, false)
  assert.ok(!JSON.stringify(result).includes('sensitive'))
})
test('conversion failure provides a fallback and remains retryable', async () => {
  let attempts = 0
  const f = fixture({ convert: async () => { attempts++; throw new Error('Not PNG') } })
  await f.service.handle('library', { statusId: 2 })
  assert.match((await f.service.handle('cover', { userBookId: 8 })).error, /Cover unavailable/)
  await f.service.handle('cover', { userBookId: 8 })
  assert.equal(attempts, 2)
})
test('completed transfer can be requested again by a refreshed watch page', async () => {
  let change
  const f = fixture({ sendFile: () => ({ on: (_event, callback) => { change = callback } }) })
  await f.service.handle('library', { statusId: 2 })
  await f.service.handle('cover', { userBookId: 8 })
  change({ data: { readyState: 'transferred' } })
  await f.service.handle('cover', { userBookId: 8 })
  assert.equal(f.calls.filter(call => call[0] === 'download').length, 2)
})

test('returning across status sections preserves earlier records for progress updates', async () => {
  const reading = { userBookId: 8, statusId: 2, totalPages: 300, currentPage: 30 }
  const waiting = { userBookId: 9, statusId: 1, totalPages: 250 }
  let updates = 0
  const f = fixture({ createClient: () => ({
    authenticate: async () => ({ id: 42 }),
    getLibraryCount: async statusId => statusId === 3 ? 0 : 1,
    getLibrary: async ({ statusId }) => statusId === 2 ? [reading] : statusId === 1 ? [waiting] : [],
    updateProgress: async () => { updates++ }
  }) })
  await f.service.handle('library', { all: true })
  await f.service.handle('library', { statusId: 1, offset: 0 })
  assert.equal((await f.service.handle('progress', { userBookId: 8, mode: 'pages', value: 31 })).ok, true)
  assert.equal(updates, 1)
})
