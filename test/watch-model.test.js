import test from 'node:test'
import assert from 'node:assert/strict'
import { SECTIONS, watchBook, progressLabel, validateEntry, localCoverPath, orderedBooks, boundedCounter, stepProgress, ratingLabel } from '../shared/watch-model.js'
import { createLayout } from '../page/layout.js'

test('Hardcover sections are in required order', () => {
  assert.deepEqual(SECTIONS.map(item => [item.statusId, item.title]), [[2, 'Currently Reading'], [1, 'Want to Read'], [3, 'Read']])
})
test('combined library preserves status ordering including empty sections and exact aggregate counter', () => {
  const rows = orderedBooks({ 2: [{ userBookId: 1 }], 1: [], 3: [{ userBookId: 2 }] })
  assert.deepEqual(rows.map(book => book.userBookId), [1, 2])
  assert.deepEqual(rows.map(book => book.statusId), [2, 3])
  assert.equal(boundedCounter(1, rows.length), '2 / 2')
})
test('vertical progress wheel clamps page and tenth-percent changes to supported bounds', () => {
  assert.equal(stepProgress('300', 'pages', 300, 1), '300')
  assert.equal(stepProgress('0', 'pages', 300, -1), '0')
  assert.equal(stepProgress('99.9', 'percentage', 300, 1), '100')
  assert.equal(stepProgress('100', 'percentage', 300, 1), '100')
  assert.equal(stepProgress('13.4', 'percentage', 300, 1), '13.5')
})
test('Read rating label is numeric and rejects missing or out-of-range values', () => {
  assert.equal(ratingLabel(4.5), 'Your rating: 4.5/5')
  assert.equal(ratingLabel(null), '')
  assert.equal(ratingLabel(6), '')
})
test('phone output excludes remote URLs and phone-only fields', () => {
  const output = watchBook({ id: 1, userBookId: 2, title: 'Book', author: 'Author', coverUrl: 'https://example.invalid/cover.png', token: 'not-a-credential', readId: 9, rating: 4.5 })
  assert.equal(output.hasCover, true)
  assert.equal(output.coverUrl, undefined)
  assert.equal(output.token, undefined)
  assert.equal(output.readId, undefined)
  assert.equal(output.rating, 4.5)
})
test('input is absolute current page, never an increment', () => {
  const book = { currentPage: 45, totalPages: 200, percentage: 22.5 }
  assert.equal(validateEntry(book, 'pages', '50'), 50)
  assert.equal(validateEntry(book, 'pages', '0'), 0)
  assert.equal(validateEntry(book, 'percentage', '37.5'), 37.5)
  assert.throws(() => validateEntry(book, 'pages', '201'))
  assert.throws(() => validateEntry(book, 'pages', '1.5'))
  assert.throws(() => validateEntry(book, 'percentage', '100.1'))
  assert.throws(() => validateEntry(book, 'pages', ''))
  assert.throws(() => validateEntry(book, 'pages', '-1'))
  assert.equal(progressLabel(book), 'Page 45 / 200 · 22.5%')
})
test('only fully transferred cover resources become IMG paths', () => {
  assert.equal(localCoverPath({ readyState: 'transferred', fileName: 'cover-1-2.png' }), 'data://download/cover-1-2.png')
  assert.equal(localCoverPath({ readyState: 'pending', fileName: 'cover-1-2.png' }), null)
  assert.equal(localCoverPath({ readyState: 'transferred', fileName: 'https://example.invalid/art.jpg' }), null)
})
test('reference layout uses real screen metrics', () => {
  assert.deepEqual(createLayout(390, 450).rect(18, 88, 130, 180), { x: 18, y: 88, w: 130, h: 180 })
  assert.deepEqual(createLayout(780, 900).rect(18, 88, 130, 180), { x: 36, y: 176, w: 260, h: 360 })
})
