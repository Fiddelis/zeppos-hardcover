// Phone-side only. Transport, storage and time are injected for deterministic tests.
import { OAUTH_KEYS, OAUTH_ENDPOINTS, OAUTH_SCOPE } from './oauth-config.js'

export function readAuthAction(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return ['start', 'signout', 'legacy'].includes(parsed?.action) ? parsed.action : null
  } catch { return null }
}

export function applyAuthAction(oauth, storage, event, tokenKey = 'hardcover_token') {
  const key = typeof event === 'string' ? event : event?.key
  if (key && key !== OAUTH_KEYS.action) return false
  const raw = event && typeof event === 'object' && Object.prototype.hasOwnProperty.call(event, 'newValue')
    ? event.newValue : storage.getItem(OAUTH_KEYS.action)
  const action = readAuthAction(raw)
  if (!action) return false
  storage.removeItem(OAUTH_KEYS.action)
  if (action === 'start') void oauth.start()
  if (action === 'signout' || action === 'legacy') {
    storage.removeItem(tokenKey)
    void oauth.signOut()
  }
  return true
}

export function readOAuthStatus(storage) {
  let value
  try { value = JSON.parse(storage.getItem(OAUTH_KEYS.status) || '{}') } catch { value = {} }
  const states = ['unconfigured', 'signed_out', 'starting', 'pending', 'signed_in', 'denied', 'expired', 'error', 'signin_needed']
  const result = { state: states.includes(value.state) ? value.state : 'signed_out' }
  if (result.state === 'pending') {
    if (typeof value.userCode === 'string' && /^[A-Z0-9-]{1,32}$/i.test(value.userCode)) result.userCode = value.userCode
    if (typeof value.verificationUri === 'string' && /^https:\/\/hardcover\.app\/link(?:\?[^\s#]*)?$/.test(value.verificationUri)) result.verificationUri = value.verificationUri
    if (Number.isFinite(value.expiresAt)) result.expiresAt = value.expiresAt
  }
  return result
}

export function createOAuth({ storage, request, identify, clientId = '', scope = OAUTH_SCOPE,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onAccountChanged = () => {} }) {
  let epoch = 0, timer, pending, starting, refreshing, destroyed = false
  let session = null
  let needsSignIn = false
  try { session = JSON.parse(storage.getItem(OAUTH_KEYS.session) || 'null') } catch {}
  if (session && (session.clientId !== clientId || session.refreshing || !session.accessToken || !session.refreshToken)) {
    needsSignIn = true
    session = null
    storage.removeItem(OAUTH_KEYS.session)
  }
  const status = (state, fields = {}) => storage.setItem(OAUTH_KEYS.status, JSON.stringify({ state, ...fields }))
  status(!clientId ? 'unconfigured' : session ? 'signed_in' : needsSignIn ? 'signin_needed' : 'signed_out')
  const active = generation => !destroyed && generation === epoch
  function cancel() {
    epoch++
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
    pending = null
    starting = null
    refreshing = null
  }
  function drop(state) {
    const account = session?.accountId
    session = null
    storage.removeItem(OAUTH_KEYS.session)
    status(state)
    if (account != null) onAccountChanged(null, account)
  }
  async function post(endpoint, data) {
    const response = await request({ url: endpoint, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: Object.keys(data).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`).join('&') })
    const code = response?.status ?? response?.statusCode
    const body = code === undefined ? response : response.body
    const payload = typeof body === 'string' ? JSON.parse(body) : body
    if (!payload || typeof payload !== 'object') throw new Error('OAUTH_RESPONSE')
    if (code !== undefined && (code < 200 || code >= 300) && !payload.error) throw new Error('OAUTH_HTTP')
    return payload
  }
  function persist(token, accountId) {
    if (typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token ||
      !Number.isFinite(token.expires_in) || token.expires_in <= 0 || (token.token_type && token.token_type.toLowerCase() !== 'bearer')) throw new Error('OAUTH_RESPONSE')
    const next = { clientId, accessToken: token.access_token, refreshToken: token.refresh_token,
      expiresAt: now() + token.expires_in * 1000, accountId }
    storage.setItem(OAUTH_KEYS.session, JSON.stringify(next))
    session = next
  }
  function schedule(generation) {
    if (!active(generation) || !pending) return
    const remaining = pending.expiresAt - now()
    if (remaining <= 0) { pending = null; status('expired'); return }
    timer = setTimer(() => { timer = undefined; void poll(generation) }, Math.min(pending.interval * 1000, remaining))
  }
  async function poll(generation) {
    if (!active(generation) || !pending) return
    if (now() >= pending.expiresAt) { pending = null; status('expired'); return }
    try {
      const token = await post(OAUTH_ENDPOINTS.token, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: pending.deviceCode, client_id: clientId })
      if (!active(generation)) return
      if (now() >= pending.expiresAt) { pending = null; status('expired'); return }
      pending.failures = 0
      if (token.error === 'authorization_pending' || token.error === 'slow_down') {
        if (token.error === 'slow_down') pending.interval += 5
        schedule(generation)
        return
      }
      if (token.error) { pending = null; status(token.error === 'access_denied' ? 'denied' : token.error === 'expired_token' ? 'expired' : 'error'); return }
      // Save the issued refresh token before any further network request.
      const oldAccount = session?.accountId ?? null
      persist(token, null)
      const user = await identify(session.accessToken)
      if (!active(generation)) return
      if (user?.id == null) throw new Error('OAUTH_IDENTITY')
      storage.setItem(OAUTH_KEYS.session, JSON.stringify({ ...session, accountId: user.id }))
      session.accountId = user.id
      pending = null
      status('signed_in')
      if (oldAccount !== user.id) onAccountChanged(user.id, oldAccount)
    } catch {
      if (!active(generation)) return
      // Issued credentials cannot be mistaken for a completed sign-in.
      if (session && session.accountId == null) { pending = null; drop('signin_needed'); return }
      if (++pending.failures >= 3) { pending = null; status('error'); return }
      pending.interval *= 2
      schedule(generation)
    }
  }
  function start() {
    if (destroyed) return Promise.resolve()
    if (session) return Promise.resolve()
    if (starting) return starting
    if (pending) return Promise.resolve()
    if (!clientId) { status('unconfigured'); return Promise.resolve() }
    cancel()
    const generation = epoch
    status('starting')
    const task = (async () => {
      try {
        const device = await post(OAUTH_ENDPOINTS.device, { client_id: clientId, scope })
        if (!active(generation)) return
        const verificationUri = /^https:\/\/hardcover\.app\/link(?:\?[^\s#]*)?$/.test(device.verification_uri_complete || '')
          ? device.verification_uri_complete : device.verification_uri
        const safe = readOAuthStatus({ getItem: () => JSON.stringify({ state: 'pending', userCode: device.user_code, verificationUri }) })
        if (!device.device_code || !safe.userCode || !safe.verificationUri || !Number.isFinite(device.expires_in) || device.expires_in <= 0) throw new Error('OAUTH_RESPONSE')
        pending = { deviceCode: device.device_code, interval: Number.isFinite(device.interval) && device.interval > 0 ? device.interval : 5,
          expiresAt: now() + device.expires_in * 1000, failures: 0 }
        status('pending', { userCode: safe.userCode, verificationUri: safe.verificationUri, expiresAt: pending.expiresAt })
        schedule(generation)
      } catch { if (active(generation)) status('error') }
      finally { if (active(generation)) starting = null }
    })()
    starting = task
    return task
  }
  async function getAccessToken() {
    if (destroyed || !session) throw new Error('SIGNIN_NEEDED')
    if (refreshing) return refreshing
    if (session.expiresAt > now() + 60000) return session.accessToken
    const generation = epoch
    const previous = session
    const task = (async () => {
      try {
        // Persist the uncertainty marker before sending a rotating refresh token.
        // A restart or transport failure must never replay this token.
        storage.setItem(OAUTH_KEYS.session, JSON.stringify({ ...previous, refreshing: true }))
        const token = await post(OAUTH_ENDPOINTS.token, { grant_type: 'refresh_token', refresh_token: previous.refreshToken, client_id: clientId })
        if (!active(generation)) throw new Error('SIGNIN_NEEDED')
        if (token.error) throw new Error('SIGNIN_NEEDED')
        persist(token, previous.accountId)
        return session.accessToken
      } catch {
        if (active(generation)) drop('signin_needed')
        throw new Error('SIGNIN_NEEDED')
      } finally { if (active(generation)) refreshing = null }
    })()
    refreshing = task
    return task
  }
  async function signOut({ revoke = true } = {}) {
    const previous = session
    cancel()
    drop(clientId ? 'signed_out' : 'unconfigured')
    if (revoke && previous?.refreshToken) {
      try { await post(OAUTH_ENDPOINTS.revoke, { token: previous.refreshToken, token_type_hint: 'refresh_token', client_id: previous.clientId }) } catch {}
    }
  }
  return { start, getAccessToken, signOut,
    hasSession: () => Boolean(session),
    setClientId(value) { if (value !== clientId) { cancel(); drop('signed_out'); clientId = value; status(clientId ? 'signed_out' : 'unconfigured') } },
    destroy() { cancel(); destroyed = true; if (!session) status(clientId ? 'signed_out' : 'unconfigured') }
  }
}
