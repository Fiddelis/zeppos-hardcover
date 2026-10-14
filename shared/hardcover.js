/**
 * Phone-side-only Hardcover client. Never include this module or its token in
 * the watch bundle. request({url, method, headers, body}) receives a JSON string
 * body and returns parsed GraphQL JSON, or {status, body} with body as parsed
 * JSON or a JSON string. statusCode is also accepted in place of status.
 *
 * Sources: https://docs.hardcover.app and the official schema at
 * https://raw.githubusercontent.com/hardcoverapp/hardcover-docs/main/schema.graphql
 * DatesReadInput accepts progress_pages, not percentage. Percentage input is
 * rounded to the nearest absolute page; output percentage is derived from
 * pages / edition pages. We deliberately do not interpret the undocumented
 * units of user_book_reads.progress or auto-create/finish reading records.
 */
export const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';
export const LIBRARY_STATUSES = Object.freeze([
  { id: 2, name: 'Currently Reading' },
  { id: 1, name: 'Want to Read' },
  { id: 3, name: 'Read' },
]);

export class HardcoverError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HardcoverError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new HardcoverError(code, message); };
const validId = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const pageCount = (value) => validId(value) ? value : null;
const READ_FIELDS = `id user_book_id edition_id started_at finished_at paused_at progress_pages
  edition { id title pages image { url } }`;
const BOOK_FIELDS = `id user_id book_id status_id rating edition_id
  edition { id title pages image { url } }
  book { id title pages image { url } contributions { author { name } } }
  user_book_reads(order_by: {id: desc}) { ${READ_FIELDS} }`;

function activeReads(record) {
  return (record.user_book_reads || []).filter((read) => read.started_at && !read.finished_at && !read.paused_at);
}

function selectedRead(record) {
  const reads = record.user_book_reads || [];
  return activeReads(record)[0] || reads[0] || null;
}

function normalize(record, read = selectedRead(record)) {
  const book = record.book || {};
  const hasReadEdition = read?.edition_id != null;
  const edition = hasReadEdition ? read.edition : read?.edition || record.edition;
  // An edition with unknown length must not inherit another edition's length.
  const totalPages = hasReadEdition && !edition ? null : pageCount(edition ? edition.pages : book.pages);
  const currentPage = Number.isSafeInteger(read?.progress_pages) && read.progress_pages >= 0
    ? read.progress_pages : null;
  const percentage = totalPages && currentPage !== null
    ? Math.min(100, Math.max(0, currentPage / totalPages * 100)) : null;
  return {
    id: record.book_id,
    userBookId: record.id,
    readId: read?.id ?? null,
    editionId: read?.edition_id ?? record.edition_id ?? null,
    title: book.title || edition?.title || 'Untitled',
    author: [...new Set((book.contributions || []).map((item) => item.author?.name).filter(Boolean))].join(', '),
    coverUrl: edition?.image?.url || record.edition?.image?.url || book.image?.url || null,
    totalPages,
    currentPage,
    percentage,
    rating: Number.isFinite(record.rating) ? record.rating : null,
    statusId: record.status_id,
  };
}

export function createHardcoverClient({ request, token } = {}) {
  if (typeof request !== 'function') fail('INVALID_REQUEST', 'A request function is required.');
  if (typeof token !== 'string') fail('INVALID_TOKEN', 'A Hardcover token is required.');
  // Hardcover's API settings may supply the token with a Bearer prefix.
  const credential = token.trim().replace(/^Bearer\s+/i, '');
  if (!credential || /^Bearer$/i.test(credential) || /\s|[^\x21-\x7e]/.test(credential) || /[\r\n]/.test(token)) {
    fail('INVALID_TOKEN', 'The Hardcover token is invalid.');
  }

  async function graphql(query, variables = {}) {
    let response;
    try {
      response = await request({
        url: HARDCOVER_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      // Transport/GraphQL errors can contain request headers. Never relay them.
      fail('NETWORK_ERROR', 'Could not reach Hardcover.');
    }
    const status = response?.status ?? response?.statusCode;
    if (status === 401 || status === 403) fail('AUTH_ERROR', 'Hardcover authentication failed.');
    if (status !== undefined && (!Number.isInteger(status) || status < 200 || status >= 300)) {
      fail('HTTP_ERROR', 'Hardcover returned an unsuccessful response.');
    }
    let payload = status !== undefined ? response.body : response;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { fail('INVALID_RESPONSE', 'Hardcover returned invalid JSON.'); }
    }
    if (payload?.errors?.length) fail('GRAPHQL_ERROR', 'Hardcover could not complete the request.');
    if (!payload?.data || typeof payload.data !== 'object') fail('INVALID_RESPONSE', 'Hardcover returned no data.');
    return payload.data;
  }

  let identity;
  async function authenticate() {
    if (!identity) {
      identity = graphql('query HardcoverMe { me { id username } }').then((data) => {
        const user = Array.isArray(data.me) ? data.me[0] : data.me;
        if (!validId(user?.id)) fail('AUTH_ERROR', 'Hardcover authentication failed.');
        return { id: user.id, username: user.username ?? null };
      }).catch((error) => { identity = undefined; throw error; });
    }
    return { ...await identity };
  }

  async function getLibrary({ statusId, offset = 0, limit = 20 } = {}) {
    if (![2, 1, 3].includes(statusId)) fail('INVALID_STATUS', 'Choose a supported library status.');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      fail('INVALID_PAGINATION', 'Use a nonnegative offset and a limit between 1 and 100.');
    }
    const user = await authenticate();
    const data = await graphql(`query HardcoverLibrary($userId: Int!, $statusId: Int!, $offset: Int!, $limit: Int!) {
      user_books(where: {user_id: {_eq: $userId}, status_id: {_eq: $statusId}},
        order_by: [{updated_at: desc}, {id: desc}], offset: $offset, limit: $limit) { ${BOOK_FIELDS} }
    }`, { userId: user.id, statusId, offset, limit });
    if (!Array.isArray(data.user_books)) fail('INVALID_RESPONSE', 'Hardcover returned an invalid library.');
    return data.user_books.filter((record) => record.user_id === user.id && record.status_id === statusId)
      .map((record) => normalize(record));
  }

  async function getLibraryCount(statusId) {
    if (![2, 1, 3].includes(statusId)) fail('INVALID_STATUS', 'Choose a supported library status.')
    const user = await authenticate()
    const data = await graphql(`query HardcoverLibraryCount($userId: Int!, $statusId: Int!) {
      user_books_aggregate(where: {user_id: {_eq: $userId}, status_id: {_eq: $statusId}}) { aggregate { count } }
    }`, { userId: user.id, statusId })
    const count = data.user_books_aggregate?.aggregate?.count
    if (!Number.isSafeInteger(count) || count < 0) fail('INVALID_RESPONSE', 'Hardcover returned invalid library counts.')
    return count
  }

  async function updateStatus({ userBookId, statusId } = {}) {
    if (!validId(userBookId)) fail('INVALID_BOOK', 'A valid library record ID is required.')
    if (![1, 2, 3].includes(statusId)) fail('INVALID_STATUS', 'Choose a supported library status.')
    const user = await authenticate()
    const data = await graphql(`query HardcoverOwnedBookForStatus($userBookId: Int!, $userId: Int!) {
      user_books(where: {id: {_eq: $userBookId}, user_id: {_eq: $userId}}, limit: 1) { ${BOOK_FIELDS} }
    }`, { userBookId, userId: user.id })
    const record = data.user_books?.[0]
    if (!record || record.id !== userBookId || record.user_id !== user.id) {
      fail('NOT_OWNED', 'This book is not in your library.')
    }
    const updated = await graphql(`mutation HardcoverUpdateUserBookStatus($userBookId: Int!, $object: UserBookUpdateInput!) {
      update_user_book(id: $userBookId, object: $object) { id error }
    }`, { userBookId, object: { status_id: statusId } })
    const result = updated.update_user_book
    if (result?.error || result?.id !== userBookId) {
      fail('STATUS_UPDATE_FAILED', 'Hardcover did not confirm the status change.')
    }
    // Change only the library status. No read dates, read counts, or reading
    // records are created or rewritten by this request.
    return normalize({ ...record, status_id: statusId })
  }

  async function updateProgress({ userBookId, mode, value } = {}) {
    if (!validId(userBookId)) fail('INVALID_BOOK', 'A valid library record ID is required.');
    if (mode !== 'pages' && mode !== 'percentage') fail('INVALID_MODE', 'Use pages or percentage.');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        (mode === 'pages' && !Number.isSafeInteger(value)) || (mode === 'percentage' && value > 100)) {
      fail('INVALID_PROGRESS', 'Enter an absolute whole page or a percentage from 0 to 100.');
    }
    const user = await authenticate();
    const data = await graphql(`query HardcoverOwnedBook($userBookId: Int!, $userId: Int!) {
      user_books(where: {id: {_eq: $userBookId}, user_id: {_eq: $userId}}, limit: 1) { ${BOOK_FIELDS} }
    }`, { userBookId, userId: user.id });
    const record = data.user_books?.[0];
    if (!record || record.id !== userBookId || record.user_id !== user.id) {
      fail('NOT_OWNED', 'This book is not in your library.');
    }
    if (record.status_id !== 2) fail('NOT_READING', 'Only Currently Reading books can be updated.');
    const reads = activeReads(record);
    if (reads.length === 0) fail('NO_ACTIVE_READ', 'Start a reading record in Hardcover before updating progress.');
    if (reads.length !== 1) fail('AMBIGUOUS_READ', 'Resolve multiple active reading records in Hardcover first.');
    const read = reads[0];
    if (!validId(read.id) || read.user_book_id !== userBookId) fail('INVALID_READ', 'Hardcover returned an invalid reading record.');
    const normalized = normalize(record, read);
    if (!normalized.totalPages) fail('UNKNOWN_TOTAL', 'Set the reading edition page count in Hardcover first.');
    const currentPage = mode === 'pages' ? value : Math.round(normalized.totalPages * value / 100);
    if (currentPage > normalized.totalPages) fail('INVALID_PROGRESS', 'The current page exceeds the edition page count.');
    const updated = await graphql(`mutation HardcoverUpdateProgress($readId: Int!, $object: DatesReadInput!) {
      update_user_book_read(id: $readId, object: $object) { id error }
    }`, { readId: read.id, object: { progress_pages: currentPage } });
    const result = updated.update_user_book_read;
    if (result?.error || result?.id !== read.id) fail('UPDATE_FAILED', 'Hardcover did not confirm the progress update.');
    return normalize(record, { ...read, progress_pages: currentPage });
  }

  return { authenticate, getLibrary, getLibraryCount, updateProgress, updateStatus };
}
