export const SECTIONS = [
  { statusId: 2, title: 'Currently Reading', tab: 'Reading' },
  { statusId: 1, title: 'Want to Read', tab: 'Want to Read' },
  { statusId: 3, title: 'Read', tab: 'Read' }
]
export const PAGE_SIZE = 10

export function orderedBooks(groups) {
  return SECTIONS.flatMap(section => (groups[section.statusId] || []).map(book => ({ ...book, statusId: section.statusId })))
}

export function boundedCounter(index, total) {
  return `${Math.min(total, index + 1)} / ${total}`
}

export function stepProgress(input, mode, totalPages, steps) {
  if (!Number.isInteger(steps)) return String(input)
  if (mode === 'percentage') {
    const tenths = Math.max(0, Math.min(1000, Math.round((Number(input) || 0) * 10) + steps))
    return tenths % 10 ? (tenths / 10).toFixed(1) : String(tenths / 10)
  }
  const max = Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : 99999
  return String(Math.max(0, Math.min(max, Math.floor(Number(input) || 0) + steps)))
}

export function ratingLabel(rating) {
  return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? `Your rating: ${rating}/5` : ''
}

export function watchBook(book) {
  return {
    id: book.id, userBookId: book.userBookId,
    title: String(book.title || 'Untitled'), author: String(book.author || 'Unknown author'),
    totalPages: book.totalPages, currentPage: book.currentPage,
    percentage: book.percentage, rating: Number.isFinite(book.rating) ? book.rating : null, statusId: book.statusId,
    hasCover: Boolean(book.coverUrl)
  }
}

export function progressLabel(book) {
  const parts = []
  if (Number.isFinite(book.currentPage)) {
    parts.push(`Page ${book.currentPage}${book.totalPages ? ` / ${book.totalPages}` : ''}`)
  }
  if (Number.isFinite(book.percentage)) parts.push(`${Math.round(book.percentage * 10) / 10}%`)
  return parts.join(' · ') || 'No reading progress yet'
}

export function progressValue(book, mode) {
  const value = mode === 'pages' ? book.currentPage : book.percentage
  return Number.isFinite(value) ? String(value) : '0'
}

export function validateEntry(book, mode, input) {
  if (!['pages', 'percentage'].includes(mode)) throw new Error('Choose pages or percentage.')
  if (!/^\d+(\.\d+)?$/.test(String(input))) throw new Error('Enter a number first.')
  const value = Number(input)
  if (!Number.isFinite(value) || value < 0) throw new Error('Enter a positive number or zero.')
  if (mode === 'pages') {
    if (!Number.isInteger(value)) throw new Error('Current page must be a whole number.')
    if (book.totalPages && value > book.totalPages) throw new Error(`Last page is ${book.totalPages}.`)
  } else if (value > 100) throw new Error('Percentage must be 0 to 100.')
  return value
}

export function localCoverPath(file) {
  if (file.readyState !== 'transferred') return null
  // Zepp's download sample resolves received resources in data://download/.
  const name = String(file.fileName || '').split('/').pop()
  if (!/^cover-[a-zA-Z0-9-]+\.png$/.test(name)) return null
  return `data://download/${name}`
}
