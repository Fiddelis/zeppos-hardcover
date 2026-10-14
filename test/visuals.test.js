import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as model from '../shared/watch-model.js'
import { createLayout } from '../page/layout.js'

function fixture() {
  const options = []
  const widget = (type, params) => {
    options.push({ type, ...params })
    return { addEventListener() {}, setEnable() {}, setProperty() {}, createWidget: widget }
  }
  const context = { ...model, createLayout, getDeviceInfo: () => ({ width: 390, height: 450 }),
    ui: { widget: { TEXT: 'text', BUTTON: 'button', IMG: 'image', FILL_RECT: 'rect', VIEW_CONTAINER: 'view' },
      align: { CENTER_H: 2, CENTER_V: 1 }, text_style: { WRAP: 1 }, event: {}, prop: {}, createWidget: widget, deleteWidget() {} },
    setScrollMode() {}, setScrollLock() {}, scrollTo() {}, swipeToIndex() {}, SCROLL_MODE_FREE: 'free', SCROLL_MODE_SWIPER: 'swiper' }
  vm.runInNewContext(readFileSync(new URL('../page/visuals.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export const visuals', 'globalThis.visuals'), context)
  const book = { userBookId: '8', title: 'Underlying book title', author: 'Author', statusId: 2, currentPage: 30, totalPages: 300 }
  const page = { ...context.visuals, state: { alive: true, widgets: [], screen: 'library', busy: false,
    message: '', retryKind: null, viewIndex: 0, books: [book], selected: 0, total: 1,
    covers: {}, coverStates: {}, listOffsets: {}, loadingFrame: 0 },
    book() { return this.state.books[this.state.selected] }, stopLoadingAnimation() {}, scheduleLoadingTick() {}, edit() {},
    load() {}, loadNextPage() {}, openStatus() {} }
  return { page, options }
}

test('error screen replaces underlying library content instead of mixing text', () => {
  const { page, options } = fixture()
  page.state.message = 'Phone unavailable. Please try again.'
  page.state.retryKind = 'library'
  page.render()
  assert.ok(options.some(widget => widget.text === page.state.message))
  assert.ok(!options.some(widget => widget.text === 'Underlying book title'))
  assert.ok(!options.some(widget => widget.text === 'Update progress'))
})
