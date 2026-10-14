// Public native client ID, assigned at hardcover.app/account/developer-apps/new.
// Leave empty until the app is registered with Device Authorization Grant enabled.
export const OAUTH_CLIENT_ID = 'bdac3406-78da-4a86-bcf1-5ba15c15d42f'
export const OAUTH_SCOPE = 'read:me:content read:library:public read:library:private read:catalog:data write:library'
export const OAUTH_KEYS = Object.freeze({
  session: 'hardcover_oauth_session',
  status: 'hardcover_oauth_status',
  action: 'hardcover_oauth_action'
})
export const OAUTH_ENDPOINTS = Object.freeze({
  device: 'https://api.hardcover.app/oauth2/device',
  token: 'https://api.hardcover.app/oauth2/token',
  revoke: 'https://api.hardcover.app/oauth2/revoke'
})
