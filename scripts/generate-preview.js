// Renders actual watch widget positions with demo data. Not a device screenshot.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import vm from 'node:vm'
import * as model from '../shared/watch-model.js'
import { createLayout } from '../page/layout.js'

let page
function makeWidget(type, options) {
  return { type, options, children: [], setEnable() {}, addEventListener() {},
    setProperty(key, value) { options[key] = value },
    createWidget(childType, childOptions) { const child = makeWidget(childType, childOptions); this.children.push(child); return child }
  }
}
const ui = {
  widget: { TEXT: 'text', BUTTON: 'button', IMG: 'image', FILL_RECT: 'rect', VIEW_CONTAINER: 'view' },
  text_style: { WRAP: 1 }, align: { CENTER_V: 1, CENTER_H: 2 },
  prop: { TEXT: 'text', COLOR: 'color' }, event: { CLICK_DOWN: 0, MOVE: 1, CLICK_UP: 2 },
  createWidget: makeWidget, deleteWidget() {}
}
const context = vm.createContext({
  ...model, ui, createLayout, getDeviceInfo: () => ({ width: 390, height: 450 }),
  LocalStorage: class { getItem(key, fallback) { return fallback } setItem() {} },
  statSync: () => undefined, rmSync() {}, onGesture() {}, offGesture() {}, GESTURE_LEFT: 1, GESTURE_RIGHT: 2, GESTURE_UP: 3, GESTURE_DOWN: 4,
  setWatchTimeout() {}, clearWatchTimeout() {},
  setPageBrightTime() {}, setScrollMode() {}, setScrollLock() {}, scrollTo() {}, swipeToIndex() {},
  SCROLL_MODE_FREE: 'free', SCROLL_MODE_SWIPER: 'swiper', SCROLL_ANIMATION_NONE: 'none',
  BasePage: value => value, Page: value => { page = value }
})
vm.runInContext(readFileSync(new URL('../page/visuals.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace('export const visuals', 'const visuals'), context)
vm.runInContext(readFileSync(new URL('../page/index.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/^const (ACCENT|PANEL) = .*\n/gm, ''), context)
page.state.books = [{ userBookId: 1, title: 'The Secret Garden', author: 'Frances Hodgson Burnett', statusId: 2, currentPage: 80, totalPages: 320, percentage: 25, hasCover: true }]
page.state.covers['1'] = 'demo-cover'
page.state.total = 1
page.state.groups = {
  2: page.state.books,
  3: [
    { userBookId: 2, title: 'Pride and Prejudice', rating: 4.5 },
    { userBookId: 3, title: 'Alice in Wonderland', rating: 4 },
    { userBookId: 4, title: 'The Time Machine', rating: null }
  ]
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]))
const color = value => `#${(value ?? 0xffffff).toString(16).padStart(6, '0')}`
function textLines(text, width, size) {
  const lines = ['']
  for (const word of String(text).split(/\s+/)) {
    const last = lines.length - 1
    if (lines[last] && (lines[last].length + word.length + 1) * size * 0.52 > width) lines.push(word)
    else lines[last] += `${lines[last] ? ' ' : ''}${word}`
  }
  return lines
}
let viewId = 0
function widget({ type, options: o, children }) {
  const { x, y, w, h } = o
  if (type === 'rect') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.radius || 0}" fill="${color(o.color)}"/>`
  if (type === 'view') {
    const id = `view-${++viewId}`
    return `<g transform="translate(${x},${y})"><defs><clipPath id="${id}"><rect width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#${id})">${children.map(widget).join('')}</g></g>`
  }
  if (type === 'image') return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#244b3a"/><rect x="${x + 9}" y="${y + 9}" width="${w - 18}" height="${h - 18}" fill="none" stroke="#d7bb78"/><path d="M${x + 30} ${y + 135} Q${x + 95} ${y + 90} ${x + 95} ${y + 35}" stroke="#94b98a" stroke-width="3" fill="none"/><text x="${x + w / 2}" y="${y + 49}" fill="#f4dfab" text-anchor="middle" font-size="14"><tspan x="${x + w / 2}">THE SECRET</tspan><tspan x="${x + w / 2}" dy="20">GARDEN</tspan></text><text x="${x + w / 2}" y="${y + h - 20}" fill="#f4dfab" text-anchor="middle" font-size="10">DEMO COVER</text></g>`
  const size = o.text_size || 20
  const lines = type === 'button' ? [o.text] : textLines(o.text, w, size)
  const lineHeight = size * 1.15
  const ty = y + (h - lines.length * lineHeight) / 2 + size
  const background = type === 'button' ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.radius || 0}" fill="${color(o.normal_color)}"/>` : ''
  const centered = type === 'button' || o.align_h === ui.align.CENTER_H
  return `${background}<text fill="${color(o.color)}" font-size="${size}" ${centered ? 'text-anchor="middle"' : ''}>${lines.map((line, i) => `<tspan x="${centered ? x + w / 2 : x}" y="${ty + i * lineHeight}">${escape(line)}</tspan>`).join('')}</text>`
}
const screens = [['library', 'Currently Reading', 0], ['library', 'Read', 2], ['edit', 'Update progress', 0]]
let body = ''
screens.forEach(([screen, title, viewIndex], index) => {
  page.state.screen = screen
  page.state.viewIndex = viewIndex
  page.state.mode = 'pages'
  page.state.books = page.state.groups[viewIndex === 2 ? 3 : 2]
  page.state.total = viewIndex === 2 ? 27 : page.state.books.length
  page.state.input = '80'
  page.render()
  body += `<g transform="translate(${24 + index * 414},64)"><text x="195" y="-20" fill="#e5e7eb" text-anchor="middle" font-size="18">${title}</text>${page.state.widgets.map(widget).join('')}</g>`
})
mkdirSync(new URL('../docs/previews/', import.meta.url), { recursive: true })
writeFileSync(new URL('../docs/previews/app-preview.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="263" viewBox="0 0 1266 555"><rect width="1266" height="555" fill="#080d12"/><g font-family="Arial, sans-serif">${body}<text x="633" y="540" fill="#aeb8c4" text-anchor="middle" font-size="14">Code-derived preview · Demo cover and ratings · Not a simulator or device screenshot</text></g></svg>`)
console.log('Generated docs/previews/app-preview.svg')
