import test from 'node:test';
import assert from 'node:assert/strict';
import { createHardcoverClient, HARDCOVER_URL, LIBRARY_STATUSES } from '../shared/hardcover.js';

const TOKEN = 'example-test-token';
function fixture(overrides = {}) {
  return {
    id: 11, user_id: 7, book_id: 22, status_id: 2, edition_id: 33,
    book: { id: 22, title: 'A Book', pages: 500, image: { url: 'https://example.test/book.jpg' },
      contributions: [{ author: { name: 'Writer' } }, { author: { name: 'Writer' } }] },
    edition: { id: 33, pages: 400, image: { url: 'https://example.test/library.jpg' } },
    user_book_reads: [{ id: 44, user_book_id: 11, edition_id: 55, started_at: '2026-01-01',
      finished_at: null, paused_at: null, progress_pages: 80,
      edition: { id: 55, pages: 200, image: { url: 'https://example.test/read.jpg' } } }],
    ...overrides,
  };
}
function setup(record = fixture(), options = {}) {
  const calls = [];
  const client = createHardcoverClient({ token: TOKEN, request: async (input) => {
    calls.push(input);
    const body = JSON.parse(input.body);
    if (body.query.includes('HardcoverMe')) return { data: { me: [{ id: 7, username: 'reader' }] } };
    if (body.query.includes('mutation')) {
      if (body.query.includes('update_user_book(')) return options.statusMutation || { data: { update_user_book: { id: 11, error: null } } }
      return options.mutation || { data: { update_user_book_read: { id: 44, error: null } } }
    }
    return { data: { user_books: record ? [record] : [] } };
  } });
  return { client, calls, bodies: () => calls.map((input) => JSON.parse(input.body)) };
}

test('authenticates, caches identity, and queries an owned paginated library', async () => {
  const { client, calls, bodies } = setup(fixture({ rating: 4.5 }));
  assert.deepEqual(await client.authenticate(), { id: 7, username: 'reader' });
  const books = await client.getLibrary({ statusId: 2, offset: 20, limit: 10 });
  assert.equal(calls.length, 2);
  assert.deepEqual(bodies()[1].variables, { userId: 7, statusId: 2, offset: 20, limit: 10 });
  assert.equal(calls[0].url, HARDCOVER_URL);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(books[0], { id: 22, userBookId: 11, readId: 44, editionId: 55,
    title: 'A Book', author: 'Writer', coverUrl: 'https://example.test/read.jpg',
    totalPages: 200, currentPage: 80, percentage: 40, rating: 4.5, statusId: 2 });
  assert.match(bodies()[1].query, /rating/)
  assert.deepEqual(LIBRARY_STATUSES.map((status) => status.id), [2, 1, 3]);
});

test('all library statuses and default pagination are supported', async () => {
  for (const statusId of [2, 1, 3]) {
    const { client, bodies } = setup(fixture({ status_id: statusId }));
    assert.equal((await client.getLibrary({ statusId }))[0].statusId, statusId);
    assert.deepEqual(bodies()[1].variables, { userId: 7, statusId, offset: 0, limit: 20 });
  }
});

test('status change verifies ownership fresh and updates only user_book status_id', async () => {
  const { client, bodies } = setup()
  const updated = await client.updateStatus({ userBookId: 11, statusId: 1 })
  assert.equal(updated.userBookId, 11)
  assert.equal(updated.statusId, 1)
  assert.deepEqual(bodies()[1].variables, { userBookId: 11, userId: 7 })
  assert.match(bodies()[1].query, /user_id: \{_eq: \$userId\}/)
  assert.deepEqual(bodies()[2].variables, { userBookId: 11, object: { status_id: 1 } })
  assert.match(bodies()[2].query, /UserBookUpdateInput/)
  assert.ok(!JSON.stringify(bodies()[2].variables).match(/started_at|finished_at|read_count/))
})

test('status changes accept only the three library statuses and reject unowned records', async () => {
  for (const statusId of [0, 4, '1', null]) {
    const { client, calls } = setup()
    await assert.rejects(client.updateStatus({ userBookId: 11, statusId }), HardcoverCode('INVALID_STATUS'))
    assert.equal(calls.length, 0)
  }
  const { client, bodies } = setup(null)
  await assert.rejects(client.updateStatus({ userBookId: 11, statusId: 3 }), HardcoverCode('NOT_OWNED'))
  assert.ok(bodies().every(body => !body.query.includes('mutation')))
})

test('status mutation errors and missing confirmation are not treated as success', async () => {
  for (const statusMutation of [
    { data: { update_user_book: { id: 99, error: null } } },
    { data: { update_user_book: { id: null, error: 'private upstream detail' } } },
    { data: { update_user_book: null } }
  ]) {
    const { client } = setup(fixture(), { statusMutation })
    await assert.rejects(client.updateStatus({ userBookId: 11, statusId: 3 }), error =>
      error.code === 'STATUS_UPDATE_FAILED' && !error.message.includes('private upstream'))
  }
})

test('library filters unexpected ownership and status', async () => {
  for (const record of [fixture({ user_id: 8 }), fixture({ status_id: 1 })]) {
    assert.deepEqual(await setup(record).client.getLibrary({ statusId: 2 }), []);
  }
});

test('percentage boundaries and intermediate values write absolute edition pages', async () => {
  for (const [value, page] of [[0, 0], [100, 200], [25, 50], [33.3, 67]]) {
    const { client, bodies } = setup();
    const result = await client.updateProgress({ userBookId: 11, mode: 'percentage', value });
    assert.deepEqual(bodies()[2].variables, { readId: 44, object: { progress_pages: page } });
    assert.equal(result.currentPage, page);
    assert.equal(result.percentage, page / 200 * 100);
    assert.match(bodies()[1].query, /user_id: \{_eq: \$userId\}/);
    assert.ok(bodies().every((body) => !body.query.includes('insert_user_book_read')));
  }
});

test('pages are absolute, not a session increment, and refetched on each update', async () => {
  const { client, bodies } = setup();
  await client.getLibrary({ statusId: 2 });
  await client.updateProgress({ userBookId: 11, mode: 'pages', value: 10 });
  await client.updateProgress({ userBookId: 11, mode: 'pages', value: 0 });
  assert.equal(bodies().filter((body) => body.query.includes('HardcoverOwnedBook')).length, 2);
  assert.deepEqual(bodies().filter((body) => body.query.includes('mutation')).map((body) => body.variables.object),
    [{ progress_pages: 10 }, { progress_pages: 0 }]);
});

test('invalid progress input is rejected before any request', async () => {
  for (const [mode, value] of [['pages', -1], ['pages', 1.5], ['pages', '10'], ['pages', NaN],
    ['percentage', 101], ['percentage', -1], ['percentage', Infinity], ['percent', 10]]) {
    const { client, calls } = setup();
    await assert.rejects(client.updateProgress({ userBookId: 11, mode, value }), HardcoverCode(/INVALID_(PROGRESS|MODE)/));
    assert.equal(calls.length, 0);
  }
});

function HardcoverCode(code) {
  return (error) => typeof code === 'string' ? error.code === code : code.test(error.code);
}

test('rejects oversized pages, unknown totals, wrong ownership/status, and absent/ambiguous active reads without mutation', async () => {
  const unknown = fixture();
  unknown.user_book_reads[0].edition.pages = null;
  const complete = fixture();
  complete.user_book_reads[0].finished_at = '2026-02-01';
  const paused = fixture();
  paused.user_book_reads[0].paused_at = '2026-02-01';
  const unstarted = fixture();
  unstarted.user_book_reads[0].started_at = null;
  const ambiguous = fixture();
  ambiguous.user_book_reads.push({ ...ambiguous.user_book_reads[0], id: 45 });
  const wrongRead = fixture();
  wrongRead.user_book_reads[0].user_book_id = 99;
  for (const [record, value, code] of [[fixture(), 201, 'INVALID_PROGRESS'], [unknown, 1, 'UNKNOWN_TOTAL'],
    [null, 1, 'NOT_OWNED'], [fixture({ user_id: 8 }), 1, 'NOT_OWNED'],
    [fixture({ status_id: 1 }), 1, 'NOT_READING'], [fixture({ status_id: 3 }), 1, 'NOT_READING'],
    [fixture({ user_book_reads: [] }), 1, 'NO_ACTIVE_READ'], [complete, 1, 'NO_ACTIVE_READ'],
    [paused, 1, 'NO_ACTIVE_READ'], [unstarted, 1, 'NO_ACTIVE_READ'],
    [ambiguous, 1, 'AMBIGUOUS_READ'], [wrongRead, 1, 'INVALID_READ']]) {
    const { client, bodies } = setup(record);
    await assert.rejects(client.updateProgress({ userBookId: 11, mode: 'pages', value }), HardcoverCode(code));
    assert.ok(bodies().every((body) => !body.query.includes('mutation')));
  }
  await assert.rejects(setup(unknown).client.updateProgress({ userBookId: 11, mode: 'percentage', value: 100 }), HardcoverCode('UNKNOWN_TOTAL'));
});

test('uses active read over completed history and never edits the completed read', async () => {
  const record = fixture();
  record.user_book_reads.unshift({ ...record.user_book_reads[0], id: 99, finished_at: '2026-02-01' });
  const { client, bodies } = setup(record);
  await client.updateProgress({ userBookId: 11, mode: 'pages', value: 100 });
  assert.equal(bodies()[2].variables.readId, 44);
});

test('missing progress remains unknown and edition cover falls back to book cover', async () => {
  const record = fixture({ edition: null, edition_id: null, user_book_reads: [] });
  const book = (await setup(record).client.getLibrary({ statusId: 2 }))[0];
  assert.equal(book.currentPage, null);
  assert.equal(book.percentage, null);
  assert.equal(book.readId, null);
  assert.equal(book.coverUrl, 'https://example.test/book.jpg');
});

test('a missing reading edition never inherits a different edition page count', async () => {
  const record = fixture();
  record.user_book_reads[0].edition = null;
  const { client } = setup(record);
  assert.equal((await client.getLibrary({ statusId: 2 }))[0].totalPages, null);
  await assert.rejects(client.updateProgress({ userBookId: 11, mode: 'pages', value: 10 }), HardcoverCode('UNKNOWN_TOTAL'));
});

test('accepts normalized responses and an existing Bearer prefix', async () => {
  const client = createHardcoverClient({ token: `Bearer ${TOKEN}`, request: async ({ headers }) => {
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
    return { status: 200, body: JSON.stringify({ data: { me: [{ id: 7 }] } }) };
  } });
  assert.equal((await client.authenticate()).id, 7);
});

test('rejects missing or malformed tokens without request', () => {
  for (const token of [null, '', ' ', 'Bearer ', 'hello world', 'bad\r\ntoken']) {
    assert.throws(() => createHardcoverClient({ token, request: async () => {} }), HardcoverCode('INVALID_TOKEN'));
  }
});

test('errors are safe and do not echo token or upstream details', async () => {
  const cases = [
    [() => { throw new Error(TOKEN); }, 'NETWORK_ERROR'],
    [() => ({ status: 401, body: TOKEN }), 'AUTH_ERROR'],
    [() => ({ statusCode: 403, body: TOKEN }), 'AUTH_ERROR'],
    [() => ({ status: 500, body: TOKEN }), 'HTTP_ERROR'],
    [() => ({ status: 200, body: 'invalid' }), 'INVALID_RESPONSE'],
    [() => ({ errors: [{ message: TOKEN }], data: {} }), 'GRAPHQL_ERROR'],
    [() => ({}), 'INVALID_RESPONSE'],
    [() => ({ data: { me: [] } }), 'AUTH_ERROR'],
  ];
  for (const [response, code] of cases) {
    const client = createHardcoverClient({ token: TOKEN, request: async () => response() });
    await assert.rejects(client.authenticate(), (error) => error.code === code && !error.message.includes(TOKEN));
  }
});

test('authentication failures can be retried', async () => {
  let count = 0;
  const client = createHardcoverClient({ token: TOKEN, request: async () =>
    ++count === 1 ? { errors: [{ message: 'failed' }] } : { data: { me: [{ id: 7 }] } } });
  await assert.rejects(client.authenticate());
  assert.equal((await client.authenticate()).id, 7);
});

test('rejects mutation errors and missing confirmation', async () => {
  for (const mutation of [{ data: { update_user_book_read: { error: TOKEN, id: null } } },
    { data: { update_user_book_read: null } }, { data: { update_user_book_read: { id: 99 } } }]) {
    await assert.rejects(setup(fixture(), { mutation }).client.updateProgress({ userBookId: 11, mode: 'pages', value: 1 }),
      (error) => error.code === 'UPDATE_FAILED' && !error.message.includes(TOKEN));
  }
});

test('rejects invalid IDs and pagination before requests', async () => {
  const { client, calls } = setup();
  await assert.rejects(client.updateProgress({ userBookId: '11', mode: 'pages', value: 1 }), HardcoverCode('INVALID_BOOK'));
  for (const options of [{ statusId: 9 }, { statusId: 2, offset: -1 }, { statusId: 2, limit: 0 },
    { statusId: 2, limit: 101 }, { statusId: 2, offset: 0.5 }]) {
    await assert.rejects(client.getLibrary(options));
  }
  assert.equal(calls.length, 0);
});

test('library aggregate count is status-filtered and schema-backed', async () => {
  const calls = [];
  const client = createHardcoverClient({ token: TOKEN, request: async (input) => {
    const body = JSON.parse(input.body); calls.push(body);
    if (body.query.includes('HardcoverMe')) return { data: { me: [{ id: 7 }] } };
    return { data: { user_books_aggregate: { aggregate: { count: 14 } } } };
  } });
  assert.equal(await client.getLibraryCount(2), 14);
  assert.match(calls[1].query, /user_books_aggregate/);
  assert.ok(calls[1].query.includes('aggregate { count }'));
  assert.equal(calls[1].variables.statusId, 2);
  assert.equal(calls[1].variables.userId, 7);
});
