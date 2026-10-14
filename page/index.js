import * as ui from '@zos/ui'
import { setTimeout as setWatchTimeout, clearTimeout as clearWatchTimeout } from '@zos/timer'
import { setPageBrightTime } from '@zos/display'
import { BasePage } from '@zeppos/zml/base-page'
import { onGesture, offGesture, GESTURE_LEFT, GESTURE_RIGHT, GESTURE_UP, GESTURE_DOWN } from '@zos/interaction'
import { LocalStorage } from '@zos/storage'
import { statSync, rmSync } from '@zos/fs'
import { visuals } from './visuals.js'
import { SECTIONS, PAGE_SIZE, progressValue, validateEntry, localCoverPath, stepProgress } from '../shared/watch-model.js'

const coverStorage = new LocalStorage()
const COVER_INDEX = 'cover-cache-v1'
const LIBRARY_CACHE = 'library-cache-v1'
const PENDING_WRITE = 'pending-progress-v1'
const PENDING_STATUS = 'pending-status-v1'
const MAX_COVERS = 24
const MAX_CACHED_BOOKS = 200
const CACHE_TTL = 24 * 60 * 60 * 1000
const NOTICE_DURATION = 2000
const LOADING_ACCENT = 0xeeb45f
const LOADING_PANEL = 0x24303d

Page(BasePage({
  ...visuals,
  state: {
     books: [], groups: {}, counts: {}, total: 0, selected: 0, readingSelected: 0, viewIndex: 0, listOffsets: {},
    busy: false, syncing: false, screen: 'library', message: '', retryKind: null, mode: 'pages', input: '',
    covers: {}, coverStates: {}, coverTimers: {}, widgets: [], generation: 0, alive: true,
     loadingTimer: null, loadingWidget: null, loadingDots: [], loadingFrame: 0,
      wheelTouchY: null, wheelRows: [], wheelSurface: null,
      noticeTimer: null, noticeId: 0, notice: '', cachedOffline: false, lastConfirmedWrite: 0,
      accountKey: null, writeUncertain: false, syncGeneration: 0, selectedBookId: null, cacheSavedAt: 0,
      statusBook: null, statusReturnView: 0
  },
  build() {
    if (typeof ui.setStatusBarVisible === 'function') ui.setStatusBarVisible(false)
    this.restoreCoverCache()
    const restored = this.restoreLibraryCache()
    const pending = coverStorage.getItem(PENDING_WRITE, null)
    const pendingStatus = coverStorage.getItem(PENDING_STATUS, null)
    this.state.writeUncertain = [pending, pendingStatus].some(item => item?.version === 1 &&
      Number.isFinite(item.savedAt) && Date.now() >= item.savedAt && Date.now() - item.savedAt <= CACHE_TTL)
    this.render()
    this.load({ background: restored })
    onGesture({ callback: event => this.handleGesture(event) })
    setPageBrightTime({ brightTime: 120000 })
  },
  onDestroy() {
    this.state.alive = false
    this.state.generation++
    Object.values(this.state.coverTimers).forEach(timer => clearWatchTimeout(timer))
    this.stopLoadingAnimation()
    this.clearNoticeTimer()
    this.state.noticeId++
    offGesture()
  },
  onCall(data) {
    if (data?.method === 'invalidate-library') {
      this.invalidateLibraryCache()
      this.state.screen = 'library'
      this.state.message = ''
      this.state.retryKind = null
      this.state.busy = false
      this.state.syncing = false
      this.state.generation++
      if (this.state.alive) this.load()
    }
  },
  restoreCoverCache() {
    const index = coverStorage.getItem(COVER_INDEX, {}) || {}
    Object.keys(index).forEach(key => {
      const entry = index[key]
      if (this.validCoverEntry(entry) && this.coverFileExists(entry.fsPath)) this.state.covers[key] = entry.src
      else { delete index[key] }
    })
    coverStorage.setItem(COVER_INDEX, index)
  },
  validCoverEntry(entry) {
    const match = /^data:\/\/download\/(cover-[a-zA-Z0-9-]+\.png)$/.exec(String(entry?.src || ''))
    return Boolean(match && entry.fsPath === `download/${match[1]}`)
  },
  validCachedBook(book, statusId) {
    return Boolean(book && typeof book === 'object' && typeof book.userBookId === 'string' &&
      book.userBookId.length > 0 && book.userBookId.length <= 64 &&
      typeof book.title === 'string' && book.title.length <= 500 && Number(book.statusId) === statusId &&
      (book.author === undefined || typeof book.author === 'string') &&
      (book.currentPage === null || book.currentPage === undefined || Number.isFinite(book.currentPage)) &&
      (book.totalPages === null || book.totalPages === undefined || Number.isFinite(book.totalPages)) &&
      (book.percentage === null || book.percentage === undefined || Number.isFinite(book.percentage)) &&
      (book.rating === null || book.rating === undefined || Number.isFinite(book.rating)))
  },
  restoreLibraryCache() {
    const cache = coverStorage.getItem(LIBRARY_CACHE, null)
    if (!cache || cache.version !== 1 || typeof cache.accountKey !== 'string' ||
        !Number.isFinite(cache.savedAt) || Date.now() - cache.savedAt > CACHE_TTL || Date.now() < cache.savedAt ||
        !cache.counts || typeof cache.counts !== 'object' || !cache.groups || typeof cache.groups !== 'object') {
      coverStorage.removeItem(LIBRARY_CACHE)
      return false
    }
    const groups = {}
    let count = 0
    for (const section of SECTIONS) {
      const statusId = section.statusId
      const rows = cache.groups[statusId]
      const total = cache.counts[statusId]
      if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0 || rows.length > total ||
          rows.length > MAX_CACHED_BOOKS || rows.some(book => !this.validCachedBook(book, statusId))) {
        coverStorage.removeItem(LIBRARY_CACHE)
        return false
      }
      groups[statusId] = rows.slice(0, Math.max(0, MAX_CACHED_BOOKS - count))
      count += groups[statusId].length
    }
    if (!count || count > MAX_CACHED_BOOKS) {
      coverStorage.removeItem(LIBRARY_CACHE)
      return false
    }
    this.state.groups = groups
    this.state.counts = { 2: cache.counts[2], 1: cache.counts[1], 3: cache.counts[3] }
    this.state.accountKey = cache.accountKey
    this.state.cacheSavedAt = cache.savedAt
    this.state.viewIndex = Number.isInteger(cache.viewIndex) && cache.viewIndex >= 0 && cache.viewIndex < SECTIONS.length ? cache.viewIndex : 0
    this.state.readingSelected = Number.isInteger(cache.readingSelected) && cache.readingSelected >= 0
      ? Math.min(cache.readingSelected, Math.max(0, groups[2].length - 1)) : 0
    this.state.selected = this.state.viewIndex === 0 ? this.state.readingSelected : 0
    this.state.books = groups[SECTIONS[this.state.viewIndex].statusId]
    this.state.total = this.state.counts[SECTIONS[this.state.viewIndex].statusId]
    this.state.selectedBookId = groups[2][this.state.readingSelected]?.userBookId ?? null
    this.state.listOffsets = {}
    for (const section of SECTIONS) {
      const offset = Number(cache.listOffsets?.[section.statusId])
      this.state.listOffsets[section.statusId] = Number.isFinite(offset) ? Math.max(-100000, Math.min(0, offset)) : 0
    }
    this.state.cachedOffline = true
    return true
  },
  persistLibraryCache() {
    if (!this.state.accountKey) return
    const groups = {}
    let remaining = MAX_CACHED_BOOKS
    for (const section of SECTIONS) {
      const statusId = section.statusId
      const rows = (this.state.groups[statusId] || []).slice(0, remaining)
      groups[statusId] = rows.map(book => ({
        userBookId: String(book.userBookId), title: String(book.title || 'Untitled').slice(0, 500),
        author: String(book.author || '').slice(0, 300), statusId,
        currentPage: Number.isFinite(book.currentPage) ? book.currentPage : null,
        totalPages: Number.isFinite(book.totalPages) ? book.totalPages : null,
        percentage: Number.isFinite(book.percentage) ? book.percentage : null,
        rating: Number.isFinite(book.rating) ? book.rating : null,
        hasCover: Boolean(book.hasCover), coverKey: typeof book.coverKey === 'string' ? book.coverKey : null
      }))
      remaining -= rows.length
    }
    coverStorage.setItem(LIBRARY_CACHE, {
      version: 1, accountKey: this.state.accountKey, savedAt: this.state.cacheSavedAt || Date.now(), groups,
      counts: { 2: this.state.counts[2] || 0, 1: this.state.counts[1] || 0, 3: this.state.counts[3] || 0 },
      readingSelected: this.state.readingSelected, viewIndex: this.state.viewIndex,
      selectedBookId: this.state.selectedBookId,
      listOffsets: this.state.listOffsets
    })
  },
  invalidateLibraryCache() {
    coverStorage.removeItem(LIBRARY_CACHE)
    coverStorage.removeItem(PENDING_WRITE)
    this.state.writeUncertain = false
    const index = coverStorage.getItem(COVER_INDEX, {}) || {}
    Object.values(index).forEach(entry => this.removeCachedFile(entry?.fsPath))
    coverStorage.setItem(COVER_INDEX, {})
    coverStorage.removeItem('cover-account-v1')
    Object.values(this.state.coverTimers).forEach(timer => clearWatchTimeout(timer))
    this.state.coverTimers = {}
    this.state.covers = {}
    this.state.coverStates = {}
    this.state.groups = { 2: [], 1: [], 3: [] }
    this.state.books = []
    this.state.counts = { 2: 0, 1: 0, 3: 0 }
    this.state.total = 0
    this.state.selected = 0
    this.state.readingSelected = 0
    this.state.selectedBookId = null
    this.state.accountKey = null
    this.state.cacheSavedAt = 0
    this.state.cachedOffline = false
    this.state.screen = 'library'
    this.render()
  },
  coverFileExists(path) {
    if (typeof path !== 'string' || !/^download\/cover-[a-zA-Z0-9-]+\.png$/.test(path)) return false
    try { return statSync({ path })?.size > 0 } catch (_) { return false }
  },
  removeCachedFile(path) {
    if (typeof path === 'string' && /^download\/cover-[a-zA-Z0-9-]+\.png$/.test(path)) {
      try { rmSync({ path }) } catch (_) {}
    }
  },
  onReceivedFile(file) {
    const accept = () => {
      if (!this.state.alive || file.params?.kind !== 'cover') return
      const expectedAccount = coverStorage.getItem('cover-account-v1', null)
      if (expectedAccount && file.params.accountKey && file.params.accountKey !== expectedAccount) return
      const path = localCoverPath(file)
      const key = String(file.params.coverKey || file.params.userBookId)
      if (path) {
        if (this.state.coverTimers[key]) clearWatchTimeout(this.state.coverTimers[key])
        delete this.state.coverTimers[key]
        this.state.covers[key] = path
        this.state.coverStates[key] = 'ready'
        this.applyCover(key, path)
        const name = String(file.fileName).split('/').pop()
        const index = coverStorage.getItem(COVER_INDEX, {}) || {}
        index[key] = { src: path, fsPath: `download/${name}`, used: Date.now() }
        const stale = Object.entries(index).sort((a, b) => (Number(a[1]?.used) || 0) - (Number(b[1]?.used) || 0)).slice(0, Math.max(0, Object.keys(index).length - MAX_COVERS))
         stale.forEach(([oldKey, entry]) => {
           this.removeCachedFile(entry?.fsPath)
           delete index[oldKey]; delete this.state.covers[oldKey]; delete this.state.coverStates[oldKey]
         })
        coverStorage.setItem(COVER_INDEX, index)
      } else if (['error', 'canceled'].includes(file.readyState)) {
        if (this.state.coverTimers[key]) clearWatchTimeout(this.state.coverTimers[key])
        delete this.state.coverTimers[key]
        this.state.coverStates[key] = 'unavailable'
        if (!this.state.coverImages && this.state.screen === 'library') this.render()
      }
    }
    file.on('change', accept)
    accept()
  },
  book() { return this.state.books[this.state.selected] },
  wheelText(value) {
    if (this.state.mode === 'percentage') return `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}%`
    return String(value)
  },
  wheelValues() {
    const book = this.book()
    const total = this.state.mode === 'pages' ? (book.totalPages || 99999) : 1000
    const step = this.state.mode === 'percentage' ? 0.1 : 1
    const current = this.state.mode === 'percentage'
      ? Math.min(100, Math.max(0, Math.round((Number(this.state.input) || 0) * 10) / 10))
      : Math.min(total, Math.max(0, Math.floor(Number(this.state.input) || 0)))
    return [Math.max(0, current - step), current, Math.min(this.state.mode === 'percentage' ? 100 : total, current + step)]
  },
  updateWheel(steps) {
    const book = this.book()
    this.state.input = stepProgress(this.state.input, this.state.mode, book.totalPages, steps)
    const values = this.wheelValues()
     this.state.wheelRows.forEach((row, index) => row.setProperty(ui.prop.TEXT,
       index !== 1 && values[index] === values[1] ? '' : this.wheelText(values[index])))
  },
  async rpc(method, params) {
    let result
    try { result = await this.request({ method, params }, { timeout: 45000 }) }
    catch (_) {
      const error = new Error(method === 'status'
        ? 'Could not confirm the status change. Reopen the library to verify it before trying again.'
        : 'Could not confirm the request with the phone. Reopen the library and verify progress before trying again.')
      error.ambiguousWrite = ['progress', 'status'].includes(method)
      throw error
    }
    if (!result?.ok) {
      const error = new Error(result?.error || 'Phone unavailable. Open Zepp and retry.')
      error.responseError = true
      error.ambiguousWrite = Boolean(result?.ambiguous)
      throw error
    }
    return result
  },
  async load({ background = false } = {}) {
    const generation = ++this.state.generation
    let selectedBookId = this.state.viewIndex === 0 ? this.book()?.userBookId : this.state.selectedBookId
    this.state.syncing = true
    this.state.busy = !background
    this.state.message = ''
    this.render()
    try {
      const result = await this.rpc('library', { all: true })
      if (!this.state.alive || generation !== this.state.generation) return
      if (this.state.accountKey && result.accountKey && this.state.accountKey !== result.accountKey) {
        this.invalidateLibraryCache()
        this.state.viewIndex = 0
        selectedBookId = null
      }
      this.state.groups = {}
      Object.assign(this.state.groups, result.groups || {})
      this.state.counts = result.counts || {}
      this.setCoverAccount(result.accountKey)
      this.state.accountKey = result.accountKey || this.state.accountKey
      this.state.cacheSavedAt = Date.now()
      const readingBooks = this.state.groups[2] || []
      const preservedIndex = readingBooks.findIndex(book => String(book.userBookId) === String(selectedBookId))
      if (selectedBookId && preservedIndex < 0 && this.state.readingSelected >= readingBooks.length) {
        // When the selected record is beyond the first batch, restore only the
        // bounded prefix needed to reach it; the rest of the library stays lazy.
        for (let offset = readingBooks.length; offset <= this.state.readingSelected && offset < MAX_CACHED_BOOKS; offset += PAGE_SIZE) {
          const page = await this.rpc('library', { statusId: 2, offset })
          if (!this.state.alive || generation !== this.state.generation) return
          readingBooks.push(...(page.books || []))
          const match = readingBooks.findIndex(book => String(book.userBookId) === String(selectedBookId))
          if (match >= 0) { this.state.selected = match; this.state.readingSelected = match; break }
          if (!(page.books || []).length) break
        }
        this.state.groups[2] = readingBooks.slice(0, MAX_CACHED_BOOKS)
      }
      const restoredIndex = readingBooks.findIndex(book => String(book.userBookId) === String(selectedBookId))
      this.state.selected = restoredIndex >= 0 ? restoredIndex
        : Math.min(this.state.readingSelected, Math.max(0, readingBooks.length - 1))
      this.state.readingSelected = this.state.selected
      this.state.selectedBookId = readingBooks[this.state.selected]?.userBookId ?? null
      const statusId = SECTIONS[this.state.viewIndex].statusId
      this.state.books = this.state.groups[statusId] || []
      this.state.total = this.state.counts[statusId] || 0
      this.persistLibraryCache()
      this.state.cachedOffline = false
      this.state.message = ''
      this.state.retryKind = null
      coverStorage.removeItem(PENDING_WRITE)
      coverStorage.removeItem(PENDING_STATUS)
      this.state.writeUncertain = false
    } catch (error) {
      if (!this.state.alive || generation !== this.state.generation) return
      const authFailure = /invalid|authentication failed/i.test(error.message)
      if (authFailure) this.invalidateLibraryCache()
      this.state.message = this.state.cachedOffline
        ? 'Offline — showing saved library.' : error.message
      this.state.retryKind = this.state.cachedOffline ? null : 'library'
    } finally {
      if (this.state.alive && generation === this.state.generation) {
        this.state.busy = false
        this.state.syncing = false
        this.render()
        if (this.state.viewIndex === 0) this.loadCover()
      }
    }
  },
  setCoverAccount(accountKey) {
    if (!accountKey) return
    const old = coverStorage.getItem('cover-account-v1', null)
    if (old && old !== accountKey) {
      const index = coverStorage.getItem(COVER_INDEX, {}) || {}
      Object.values(index).forEach(entry => this.removeCachedFile(entry?.fsPath))
      coverStorage.setItem(COVER_INDEX, {})
      Object.values(this.state.coverTimers).forEach(timer => clearWatchTimeout(timer))
      this.state.coverTimers = {}
      this.state.covers = {}
      this.state.coverStates = {}
    }
    coverStorage.setItem('cover-account-v1', accountKey)
  },
  async loadCover() {
    if (this.state.viewIndex !== 0) return
    const book = this.book()
    if (!book?.hasCover) return
    const key = String(book.coverKey || book.userBookId)
    const cached = coverStorage.getItem(COVER_INDEX, {})?.[key]
    if (cached) {
      if (this.validCoverEntry(cached) && this.coverFileExists(cached.fsPath)) {
        cached.used = Date.now()
        const index = coverStorage.getItem(COVER_INDEX, {}) || {}
        index[key] = cached; coverStorage.setItem(COVER_INDEX, index)
         this.state.covers[key] = cached.src; this.state.coverStates[key] = 'ready'
         if (this.state.alive && this.state.screen === 'library') this.applyCover(key, cached.src)
         return
      }
      delete this.state.covers[key]
      delete this.state.coverStates[key]
      const index = coverStorage.getItem(COVER_INDEX, {}) || {}
      delete index[key]
      coverStorage.setItem(COVER_INDEX, index)
    }
    if (this.state.coverStates[key]) return
    this.state.coverStates[key] = 'loading'
    if (!this.state.coverImages) this.render()
    try {
      await this.rpc('cover', { userBookId: book.userBookId })
      // File transfer finishes independently of the request response.
      if (this.state.alive && this.state.coverStates[key] === 'loading') {
        this.state.coverTimers[key] = setWatchTimeout(() => {
          delete this.state.coverTimers[key]
          if (!this.state.alive || this.state.coverStates[key] === 'ready') return
          this.state.coverStates[key] = 'unavailable'
          if (!this.state.coverImages && this.state.screen === 'library') this.render()
        }, 60000)
      }
    } catch (_) {
      if (!this.state.alive) return
      this.state.coverStates[key] = 'unavailable'
      if (!this.state.coverImages && this.state.screen === 'library') this.render()
    }
  },
  move(direction) {
    if (this.state.viewIndex !== 0) return
    const index = this.state.selected + direction
    if (index >= 0 && index < this.state.books.length) {
       this.state.selected = index
       this.state.readingSelected = index
       this.state.selectedBookId = this.book()?.userBookId ?? null
       this.persistLibraryCache()
      this.state.message = ''
      this.render()
      this.loadCover()
    } else if (direction > 0 && this.state.books.length < this.state.total) this.loadNextPage(2)
  },
  handleGesture(event) {
    if (event === GESTURE_RIGHT && this.state.screen === 'library' && this.state.viewIndex === 0) return false
    if (this.state.busy) return true
    if (this.state.screen !== 'library') return true
    if (event === GESTURE_LEFT) {
      if (this.state.viewIndex < SECTIONS.length - 1) { this.switchSection(this.state.viewIndex + 1); return true }
      return false
    }
    if (event === GESTURE_RIGHT) {
      if (this.state.viewIndex > 0) { this.switchSection(this.state.viewIndex - 1); return true }
      return false
    }
    // The native SWIPER owns vertical movement on Currently Reading; leave
    // these gestures unconsumed so it can change cards rather than intercepting
    // a drag as a one-step controller command.
    if (this.state.viewIndex === 0 && (event === GESTURE_UP || event === GESTURE_DOWN)) return false
    return false
  },
  switchSection(index) {
    this.state.viewIndex = index
    const statusId = SECTIONS[index].statusId
    this.state.books = this.state.groups[statusId] || []
    this.state.total = this.state.counts[statusId] || 0
     this.state.selected = index === 0 ? this.state.readingSelected : 0
    this.state.message = ''
    this.state.retryKind = null
    this.persistLibraryCache()
    this.render()
    if (index === 0) this.loadCover()
  },
  async loadNextPage(statusId = SECTIONS[this.state.viewIndex].statusId) {
    const generation = this.state.generation
    const have = (this.state.groups[statusId] || []).length
    if (have >= (this.state.counts[statusId] || 0)) return
    this.state.busy = true
    this.state.message = ''
    this.render()
    try {
      const result = await this.rpc('library', { statusId, offset: have })
      if (!this.state.alive || generation !== this.state.generation) return
      const batch = result.books || []
      this.state.groups[statusId] = [...(this.state.groups[statusId] || []), ...batch]
      this.state.cacheSavedAt = Date.now()
      this.persistLibraryCache()
      if (this.state.viewIndex === SECTIONS.findIndex(section => section.statusId === statusId)) this.state.books = this.state.groups[statusId]
      this.state.total = this.state.counts[statusId] || 0
       if (this.state.viewIndex === 0 && batch.length) {
         this.state.selected = Math.max(0, this.state.books.length - batch.length)
         this.state.readingSelected = this.state.selected
       }
      this.state.retryKind = null
    } catch (error) {
      if (!this.state.alive || generation !== this.state.generation) return
      this.state.message = error.message
      this.state.retryKind = 'page'
    } finally {
      if (this.state.alive && generation === this.state.generation) {
        this.state.busy = false
        this.render()
        if (this.state.viewIndex === 0) this.loadCover()
      }
    }
  },
  edit() {
    if (this.book().statusId !== 2) {
      this.state.message = 'Start this book in Hardcover first. Only Currently Reading books can be updated.'
      this.render()
      return
    }
    this.state.screen = 'edit'
    this.state.message = ''
    this.state.input = progressValue(this.book(), this.state.mode)
    this.render()
  },
  openStatus(book) {
    if (!book || ![1, 2, 3].includes(book.statusId) || book.userBookId == null || this.state.busy) return false
    this.state.statusBook = { ...book }
    this.state.statusReturnView = this.state.viewIndex
    this.state.screen = 'status'
    this.state.message = ''
    this.render()
    return true
  },
  cancelStatus() {
    if (this.state.screen !== 'status' || this.state.busy) return
    this.state.statusBook = null
    this.state.screen = 'library'
    this.state.message = ''
    this.render()
  },
  applyConfirmedStatus(book, updated) {
    const userBookId = String(book.userBookId)
    const oldStatusId = book.statusId
    const statusId = updated.statusId
    const wasInOldGroup = (this.state.groups[oldStatusId] || []).some(row => String(row.userBookId) === userBookId)
    const wasInNewGroup = (this.state.groups[statusId] || []).some(row => String(row.userBookId) === userBookId)
    for (const section of SECTIONS) {
      this.state.groups[section.statusId] = (this.state.groups[section.statusId] || [])
        .filter(row => String(row.userBookId) !== userBookId)
    }
    const movedBook = { ...book, ...updated, statusId }
    if (oldStatusId !== statusId) {
      if (wasInOldGroup) this.state.counts[oldStatusId] = Math.max(0, (this.state.counts[oldStatusId] || 0) - 1)
      if (!wasInNewGroup) this.state.counts[statusId] = (this.state.counts[statusId] || 0) + 1
    }
    if (!wasInNewGroup || oldStatusId !== statusId) {
      this.state.groups[statusId] = [movedBook, ...(this.state.groups[statusId] || [])].slice(0, PAGE_SIZE)
    } else {
      this.state.groups[statusId] = [movedBook, ...(this.state.groups[statusId] || [])]
    }
    if (oldStatusId === 2 && oldStatusId !== statusId && String(this.state.selectedBookId) === userBookId) {
      const reading = this.state.groups[2]
      this.state.selected = Math.min(this.state.selected, Math.max(0, reading.length - 1))
      this.state.readingSelected = this.state.selected
      this.state.selectedBookId = reading[this.state.selected]?.userBookId ?? null
    }
    const activeStatus = SECTIONS[this.state.viewIndex].statusId
    this.state.books = this.state.groups[activeStatus] || []
    this.state.total = this.state.counts[activeStatus] || 0
    this.state.selected = this.state.viewIndex === 0
      ? Math.min(this.state.selected, Math.max(0, this.state.books.length - 1)) : 0
    this.persistLibraryCache()
  },
  async submitStatus(statusId) {
    if (this.state.busy || this.state.screen !== 'status' || !this.state.statusBook) return
    const book = this.state.statusBook
    if (![1, 2, 3].includes(statusId)) {
      this.state.message = 'Choose Currently Reading, Want to Read, or Read.'
      this.render()
      return
    }
    if (this.state.writeUncertain) {
      this.state.message = 'The previous change could not be confirmed. Reopen the library to verify it before trying again.'
      this.render()
      return
    }
    if (statusId === book.statusId) {
      this.cancelStatus()
      return
    }
    this.state.busy = true
    this.state.generation++
    this.state.syncing = false
    this.state.message = ''
    const writeGeneration = this.state.generation
    coverStorage.setItem(PENDING_STATUS, {
      version: 1, savedAt: Date.now(), userBookId: String(book.userBookId),
      fromStatusId: book.statusId, toStatusId: statusId, accountKey: this.state.accountKey
    })
    this.render()
    try {
      const result = await this.rpc('status', { userBookId: book.userBookId, statusId })
      if (!this.state.alive) return
      if (writeGeneration !== this.state.generation) return
      if (!result.book || String(result.book.userBookId) !== String(book.userBookId) || result.book.statusId !== statusId) {
        const error = new Error('Could not confirm the status change. Reopen the library to verify it before trying again.')
        error.ambiguousWrite = true
        throw error
      }
      this.applyConfirmedStatus(book, result.book)
      this.state.screen = 'library'
      this.state.statusBook = null
      this.state.writeUncertain = false
      this.state.cachedOffline = false
      this.state.message = ''
      coverStorage.removeItem(PENDING_STATUS)
      this.showNotice('Book status updated.')
      this.state.busy = false
      // A move changes server ordering and page offsets. Refresh the first
      // bounded batches in the background so subsequent Load more offsets stay valid.
      await this.load({ background: true })
    } catch (error) {
      if (!this.state.alive) return
      this.state.writeUncertain = Boolean(error.ambiguousWrite)
      if (!this.state.writeUncertain) coverStorage.removeItem(PENDING_STATUS)
      this.state.message = error.ambiguousWrite
        ? 'Could not confirm the status change. Reopen the library to verify it before trying again.'
        : error.message
      this.state.screen = 'status'
    } finally {
      if (this.state.alive) { this.state.busy = false; this.render() }
    }
  },
  scheduleLoadingTick() {
    if (this.state.loadingTimer !== null || !this.state.busy || !this.state.alive) return
    this.state.loadingTimer = setWatchTimeout(() => {
      this.state.loadingTimer = null
      if (!this.state.busy || !this.state.alive) return
       this.state.loadingFrame = (this.state.loadingFrame + 1) % 3
        this.state.loadingDots.forEach((dot, index) => dot.setProperty(ui.prop.COLOR, index === this.state.loadingFrame ? LOADING_ACCENT : LOADING_PANEL))
      this.scheduleLoadingTick()
    }, 450)
  },
  stopLoadingAnimation() {
    if (this.state.loadingTimer !== null) clearWatchTimeout(this.state.loadingTimer)
    this.state.loadingTimer = null
     this.state.loadingWidget = null
     this.state.loadingDots = []
  },
  setMode(mode) {
    this.state.mode = mode
    this.state.input = progressValue(this.book(), mode)
    this.state.message = ''
    this.render()
  },
  clearNoticeTimer() {
    if (this.state.noticeTimer !== null) clearWatchTimeout(this.state.noticeTimer)
    this.state.noticeTimer = null
  },
  showSavedNotice() {
    this.showNotice('Progress saved to Hardcover.')
  },
  showNotice(message) {
    this.clearNoticeTimer()
    const noticeId = ++this.state.noticeId
    this.state.notice = message
    this.render()
    this.state.noticeTimer = setWatchTimeout(() => {
      this.state.noticeTimer = null
      if (!this.state.alive || noticeId !== this.state.noticeId) return
      this.state.notice = ''
      this.render()
    }, NOTICE_DURATION)
  },
  async submitProgress() {
    if (this.state.busy || this.state.screen !== 'edit') return
    if (this.state.writeUncertain) {
      this.state.message = 'The previous update could not be confirmed. Reopen the library to verify it before submitting again.'
      this.render()
      return
    }
    const book = this.book()
    let value
    try { value = validateEntry(book, this.state.mode, this.state.input) }
    catch (error) { this.state.message = error.message; this.render(); return }
    this.state.busy = true
    // A background response must not replace the edited book during a write.
    this.state.generation++
    this.state.syncing = false
    this.state.message = ''
    coverStorage.setItem(PENDING_WRITE, {
      version: 1, savedAt: Date.now(), userBookId: String(book.userBookId)
    })
    this.render()
    try {
      const result = await this.rpc('progress', { userBookId: book.userBookId, mode: this.state.mode, value: Number(value) })
      if (!this.state.alive) return
      if (!result.book || String(result.book.userBookId) !== String(book.userBookId)) {
        const error = new Error('Reopen the library to verify the saved progress before submitting again.')
        error.ambiguousWrite = true
        throw error
      }
      const index = this.state.books.findIndex(row => String(row.userBookId) === String(book.userBookId))
      if (index >= 0) this.state.books[index] = { ...this.state.books[index], ...result.book }
      this.state.groups[2] = this.state.books
      this.state.selected = index >= 0 ? index : this.state.selected
      this.state.readingSelected = this.state.selected
      this.state.lastConfirmedWrite = Date.now()
      this.state.cacheSavedAt = Date.now()
      this.state.writeUncertain = false
      this.state.generation++
      this.state.syncing = false
      this.persistLibraryCache()
      coverStorage.removeItem(PENDING_WRITE)
      this.state.screen = 'library'
      this.state.cachedOffline = false
      this.state.message = ''
      this.showSavedNotice()
    } catch (error) {
      if (!this.state.alive) return
      this.state.writeUncertain = Boolean(error.ambiguousWrite)
      if (!this.state.writeUncertain) coverStorage.removeItem(PENDING_WRITE)
      this.state.message = error.ambiguousWrite
        ? 'Could not confirm this update. Reopen the library and verify progress before trying again.'
        : error.message
      // Requests that time out may have reached Hardcover. Keep the editor open;
      // the UI must not offer an automatic or immediate duplicate write.
      this.state.screen = 'edit'
    } finally {
      if (this.state.alive) { this.state.busy = false; this.render() }
    }
  }
}))
