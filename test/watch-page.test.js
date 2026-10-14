import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as model from '../shared/watch-model.js'
import { createLayout } from '../page/layout.js'

const persisted = new Map()
const files = new Set()
function fixture({ opaqueWidgets = false } = {}) {
  let page
  let gestureCallback
  let offGestureCalls = 0
  let repaint = 0
  const timers = new Map()
  let timerId = 0
  const statusBarCalls = []
  const ui = {
    widget: { TEXT: 'text', BUTTON: 'button', IMG: 'image', FILL_RECT: 'rect', VIEW_CONTAINER: 'view' },
    prop: { TEXT: 'text', COLOR: 'color', SRC: 'src' }, event: { MOVE: 'move', CLICK_DOWN: 'down', CLICK_UP: 'up' },
    text_style: { WRAP: 1 }, align: { CENTER_V: 1, CENTER_H: 2 },
    setStatusBarVisible: visible => statusBarCalls.push(visible),
     createWidget: (type, options) => {
       repaint++
       return { type, ...(opaqueWidgets ? {} : { options }), listeners: {}, children: [],
         addEventListener(id, fn) { this.listeners[id] = fn },
         setProperty(key, value) { options[key] = value }, setEnable(value) { this.enabled = value },
         createWidget(childType, childOptions) { const child = { type: childType, options: childOptions, listeners: {},
           addEventListener(id, fn) { this.listeners[id] = fn }, setEnable(value) { this.enabled = value },
           click() { childOptions.click_func?.() } }; this.children.push(child); return child }
      }
    }, deleteWidget() {}
  }
  const context = { scrollModes: [],
    ...model, ui, createLayout, getDeviceInfo: () => ({ width: 390, height: 450 }),
    LocalStorage: class LocalStorage { getItem(key, fallback) { return persisted.has(key) ? persisted.get(key) : fallback } setItem(key, value) { persisted.set(key, value) } removeItem(key) { persisted.delete(key) } },
    statSync: ({ path }) => files.has(path) ? { size: 100 } : undefined,
    rmSync: ({ path }) => files.delete(path), onGesture: ({ callback }) => { gestureCallback = callback }, offGesture: () => { offGestureCalls++ },
    setPageBrightTime: options => { context.brightTime = options.brightTime },
     setScrollMode: options => { context.scrollMode = options; context.swiperOptions = options; context.scrollModes.push(options) }, setScrollLock: locked => { context.scrollLocked = locked },
     scrollTo: options => { context.scrollPosition = options }, swipeToIndex: options => { context.swipedTo = options },
    SCROLL_MODE_FREE: 'free', SCROLL_MODE_SWIPER: 'swiper', SCROLL_ANIMATION_NONE: 'none',
    GESTURE_LEFT: 1, GESTURE_RIGHT: 2, GESTURE_UP: 3, GESTURE_DOWN: 4,
    BasePage: options => options, Page: options => { page = options },
    setWatchTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearWatchTimeout: id => { timers.delete(id) },
  }
  const visualSource = readFileSync(new URL('../page/visuals.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export const visuals =', 'const visuals =') + '\nglobalThis.__visuals = visuals;'
  vm.runInNewContext(visualSource, context)
  context.visuals = context.__visuals
  const source = readFileSync(new URL('../page/index.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  vm.runInNewContext(source, context)
  page.state.books = [{ userBookId: 8, title: 'A book', author: 'Author', statusId: 2, currentPage: 30, totalPages: 300, percentage: 10, hasCover: true, coverKey: 'acct-cover-8' }]
  return { page, repaints: () => repaint, timers, statusBarCalls, brightTime: () => context.brightTime,
    gesture: event => gestureCallback?.(event), offGestureCalls: () => offGestureCalls,
    scrollMode: () => context.scrollMode, scrollLocked: () => context.scrollLocked, swipedTo: () => context.swipedTo,
    swiperOptions: () => context.swiperOptions, scrollModes: () => context.scrollModes }
}

function clickLabel(page, label) {
  const item = page.state.widgets.find(widget => widget.options?.text === label)
  assert.ok(item, `visual label exists: ${label}`)
  const box = item.options
  const target = page.state.widgets.find(widget => widget.options?.click_func &&
    box.x >= widget.options.x && box.y >= widget.options.y &&
    box.x + box.w <= widget.options.x + widget.options.w &&
    box.y + box.h <= widget.options.y + widget.options.h)
  assert.ok(target, `backing button exists: ${label}`)
  target.options.click_func()
}

test('loading animation advances actual dot colors without accessing undeclared constants', () => {
  const { page, timers } = fixture()
  page.state.busy = true
  page.render()
  const tick = timers.get(page.state.loadingTimer)
  assert.doesNotThrow(() => tick.callback())
  assert.equal(page.state.loadingFrame, 1)
  assert.equal(page.state.loadingDots[1].options.color, 0xeeb45f)
  page.onDestroy()
})

test('headings share centered typography and shortcuts change pages and percentages', () => {
  const { page } = fixture()
  page.state.groups = { 2: page.state.books, 1: [], 3: [] }
  page.state.counts = { 2: 1, 1: 0, 3: 0 }
  for (let index = 0; index < 3; index++) {
    page.switchSection(index)
    const heading = page.state.widgets.find(widget => widget.options?.text === model.SECTIONS[index].title)
    assert.equal(heading.options.text_size, 24)
    assert.equal(heading.options.align_h, 2)
    assert.equal(heading.options.x, 40)
  }
  page.switchSection(0)
  page.edit()
  clickLabel(page, '+100')
  assert.equal(page.state.input, '130')
  clickLabel(page, '-10')
  assert.equal(page.state.input, '120')
  page.setMode('percentage')
  clickLabel(page, '+5')
  assert.equal(page.state.input, '15')
  clickLabel(page, '-10')
  assert.equal(page.state.input, '5')
})

test('editor works with opaque Zepp widgets that expose methods, not an options property', () => {
  const { page } = fixture({ opaqueWidgets: true })
  assert.doesNotThrow(() => page.edit())
})

test('opening keeps the app status-bar behavior and applies a finite page bright time', async () => {
  const { page, statusBarCalls, brightTime } = fixture()
  page.request = async () => ({ ok: true, groups: {}, counts: {} })
  page.build()
  await new Promise(resolve => setTimeout(resolve, 0))
  page.onDestroy()
  assert.deepEqual(statusBarCalls, [false])
  assert.equal(brightTime(), 120000)
})
test('cover arrival repaints active hero using a local IMG path', () => {
  persisted.clear(); files.clear()
  const { page, repaints } = fixture()
  let change
  files.add('download/cover-1-2.png')
  const file = { readyState: 'pending', fileName: 'cover-1-2.png', params: { kind: 'cover', userBookId: '8', coverKey: 'acct-cover-8' }, on: (_event, callback) => { change = callback } }
  page.onReceivedFile(file)
  assert.equal(repaints(), 0)
  file.readyState = 'transferred'; change()
  assert.ok(repaints() > 0)
  const image = page.state.widgets.find(widget => widget.type === 'image')
  assert.equal(image.options.src, 'data://download/cover-1-2.png')
})
test('Update saves absolute progress directly and keeps library selection', async () => {
  const { page } = fixture()
  persisted.clear()
  const calls = []
  page.request = async ({ method, params }) => {
    calls.push([method, params])
    return method === 'library' ? { ok: true, books: page.state.books, hasMore: false } : {
      ok: true, book: { ...page.book(), currentPage: 45, percentage: 15 }
    }
  }
  page.edit()
  page.state.accountKey = 'account-key'
  page.state.counts = { 2: 1, 1: 0, 3: 0 }
  page.state.input = '45'
  page.render()
  page.state.widgets.find(widget => widget.options.text === 'Update').options.click_func()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls[0][0], 'progress')
  assert.equal(calls[0][1].value, 45)
  assert.equal(page.state.screen, 'library')
  assert.equal(page.book().currentPage, 45)
  assert.equal(page.state.notice, 'Progress saved to Hardcover.')
  assert.equal(persisted.get('library-cache-v1').groups[2][0].currentPage, 45)
  const reopened = fixture().page
  assert.equal(reopened.restoreLibraryCache(), true)
  assert.equal(reopened.book().currentPage, 45)
})
test('definite phone errors keep the editor open without mutating local progress', async () => {
  const { page } = fixture()
  page.state.screen = 'edit'; page.state.input = '45'
  page.request = async () => ({ ok: false, error: 'Phone unavailable.' })
  await page.submitProgress()
  assert.equal(page.state.screen, 'edit')
  assert.equal(page.state.busy, false)
  assert.equal(page.state.message, 'Phone unavailable.')
  assert.equal(page.book().currentPage, 30)
})

test('ambiguous progress timeout remains in editor and blocks a duplicate write', async () => {
  const { page } = fixture()
  persisted.clear()
  page.state.accountKey = 'account-key'
  page.state.counts = { 2: 1, 1: 0, 3: 0 }
  page.state.groups = { 2: page.state.books, 1: [], 3: [] }
  page.persistLibraryCache()
  let requests = 0
  page.request = async () => { requests++; throw new Error('transport timeout') }
  page.edit()
  await page.submitProgress()
  assert.equal(page.state.screen, 'edit')
  assert.equal(page.state.writeUncertain, true)
  assert.ok(persisted.has('pending-progress-v1'))
  await page.submitProgress()
  assert.equal(requests, 1)
  assert.match(page.state.message, /verify it before submitting again/)
  const reopened = fixture().page
  let pendingLibrary
  let progressCalls = 0
  reopened.request = ({ method }) => {
    if (method === 'library') return new Promise(resolve => { pendingLibrary = resolve })
    progressCalls++
    return Promise.resolve({ ok: true })
  }
  reopened.build()
  assert.equal(reopened.state.writeUncertain, true)
  reopened.edit()
  await reopened.submitProgress()
  assert.equal(progressCalls, 0)
  pendingLibrary({ ok: false, error: 'Phone disconnected.' })
})

test('valid account cache hydrates immediately, refreshes in background, and stays usable offline', async () => {
  persisted.clear()
  persisted.set('library-cache-v1', {
    version: 1, accountKey: 'account-key', savedAt: Date.now(), counts: { 2: 1, 1: 0, 3: 0 },
    groups: { 2: [{ userBookId: '8', title: 'Cached title', author: 'Author', statusId: 2, currentPage: 30, totalPages: 300, percentage: 10, rating: null, hasCover: false }], 1: [], 3: [] },
    readingSelected: 0, selectedBookId: '8', viewIndex: 0, listOffsets: {}
  })
  const { page } = fixture()
  let finish
  page.request = () => new Promise(resolve => { finish = resolve })
  page.build()
  assert.equal(page.book().title, 'Cached title')
  assert.equal(page.state.busy, false)
  assert.equal(page.state.syncing, true)
  assert.ok(!page.state.loadingWidget)
  finish({ ok: false, error: 'Phone disconnected.' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(page.book().title, 'Cached title')
  assert.equal(page.state.cachedOffline, true)
  assert.equal(page.state.message, 'Offline — showing saved library.')
  assert.ok(!page.state.retryKind)
})

test('expired or malformed library cache is discarded rather than rendered', () => {
  persisted.clear()
  persisted.set('library-cache-v1', { version: 1, accountKey: 'account-key', savedAt: 0, groups: {}, counts: {} })
  const { page } = fixture()
  assert.equal(page.restoreLibraryCache(), false)
  assert.equal(persisted.has('library-cache-v1'), false)
  persisted.set('library-cache-v1', {
    version: 1, accountKey: 'account-key', savedAt: Date.now(), counts: { 2: 1, 1: 0, 3: 0 },
    groups: { 2: [{ userBookId: '', title: 'Corrupt', statusId: 2 }], 1: [], 3: [] }
  })
  assert.equal(page.restoreLibraryCache(), false)
  assert.equal(persisted.has('library-cache-v1'), false)
})

test('phone account invalidation removes cached account metadata', () => {
  persisted.clear()
  const { page } = fixture()
  page.state.groups = { 2: [{ userBookId: '8', title: 'Old account', statusId: 2 }], 1: [], 3: [] }
  page.state.books = page.state.groups[2]
  persisted.set('library-cache-v1', { version: 1 })
  files.add('download/cover-cache.png')
  persisted.set('cover-cache-v1', { old: { src: 'data://download/cover-cache.png', fsPath: 'download/cover-cache.png' } })
  page.onCall({ method: 'invalidate-library' })
  assert.equal(persisted.has('library-cache-v1'), false)
  assert.equal(files.has('download/cover-cache.png'), false)
  assert.equal(Object.keys(persisted.get('cover-cache-v1')).length, 0)
  assert.equal(page.state.books.length, 0)
})
test('pagination loads the next and previous batch at book boundaries', async () => {
  const { page } = fixture()
  const offsets = []
  page.state.total = 2
  page.state.books = [{ userBookId: 8, statusId: 2 }]
  page.state.groups = { 2: [{ userBookId: 8, statusId: 2 }] }
  page.state.counts = { 2: 2 }
  page.request = async ({ params }) => { offsets.push(params); return { ok: true, books: [{ userBookId: 9, statusId: 2 }] } }
  page.move(1)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(offsets[0].offset, 1)
  assert.equal(page.state.books[1].userBookId, 9)
})
test('home counter is reading-only and section navigation skips empty groups', async () => {
  const { page } = fixture()
  const calls = []
  page.request = async ({ params }) => {
    calls.push(params)
    if (params.all) return { ok: true, total: 2, counts: { 2: 1, 1: 0, 3: 1 }, accountKey: 'account', groups: {
      2: [{ userBookId: 1, statusId: 2, title: 'Reading', hasCover: false }], 1: [], 3: [{ userBookId: 3, statusId: 3, title: 'Read', hasCover: false }]
    } }
    return { ok: true, books: [{ userBookId: 3, statusId: 3, title: 'Read', hasCover: false }] }
  }
  await page.load()
  assert.deepEqual(page.state.books.map(book => book.userBookId), [1])
  assert.equal(page.state.total, 1)
  page.switchSection(1)
  assert.equal(page.state.books.length, 0)
  page.switchSection(2)
  assert.deepEqual(page.state.books.map(book => book.statusId), [3])
  assert.equal(page.state.total, 1)
  assert.ok(!calls.some(params => params.statusId === 3))
})
test('destroyed page ignores late cover events', () => {
  const { page, repaints } = fixture()
  page.onDestroy()
  page.onReceivedFile({ readyState: 'transferred', fileName: 'cover-1-2.png', params: { kind: 'cover', userBookId: '8', coverKey: 'acct-cover-8' }, on() {} })
  assert.equal(repaints(), 0)
})
test('interrupted transfer times out to fallback, while a late arrival still repaints', async () => {
  persisted.clear(); files.clear()
  const { page, timers } = fixture()
  page.request = async () => ({ ok: true, queued: true })
  await page.loadCover()
  assert.equal(page.state.coverStates['acct-cover-8'], 'loading')
  Array.from(timers.values()).find(timer => timer.delay === 60000).callback()
  assert.equal(page.state.coverStates['acct-cover-8'], 'unavailable')
  files.add('download/cover-1-2.png')
  page.onReceivedFile({ readyState: 'transferred', fileName: 'cover-1-2.png', params: { kind: 'cover', userBookId: '8', coverKey: 'acct-cover-8' }, on() {} })
  assert.equal(page.state.coverStates['acct-cover-8'], 'ready')
})

test('cover cache survives page lifecycle, checks file existence, and retries missing cache entries', async () => {
  persisted.clear(); files.clear()
  let { page } = fixture()
  page.onReceivedFile({ readyState: 'transferred', fileName: 'cover-c1-1.png', params: { kind: 'cover', userBookId: '8', coverKey: 'stable-account-url-key' }, on() {} })
  files.add('download/cover-c1-1.png')
  page.state.alive = false
  ;({ page } = fixture())
  page.state.books[0].coverKey = 'stable-account-url-key'
  page.restoreCoverCache()
  let downloads = 0
  page.request = async () => { downloads++; return { ok: true } }
  await page.loadCover()
  assert.equal(downloads, 0)
  assert.equal(page.state.covers['stable-account-url-key'], 'data://download/cover-c1-1.png')
  files.delete('download/cover-c1-1.png')
  page.state.covers = {}; page.state.coverStates = {}
  await page.loadCover()
  assert.equal(downloads, 1)
})

test('account switch invalidates persisted cover files', () => {
  persisted.clear(); files.clear()
  const { page } = fixture()
  persisted.set('cover-account-v1', 'old-account')
  persisted.set('cover-cache-v1', { old: { fsPath: 'download/cover-c1-1.png', src: 'data://download/cover-c1-1.png' } })
  files.add('download/cover-c1-1.png')
  page.setCoverAccount('new-account')
  assert.equal(files.has('download/cover-c1-1.png'), false)
  assert.equal(Object.keys(persisted.get('cover-cache-v1')).length, 0)
  page.onReceivedFile({ readyState: 'transferred', fileName: 'cover-old-1.png', params: { kind: 'cover', userBookId: '8', coverKey: 'old-key', accountKey: 'old-account' }, on() {} })
  assert.equal(page.state.covers['old-key'], undefined)
})

test('wheel controller steps absolute progress and Cancel does not write', async () => {
  const { page } = fixture()
  page.edit(); page.render()
  page.updateWheel(1)
  assert.equal(page.state.input, '31')
  let calls = 0
  page.request = async () => { calls++; return { ok: true } }
  clickLabel(page, 'Cancel')
  assert.equal(calls, 0)
  assert.equal(page.state.screen, 'library')
})

test('visual wheel uses its own drag region and leaves footer Update outside its hit box', () => {
  const { page } = fixture()
  page.edit()
  const wheel = page.state.wheelSurface
  const update = page.state.widgets.find(widget => widget.options?.text === 'Update')
  assert.ok(wheel && update)
  assert.ok(wheel.options.y + wheel.options.h <= update.options.y)
  wheel.listeners.down({ y: 260 })
  wheel.listeners.move({ y: 232 })
  wheel.listeners.up({ y: 232 })
  assert.equal(page.state.input, '31')
})

test('vertical wheel is bounded and percentage adjusts in tenths with a 100 percent cap', () => {
  const { page } = fixture()
  page.edit(); page.render()
  page.updateWheel(160)
  assert.equal(page.state.input, '190')
  page.updateWheel(200)
  assert.equal(page.state.input, '300')
  page.setMode('percentage')
  page.state.input = '99.9'
  page.render()
  page.updateWheel(1)
  assert.equal(page.state.input, '100')
  page.updateWheel(1)
  assert.equal(page.state.input, '100')
})

test('Cancel leaves progress unchanged and returns to the library without a request', () => {
  const { page } = fixture()
  page.edit(); page.render()
  page.state.input = '55'
  page.render()
  let requests = 0
  page.request = async () => { requests++; return { ok: true } }
  page.state.widgets.find(widget => widget.options.text === 'Cancel').options.click_func()
  assert.equal(page.state.screen, 'library')
  assert.equal(requests, 0)
})

test('book status editor keeps its source book independent of row selection and submits a status change', async () => {
  const f = fixture()
  const current = f.page.state.books[0]
  f.page.state.groups = { 2: [current], 1: [], 3: [] }
  f.page.state.counts = { 2: 1, 1: 0, 3: 0 }
  f.page.state.accountKey = 'account'
  const requests = []
  f.page.request = async ({ method, params }) => {
    requests.push([method, params])
    if (method === 'status') return { ok: true, book: { ...current, statusId: 1 } }
    return { ok: true, total: 1, counts: { 2: 0, 1: 1, 3: 0 }, groups: { 2: [], 1: [{ ...current, statusId: 1 }], 3: [] }, accountKey: 'account' }
  }
  assert.equal(f.page.openStatus(current), true)
  assert.equal(f.page.state.statusBook.userBookId, current.userBookId)
  f.page.state.selected = 99
  await f.page.submitStatus(1)
  assert.equal(JSON.stringify(requests[0]), JSON.stringify(['status', { userBookId: 8, statusId: 1 }]))
  assert.equal(f.page.state.statusBook, null)
  assert.equal(f.page.state.screen, 'library')
  assert.equal(f.page.state.groups[1][0].userBookId, 8)
})

test('status cancel makes no request and ambiguous status writes block duplicate submission', async () => {
  const f = fixture()
  const book = f.page.state.books[0]
  let writes = 0
  f.page.request = async () => { writes++; throw Object.assign(new Error('timeout'), { ambiguousWrite: true }) }
  f.page.openStatus(book)
  f.page.cancelStatus()
  assert.equal(writes, 0)
  f.page.openStatus(book)
  await f.page.submitStatus(1)
  assert.equal(f.page.state.writeUncertain, true)
  await f.page.submitStatus(1)
  assert.equal(writes, 1)
  assert.ok(persisted.has('pending-status-v1'))
})

test('home uses the hidden header area and centers the reading-only counter', () => {
  const { page } = fixture()
  page.state.total = 12
  page.render()
  const image = page.state.widgets.find(widget => widget.type === 'image')
  assert.equal(image.options.y, 64)
  assert.ok(page.state.widgets.some(widget => widget.options.text === '1 / 12' && widget.options.align_h === 2))
  assert.ok(!page.state.widgets.some(widget => ['‹', '›'].includes(widget.options.text)))
})

test('Want to Read footer Load more occupies the same safe-area hit target as the home action', () => {
  const { page } = fixture()
  page.state.groups = { 2: page.state.books, 1: [{ userBookId: 12, title: 'Want book', author: 'Author', statusId: 1 }], 3: [] }
  page.state.counts = { 2: 1, 1: 11, 3: 0 }
  page.switchSection(1)
  const footerAction = page.state.widgets.find(widget => widget.options?.type === undefined &&
    widget.options?.click_func && widget.options?.x === 0 && widget.options?.y === 365)
  assert.ok(footerAction)
  assert.equal(footerAction.options.w, 390)
  assert.equal(footerAction.options.h, 85)
  const list = page.state.widgets.find(widget => widget.type === 'view')
  assert.equal(list.options.h, 297)
  let loadedStatus = null
  page.loadNextPage = statusId => { loadedStatus = statusId }
  clickLabel(page, 'Load more')
  assert.equal(loadedStatus, 1)
})

test('percentage wheel initial rounding caps at 100 and initializes the wheel state safely', () => {
  const { page } = fixture()
  page.state.books[0].percentage = 99.99
  page.state.mode = 'percentage'
  page.edit()
  assert.equal(page.state.input, '100')
   assert.ok(page.state.wheelSurface)
})

test('evicted covers can be downloaded again during the same watch session', async () => {
  persisted.clear(); files.clear()
  const { page } = fixture()
  for (let n = 0; n < 25; n++) {
    const name = `cover-cache-${n}.png`
    files.add(`download/${name}`)
    page.onReceivedFile({ readyState: 'transferred', fileName: name, params: { kind: 'cover', coverKey: `cache-${n}` }, on() {} })
  }
  const keys = Object.keys(persisted.get('cover-cache-v1'))
  assert.equal(keys.length, 24)
  const evicted = Array.from({ length: 25 }, (_, n) => `cache-${n}`).find(key => !keys.includes(key))
  page.state.books[0].coverKey = evicted
  let requests = 0
  page.request = async () => { requests++; return { ok: true } }
  await page.loadCover()
  assert.equal(requests, 1)
})

test('cache hit repaints after refresh clears in-memory image paths', async () => {
  persisted.clear(); files.clear()
  const { page } = fixture()
  files.add('download/cover-cache-hit.png')
  persisted.set('cover-cache-v1', { 'acct-cover-8': { src: 'data://download/cover-cache-hit.png', fsPath: 'download/cover-cache-hit.png' } })
  page.render()
  page.request = async () => { throw new Error('Cache hit must not request a download') }
  await page.loadCover()
  assert.equal(page.state.widgets.find(widget => widget.type === 'image').options.src, 'data://download/cover-cache-hit.png')
})

test('destroyed page ignores a pending library pagination response', async () => {
  const { page } = fixture()
  page.state.total = 2; page.state.counts = { 2: 2 }
  page.state.groups = { 2: page.state.books.slice() }
  let finish
  page.request = () => new Promise(resolve => { finish = resolve })
  const pending = page.loadNextPage()
  page.onDestroy()
  finish({ ok: true, books: [{ userBookId: 9, statusId: 2 }] })
  await pending
  assert.equal(page.state.books.length, 1)
})

test('home and status-list gestures are distinct; lists never request covers and Read shows personal rating', async () => {
  const f = fixture()
  const calls = []
  f.page.request = async ({ method, params }) => {
    calls.push([method, params])
    if (method === 'library') return { ok: true, total: 4, counts: { 2: 2, 1: 1, 3: 1 }, accountKey: 'account', groups: {
      2: [{ userBookId: 8, title: 'Reading one', statusId: 2, hasCover: true, coverKey: 'read-1' }, { userBookId: 9, title: 'Reading two', statusId: 2, hasCover: true, coverKey: 'read-2' }],
      1: [{ userBookId: 10, title: 'Waiting book', statusId: 1, hasCover: true, coverKey: 'want-cover' }],
      3: [{ userBookId: 11, title: 'Finished book', statusId: 3, rating: 4.5, hasCover: true, coverKey: 'read-cover' }]
    } }
    return { ok: true, queued: true }
  }
  f.page.build()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls.filter(([, params]) => params.all).length, 1)
  assert.equal(f.page.state.total, 2)
  const widgetsBeforeSwipe = f.page.state.widgets.length
  const modesBeforeSwipe = f.scrollModes().length
  f.swiperOptions().options.modeParams.on_page(1)
  assert.equal(f.page.book().title, 'Reading two')
  assert.equal(f.page.state.widgets.length, widgetsBeforeSwipe)
  assert.equal(f.scrollModes().length, modesBeforeSwipe)
  f.gesture(1)
  assert.equal(f.page.state.viewIndex, 1)
  assert.ok(f.page.state.widgets.some(widget => widget.type === 'view'))
  assert.ok(!f.page.state.widgets.some(widget => widget.type === 'image'))
  f.gesture(1)
  assert.equal(f.page.state.viewIndex, 2)
  assert.ok(f.page.state.widgets.find(widget => widget.type === 'view').children.some(widget => widget.options?.text === 'Your rating: 4.5/5'))
  assert.deepEqual(calls.filter(([method]) => method === 'cover').map(([, params]) => params.userBookId), [8, 9])
  f.gesture(2)
  assert.equal(f.page.state.viewIndex, 1)
  f.gesture(2)
  assert.equal(f.page.state.viewIndex, 0)
  assert.equal(f.gesture(2), false)
})

test('loading shows a watch-side indicator, retries only as an error action, and clears timers on exit', async () => {
  const f = fixture()
  persisted.clear()
  let resolveRequest
  f.page.request = () => new Promise(resolve => { resolveRequest = resolve })
  f.page.build()
  assert.ok(f.page.state.widgets.some(widget => widget.options?.text === 'Loading'))
  assert.ok(f.timers.size > 0)
  f.page.onDestroy()
  assert.equal(f.timers.size, 0)
  assert.equal(f.offGestureCalls(), 1)
  assert.equal(f.page.state.widgets.some(widget => widget.options?.text === 'Refresh'), false)
  resolveRequest({ ok: true, groups: {}, counts: {}, total: 0 })
})

test('phone errors replace the loading indicator and expose an explicit retry action', async () => {
  const { page } = fixture()
  let attempts = 0
  page.request = async () => { attempts++; return { ok: false, error: 'Phone disconnected.' } }
  await page.load()
  assert.equal(page.state.message, 'Phone disconnected.')
  const retry = page.state.widgets.find(widget => widget.options?.text === 'Retry')
  assert.ok(retry)
  retry.options.click_func()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(attempts, 3)
})

test('success notice is nonblocking and its timer is canceled when page is destroyed', () => {
  const { page, timers } = fixture()
  page.showSavedNotice()
  assert.ok(page.state.widgets.some(widget => widget.options.text === 'Saved'))
  assert.ok(!page.state.widgets.some(widget => widget.options.text === 'Retry'))
  const timerId = page.state.noticeTimer
  assert.ok(timerId > 0)
  assert.equal(timers.get(timerId).delay, 2000)
  timers.get(timerId).callback()
  assert.equal(page.state.notice, '')
  assert.ok(!page.state.widgets.some(widget => widget.options.text === 'Saved'))
  page.showSavedNotice()
  const pendingId = page.state.noticeTimer
  page.onDestroy()
  assert.equal(page.state.noticeTimer, null)
  assert.equal(page.state.notice, 'Progress saved to Hardcover.')
  assert.equal(timers.has(pendingId), false)
})

test('returning from lists preserves the current reading book and list scroll offsets', () => {
  const { page } = fixture()
  page.state.groups = { 2: [
    { userBookId: 8, statusId: 2, hasCover: false },
    { userBookId: 9, statusId: 2, hasCover: false }
  ], 1: [{ userBookId: 10, statusId: 1, title: 'Waiting' }] }
  page.state.books = page.state.groups[2]
  page.state.counts = { 2: 2, 1: 1 }
  page.move(1)
  page.switchSection(1)
  const list = page.state.widgets.find(widget => widget.type === 'view')
  list.options.scroll_frame_func({ yoffset: -90 })
  page.render()
  assert.equal(page.state.widgets.find(widget => widget.type === 'view').options.pos_y, -90)
  page.switchSection(0)
  assert.equal(page.book().userBookId, 9)
})
