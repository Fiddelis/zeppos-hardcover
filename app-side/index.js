import { BaseSideService, settingsLib, convertLib } from '@zeppos/zml/base-side'
import { createHardcoverClient } from '../shared/hardcover.js'
import { createPhoneService, TOKEN_KEY } from './service.js'
import { applyAuthAction, createOAuth } from '../shared/oauth.js'
import { OAUTH_CLIENT_ID } from '../shared/oauth-config.js'

AppSideService(BaseSideService({
  onInit() {
    this.latestToken = ''
    this.requestQueue = Promise.resolve()
    this.destroyed = false
    const transport = options => fetch({ ...options, timeout: 30000 })
    this.oauth = createOAuth({
      storage: settingsLib, request: transport, clientId: OAUTH_CLIENT_ID,
      identify: token => createHardcoverClient({ request: transport, token }).authenticate(),
      onAccountChanged: () => this.invalidateAccount()
    })
    this.consumeAuthAction()
    this.service = createPhoneService({
      createClient: createHardcoverClient,
      getToken: () => this.latestToken,
      request: async options => {
        const response = await fetch({ ...options, timeout: 30000 })
        if (response.status && (response.status < 200 || response.status >= 300)) throw new Error('HTTP')
        return typeof response.body === 'string' ? JSON.parse(response.body) : response.body
      },
      download: (url, filePath) => new Promise((resolve, reject) => {
        const task = this.download(url, { filePath, timeout: 30000, headers: {} })
        if (!task) return reject(new Error('DOWNLOAD'))
        task.onSuccess = result => resolve(result.filePath)
        task.onFail = () => reject(new Error('DOWNLOAD'))
      }),
      convert: options => convertLib.convert(options),
      sendFile: (path, params) => this.sendFile(path, params)
    })
  },
  async onRequest(req, res) {
    // Keep a request's token stable until its cache/mutation checks finish.
    const task = this.requestQueue.then(async () => {
      if (this.destroyed) return { ok: false, error: 'Reconnect your phone, then retry.' }
      try {
        this.latestToken = String(settingsLib.getItem(TOKEN_KEY) || '').trim()
        if (!this.latestToken) return { ok: false, error: 'Add your Hardcover token in Zepp app settings.' }
        return await this.service.handle(req.method, req.params)
      } catch { return { ok: false, error: 'Sign in again with Hardcover in Zepp app settings.' } }
    })
    this.requestQueue = task.catch(() => {})
    const result = await task
    res(null, result)
  },
  invalidateAccount() {
    this.latestToken = ''
    this.service?.clear()
    if (!this.destroyed) {
      try { Promise.resolve(this.call({ method: 'invalidate-library' })).catch(() => {}) } catch {}
    }
  },
  consumeAuthAction(event) { applyAuthAction(this.oauth, settingsLib, event, TOKEN_KEY) },
  onSettingsChange(event) {
    this.consumeAuthAction(event)
    const key = typeof event === 'string' ? event : event?.key
    if (key === TOKEN_KEY) this.invalidateAccount()
  },
  onDestroy() { this.destroyed = true; this.oauth.destroy(); this.latestToken = ''; this.service.clear() }
}))
