import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAuthAction, createOAuth, readOAuthStatus } from '../shared/oauth.js'
import { OAUTH_KEYS } from '../shared/oauth-config.js'

const token = (suffix = 'one') => ({ access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, expires_in: 3600, token_type: 'Bearer' })
const device = { device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://hardcover.app/link', expires_in: 900, interval: 5 }
function fixture(responses = [], initial) {
  const values = new Map(initial ? [[OAUTH_KEYS.session, JSON.stringify(initial)]] : [])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  let time = 100000, timer, delay
  const calls = [], changes = []
  const oauth = createOAuth({ storage, clientId: 'test-public-client', now: () => time,
    setTimer: (callback, ms) => { timer = callback; delay = ms; return 1 }, clearTimer: () => { timer = undefined },
    request: async options => { calls.push(options); const response = responses.shift(); if (response instanceof Error) throw response; return typeof response === 'function' ? response(options) : response },
    identify: async () => ({ id: 42 }), onAccountChanged: (...args) => changes.push(args) })
  return { oauth, calls, changes, storage, values, get delay() { return delay }, get timer() { return timer },
    async tick() { const callback = timer; timer = undefined; time += delay; callback?.(); for (let i = 0; i < 12; i++) await Promise.resolve() },
    advance(ms) { time += ms } }
}
const session = { clientId: 'test-public-client', accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 100000, accountId: 42 }

test('device flow pending, slow_down adds five seconds, then stores tokens and identity', async () => {
  const f = fixture([device, { status: 400, body: { error: 'authorization_pending' } }, { error: 'slow_down' }, token()])
  await f.oauth.start()
  assert.equal(f.delay, 5000)
  assert.equal(readOAuthStatus(f.storage).userCode, 'ABCD-EFGH')
  assert.ok(!f.values.get(OAUTH_KEYS.status).includes('private-device-code'))
  await f.tick(); assert.equal(f.delay, 5000)
  await f.tick(); assert.equal(f.delay, 10000)
  await f.tick()
  assert.equal(await f.oauth.getAccessToken(), 'access-one')
  assert.deepEqual(f.changes, [[42, null]])
  assert.equal(readOAuthStatus(f.storage).state, 'signed_in')
  assert.ok(!f.values.get(OAUTH_KEYS.status).includes('access-one'))
  assert.match(f.calls[1].body, /grant_type=urn%3Aietf/)
  assert.ok(!f.calls.some(call => call.body.includes('client_secret')))
})

test('denial and server expiry stop polling', async () => {
  for (const [error, state] of [['access_denied', 'denied'], ['expired_token', 'expired']]) {
    const f = fixture([device, { error }]); await f.oauth.start(); await f.tick()
    assert.equal(readOAuthStatus(f.storage).state, state)
    assert.equal(f.timer, undefined)
  }
})

test('local expiry never polls beyond the deadline', async () => {
  const f = fixture([{ ...device, expires_in: 3 }])
  await f.oauth.start(); assert.equal(f.delay, 3000); await f.tick()
  assert.equal(f.calls.length, 1)
  assert.equal(readOAuthStatus(f.storage).state, 'expired')
})

test('start is single-flight and pending start does not create another code', async () => {
  let resolve
  const f = fixture([() => new Promise(done => { resolve = done })])
  const first = f.oauth.start(), second = f.oauth.start()
  assert.equal(first, second); assert.equal(f.calls.length, 1)
  resolve(device); await first; await f.oauth.start()
  assert.equal(f.calls.length, 1)
})

test('sign-out and client changes cancel late device responses', async () => {
  for (const change of [f => f.oauth.signOut(), f => f.oauth.setClientId('different-client')]) {
    let resolve
    const f = fixture([() => new Promise(done => { resolve = done })])
    const started = f.oauth.start(); await change(f); resolve(device); await started
    assert.equal(f.timer, undefined)
    assert.equal(readOAuthStatus(f.storage).state, 'signed_out')
  }
})

test('poll network failures back off and stop after three failures', async () => {
  const f = fixture([device, new Error('secret'), new Error('secret'), new Error('secret')])
  await f.oauth.start(); await f.tick(); assert.equal(f.delay, 10000)
  await f.tick(); assert.equal(f.delay, 20000)
  await f.tick(); assert.equal(readOAuthStatus(f.storage).state, 'error'); assert.equal(f.timer, undefined)
})

test('concurrent refresh rotates once and saves newest refresh before consumers proceed', async () => {
  let resolve
  const f = fixture([() => new Promise(done => { resolve = done })], session)
  const one = f.oauth.getAccessToken(), two = f.oauth.getAccessToken()
  assert.equal(f.calls.length, 1)
  assert.equal(JSON.parse(f.storage.getItem(OAUTH_KEYS.session)).refreshing, true)
  resolve(token('rotated'))
  assert.deepEqual(await Promise.all([one, two]), ['access-rotated', 'access-rotated'])
  assert.equal(JSON.parse(f.storage.getItem(OAUTH_KEYS.session)).refreshToken, 'refresh-rotated')
  assert.deepEqual(f.changes, [])
})

test('uncertain refresh removes credentials and never replays the previous refresh token', async () => {
  const f = fixture([new Error('request may have reached server')], session)
  await assert.rejects(f.oauth.getAccessToken(), /SIGNIN_NEEDED/)
  await assert.rejects(f.oauth.getAccessToken(), /SIGNIN_NEEDED/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.storage.getItem(OAUTH_KEYS.session), undefined)
  assert.equal(readOAuthStatus(f.storage).state, 'signin_needed')
  assert.deepEqual(f.changes, [[null, 42]])
})

test('a restart with an in-flight refresh marker requires sign-in without reuse', async () => {
  const f = fixture([], { ...session, refreshing: true })
  await assert.rejects(f.oauth.getAccessToken())
  assert.equal(f.calls.length, 0)
  assert.equal(readOAuthStatus(f.storage).state, 'signin_needed')
})

test('sign-out clears locally even if server revocation fails', async () => {
  const f = fixture([new Error('offline')], session)
  await f.oauth.signOut()
  assert.equal(f.oauth.hasSession(), false)
  assert.match(f.calls[0].url, /\/revoke$/)
  assert.equal(f.storage.getItem(OAUTH_KEYS.session), undefined)
})

test('destroy clears timers and rejects late poll results', async () => {
  const f = fixture([device]); await f.oauth.start(); f.oauth.destroy()
  assert.equal(f.timer, undefined)
  await assert.rejects(f.oauth.getAccessToken())
})

test('a stored sign-in action starts OAuth instead of being discarded', () => {
  const f = fixture([])
  let started = 0
  const storage = { getItem: key => key === OAUTH_KEYS.action ? JSON.stringify({ action: 'start' }) : undefined, removeItem() {} }
  const used = applyAuthAction({ start: () => { started++ } }, storage, { key: OAUTH_KEYS.action, newValue: JSON.stringify({ action: 'start' }) })
  assert.equal(used, true)
  assert.equal(started, 1)
  assert.equal(applyAuthAction({ start() {} }, { getItem: () => undefined, removeItem() {} }, { key: 'other' }), false)
  assert.equal(f.oauth.hasSession(), false)
})

test('sanitized settings status drops tokens, injected URLs and unknown fields', () => {
  const status = readOAuthStatus({ getItem: () => JSON.stringify({ state: 'pending', userCode: 'ABCD-EFGH', verificationUri: 'https://evil.example/link', access_token: 'secret', refresh_token: 'secret', device_code: 'secret', expiresAt: 123 }) })
  assert.deepEqual(status, { state: 'pending', userCode: 'ABCD-EFGH', expiresAt: 123 })
})
