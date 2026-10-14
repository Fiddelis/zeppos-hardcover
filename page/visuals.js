import * as ui from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { setScrollMode, setScrollLock, scrollTo, swipeToIndex, SCROLL_MODE_FREE, SCROLL_MODE_SWIPER, SCROLL_ANIMATION_NONE } from '@zos/page'
import { createLayout } from './layout.js'
import { SECTIONS, progressLabel, ratingLabel, stepProgress } from '../shared/watch-model.js'

const { width, height } = getDeviceInfo()
const layout = createLayout(width, height)
const BACKGROUND = 0x101820
const WHITE = 0xffffff
const MUTED = 0xaeb8c4
const ACCENT = 0xeeb45f
const PANEL = 0x24303d
const INK = 0x111820
const FOOTER_Y = 365

// Rendering is kept separate from cache, network and lifecycle behavior.
export const visuals = {
  clearWidgets() {
    this.state.widgets.forEach(widget => ui.deleteWidget(widget))
    this.state.widgets = []
    this.state.loadingWidget = null
    this.state.loadingDots = []
    this.state.wheelRows = []
    this.state.wheelSurface = null
    this.state.coverImages = null
  },
  widget(type, options) {
    const widget = ui.createWidget(type, { ...options, y: (options.y || 0) + (this.state.renderOffset || 0) })
    this.state.widgets.push(widget)
    return widget
  },
  text(text, x, y, w, h, size = 22, color = WHITE, centered = false) {
    return this.widget(ui.widget.TEXT, {
      ...layout.rect(x, y, w, h), text, text_size: layout.font(size), color,
      text_style: ui.text_style.WRAP, align_v: ui.align.CENTER_V,
      ...(centered ? { align_h: ui.align.CENTER_H } : {})
    })
  },
  button(text, x, y, w, h, click, selected = false, size = 20, radius = 12) {
    return this.widget(ui.widget.BUTTON, {
      ...layout.rect(x, y, w, h), text, text_size: layout.font(size), radius: layout.font(radius),
      normal_color: selected ? ACCENT : PANEL, press_color: 0x606b77,
      color: selected ? INK : WHITE,
      click_func: () => { if (!this.state.busy) click() }
    })
  },
  heading(title) {
    this.text(title, 40, 16, 310, 40, 24, WHITE, true)
  },
  footer(text, action, counter = null) {
    this.button(counter ? '' : text, 0, FOOTER_Y, 390, 450 - FOOTER_Y, action, true, 24, 0)
    if (counter !== null) {
      this.text(text, 28, 374, 334, 38, 23, INK, true).setEnable(false)
      this.text(counter, 80, 420, 230, 24, 16, 0x394047, true).setEnable(false)
    }
  },
  render() {
    if (!this.state.alive) return
    this.clearWidgets()
    this.state.renderOffset = 0
    setScrollMode({ mode: SCROLL_MODE_FREE })
    scrollTo({ y: 0 })
    setScrollLock({ lock: true })
    this.widget(ui.widget.FILL_RECT, { ...layout.rect(0, 0, 390, 450), color: BACKGROUND })
    if (this.state.busy) { this.renderLoadingOverlay(); return }
    if (this.state.message && (this.state.retryKind || ['edit', 'status'].includes(this.state.screen))) {
      this.renderError()
      this.stopLoadingAnimation()
      return
    }
    if (this.state.screen === 'status') this.renderStatusEditor()
    else if (this.state.screen === 'edit') this.renderEditor()
    else if (this.state.viewIndex === 0) this.renderHome()
    else this.renderList()
    this.stopLoadingAnimation()
  },
  renderHome() {
    const selected = this.state.selected
    if (!this.state.books.length) { this.renderReadingCard(); return }
    // Unlocking resets Zepp's scroll mode to FREE. Unlock before selecting SWIPER.
    setScrollLock({ lock: false })
    setScrollMode({ mode: SCROLL_MODE_SWIPER, options: {
      height, count: this.state.books.length,
      modeParams: { on_page: index => {
        if (!this.state.alive || this.state.screen !== 'library' || this.state.viewIndex !== 0 || this.state.busy || this.state.restoringSwiper) return
        if (!Number.isInteger(index) || index < 0 || index >= this.state.books.length || index === this.state.selected) return
        this.state.selected = index
        this.state.readingSelected = index
        this.state.selectedBookId = this.book()?.userBookId ?? null
        this.persistLibraryCache()
        this.loadCover()
      } }
    } })
    this.state.coverImages = {}
    this.state.books.forEach((book, index) => {
      this.state.selected = index
      this.state.renderOffset = index * height
      this.widget(ui.widget.FILL_RECT, { ...layout.rect(0, 0, 390, 450), color: BACKGROUND })
      this.renderReadingCard(book, index)
    })
    this.state.selected = selected
    this.state.renderOffset = 0
    this.state.restoringSwiper = true
    swipeToIndex({ index: selected, animation: SCROLL_ANIMATION_NONE })
    this.state.restoringSwiper = false
  },
  renderReadingCard(book = this.book(), index = this.state.selected) {
    this.heading(SECTIONS[0].title)
    if (!book) {
      this.text('No books in Currently Reading.', 40, 144, 310, 116, 23, MUTED, true)
      this.text(`0 / ${this.state.total}`, 80, 414, 230, 28, 17, MUTED, true)
      return
    }
    const key = String(book.coverKey || book.userBookId)
    const path = this.state.covers[key]
    const select = () => { this.state.selected = index; this.state.readingSelected = index; this.openStatus(book) }
    const image = this.widget(ui.widget.IMG, { ...layout.rect(18, 64, 156, 220), src: path || 'cover-fallback.png', auto_scale: true })
    if (this.state.coverImages) this.state.coverImages[key] = image
    this.bindTap(image, select)
    this.bindTap(this.text(book.title, 194, 66, 174, 124, 24), select)
    this.text(book.author, 194, 198, 178, 78, 17, MUTED)
    if (!path) this.text(this.state.coverStates[key] === 'loading' ? 'Loading' : 'No cover', 18, 284, 156, 18, 14, MUTED, true)
    this.text(progressLabel(book), 18, 306, 354, 30, 22, ACCENT, true)
    const ratio = Number.isFinite(book.percentage) ? book.percentage / 100
      : book.totalPages ? (book.currentPage || 0) / book.totalPages : 0
    this.widget(ui.widget.FILL_RECT, { ...layout.rect(18, 340, 354, 4), color: PANEL })
    if (ratio > 0) this.widget(ui.widget.FILL_RECT, { ...layout.rect(18, 340, 354 * Math.min(1, ratio), 4), color: ACCENT })
    const notice = this.state.notice || (!this.state.retryKind ? this.state.message : '')
    if (notice) this.text(/^Progress saved/i.test(notice) ? 'Saved' : notice, 30, 346, 330, 18, 14, MUTED, true)
    this.scrollIndicator(this.state.books.length, 1, index, 110, 176)
    this.footer('Update progress', () => {
      this.state.selected = index; this.state.readingSelected = index; this.edit()
    }, `${index + 1} / ${this.state.total}`)
    if (index === this.state.books.length - 1 && this.state.books.length < this.state.total) {
      this.button('Load more', 194, 278, 174, 28, () => this.loadNextPage(2), false, 15)
    }
  },
  paintCover(key, path) {
    const image = this.state.coverImages?.[key]
    if (!image || !path) return false
    image.setProperty(ui.prop.SRC || 'src', path)
    return true
  },
  applyCover(key, path) {
    if (this.paintCover(key, path)) return
    if (this.state.coverImages) return
    if (this.state.alive && this.state.screen === 'library') this.render()
  },
  bindTap(widget, action) {
    let start = null
    let moved = false
    widget.addEventListener(ui.event.CLICK_DOWN, info => { start = { x: Number(info.x), y: Number(info.y) }; moved = false })
    widget.addEventListener(ui.event.MOVE, info => {
      if (start && (Math.abs(Number(info.x) - start.x) > layout.font(12) || Math.abs(Number(info.y) - start.y) > layout.font(12))) moved = true
    })
    widget.addEventListener(ui.event.CLICK_UP, () => {
      if (start && !moved && !this.state.busy) action()
      start = null
    })
  },
  scrollIndicator(total, visible, offset, y, trackHeight) {
    if (total <= visible) return null
    const thumbHeight = Math.max(18, trackHeight * Math.min(1, visible / total))
    const position = Math.max(0, Math.min(1, offset / Math.max(1, total - visible)))
    this.widget(ui.widget.FILL_RECT, { ...layout.rect(379, y, 4, trackHeight), radius: layout.font(2), color: PANEL }).setEnable(false)
    const thumb = this.widget(ui.widget.FILL_RECT, {
      ...layout.rect(379, y + position * (trackHeight - thumbHeight), 4, thumbHeight), radius: layout.font(2), color: ACCENT
    })
    thumb.setEnable(false)
    return { thumb, thumbHeight, trackHeight, y }
  },
  renderList() {
    const section = SECTIONS[this.state.viewIndex]
    const hasMore = this.state.books.length < this.state.total
    const viewportHeight = hasMore ? FOOTER_Y - 68 : 336
    const contentHeight = this.state.books.length * 90
    let indicator
    this.heading(section.title)
    const container = this.widget(ui.widget.VIEW_CONTAINER, {
      ...layout.rect(12, 68, 358, viewportHeight), scroll_enable: 1, bounce: 1,
      pos_y: this.state.listOffsets[section.statusId] || 0,
      scroll_frame_func: info => {
        if (this.state.alive && Number.isFinite(info.yoffset)) {
          this.state.listOffsets[section.statusId] = info.yoffset
          if (indicator) {
            const max = Math.max(1, layout.rect(0, 0, 0, contentHeight - viewportHeight).h)
            const fraction = Math.max(0, Math.min(1, -info.yoffset / max))
            indicator.thumb.setProperty(ui.prop.MORE, { ...layout.rect(379,
              indicator.y + fraction * (indicator.trackHeight - indicator.thumbHeight), 4, indicator.thumbHeight) })
          }
        }
      }
    })
    const addText = (text, y, h, size, color) => container.createWidget(ui.widget.TEXT, {
      ...layout.rect(20, y, 326, h), text, text_size: layout.font(size), color,
      text_style: ui.text_style.WRAP, align_v: ui.align.CENTER_V
    })
    if (!this.state.books.length) addText(`No books in ${section.title}.`, 24, 80, 21, MUTED)
    this.state.books.forEach((book, index) => {
      const y = index * 90
      container.createWidget(ui.widget.BUTTON, {
        ...layout.rect(20, y + 2, 318, 82), text: '', radius: layout.font(8),
        normal_color: BACKGROUND, press_color: PANEL,
        click_func: () => { if (!this.state.busy) this.openStatus(book) }
      })
      addText(book.title, y + 4, 48, 21, WHITE).setEnable(false)
      const rating = ratingLabel(book.rating)
      addText(this.state.viewIndex === 2 ? (rating || 'Not rated') : book.author,
        y + 54, 24, 16, this.state.viewIndex === 2 && rating ? ACCENT : MUTED).setEnable(false)
      container.createWidget(ui.widget.FILL_RECT, { ...layout.rect(20, y + 86, 326, 1), color: PANEL })
    })
    const initialOffset = -(this.state.listOffsets[section.statusId] || 0) / (height / 450)
    indicator = this.scrollIndicator(contentHeight, viewportHeight, initialOffset, 80, viewportHeight - 24)
    const counter = `${this.state.books.length} / ${this.state.total}`
    if (hasMore) this.footer('Load more', () => this.loadNextPage(section.statusId), counter)
    else this.text(counter, 80, 414, 230, 28, 17, MUTED, true)
  },
  renderError() {
    this.heading(this.state.screen === 'library' ? 'Connection needed' : 'Unable to update')
    this.text(this.state.message, 36, 90, 318, 238, 20, WHITE, true)
    if (this.state.retryKind) {
      this.button('Dismiss', 0, FOOTER_Y, 130, 85, () => {
        this.state.message = ''; this.state.retryKind = null; this.render()
      }, false, 21, 0)
      this.button('Retry', 130, FOOTER_Y, 260, 85, () => {
        const kind = this.state.retryKind
        this.state.message = ''
        if (kind === 'page') this.loadNextPage(SECTIONS[this.state.viewIndex].statusId)
        else this.load()
      }, true, 24, 0)
    } else this.footer('Back', () => { this.state.message = ''; this.render() })
  },
  renderLoadingOverlay() {
    this.widget(ui.widget.FILL_RECT, { ...layout.rect(0, 0, 390, 450), color: BACKGROUND })
    this.state.loadingWidget = this.text('Loading', 70, 184, 250, 46, 24, WHITE, true)
    this.state.loadingDots = [0, 1, 2].map(index => this.widget(ui.widget.FILL_RECT, {
      ...layout.rect(167 + index * 24, 249, 8, 8), radius: layout.font(4),
      color: index === this.state.loadingFrame % 3 ? ACCENT : PANEL
    }))
    this.scheduleLoadingTick()
  },
  renderEditor() {
    this.heading('Progress')
    this.button('Current page', 0, 68, 195, 50, () => this.setMode('pages'), this.state.mode === 'pages', 20, 0)
    this.button('Percentage', 195, 68, 195, 50, () => this.setMode('percentage'), this.state.mode === 'percentage', 20, 0)
    this.state.input = stepProgress(this.state.input, this.state.mode, this.book().totalPages, 0)
    this.text('Drag up or down', 40, 120, 310, 24, 16, MUTED, true)
    this.button('', 102, 146, 186, 170, () => {}, false, 24)
    const surface = this.state.widgets[this.state.widgets.length - 1]
    this.state.wheelSurface = surface
    this.state.wheelTouchY = null
    this.widget(ui.widget.FILL_RECT, { ...layout.rect(110, 201, 170, 56), radius: layout.font(10), color: 0x33404d }).setEnable(false)
    const values = this.wheelValues()
    const row = (index, y, h, size, color) => {
      const label = index !== 1 && values[index] === values[1] ? '' : this.wheelText(values[index])
      const widget = this.text(label, 112, y, 166, h, size, color, true)
      widget.setEnable(false)
      this.state.wheelRows[index] = widget
    }
    row(0, 150, 38, 21, MUTED)
    row(1, 201, 56, 42, ACCENT)
    row(2, 268, 38, 21, MUTED)
    surface.addEventListener(ui.event.CLICK_DOWN, info => {
      this.state.wheelTouchY = Number.isFinite(Number(info.y)) ? Number(info.y) : null
    })
    surface.addEventListener(ui.event.MOVE, info => {
      const y = Number(info.y)
      if (!Number.isFinite(y) || !Number.isFinite(this.state.wheelTouchY)) return
      const distance = layout.font(28)
      const steps = Math.trunc((this.state.wheelTouchY - y) / distance)
      if (!steps) return
      this.updateWheel(steps)
      this.state.wheelTouchY -= steps * distance
      this.state.message = ''
    })
    surface.addEventListener(ui.event.CLICK_UP, () => { this.state.wheelTouchY = null })
    const amounts = this.state.mode === 'pages' ? [10, 100] : [5, 10]
    amounts.forEach((amount, index) => {
      const steps = this.state.mode === 'pages' ? amount : amount * 10
      this.button(`-${amount}`, 14, 163 + index * 78, 78, 60, () => this.updateWheel(-steps), false, 20)
      this.button(`+${amount}`, 298, 163 + index * 78, 78, 60, () => this.updateWheel(steps), false, 20)
    })
    const hint = this.state.mode === 'pages'
      ? (this.book().totalPages ? `of ${this.book().totalPages} pages` : 'Current page') : '0 to 100%'
    this.text(this.state.message || hint, 30, 316, 330, 46, 16, this.state.message ? ACCENT : MUTED, true)
    this.button('Cancel', 0, FOOTER_Y, 130, 450 - FOOTER_Y, () => {
      this.state.screen = 'library'; this.state.message = ''; this.render()
    }, false, 21, 0)
    this.button('Update', 130, FOOTER_Y, 260, 450 - FOOTER_Y, () => this.submitProgress(), true, 24, 0)
  },
  renderStatusEditor() {
    const book = this.state.statusBook
    this.heading('Book status')
    this.text(book?.title || 'Book', 36, 74, 318, 76, 22, MUTED, true)
    SECTIONS.forEach((section, index) => {
      this.button(section.title, 24, 172 + index * 60, 342, 52,
        () => this.submitStatus(section.statusId), book?.statusId === section.statusId, 21, 8)
    })
    this.footer('Cancel', () => this.cancelStatus())
  }
}
