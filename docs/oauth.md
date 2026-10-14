# Phone-side OAuth

The Zepp settings screen no longer starts this flow. Device approval cannot stay alive while the user leaves Zepp for the browser, so the current settings page uses a personal token instead. The code below remains unused by the settings screen.

Hardcover supports OAuth now. Its native client guide was updated September 24, 2026. This miniapp uses Device Authorization Grant because Zepp does not give this app a registered browser redirect handler. There is no client secret, hosted callback, or cloud service.

## Register the app before enabling sign-in

1. Open https://hardcover.app/account/developer-apps/new in your own browser.
2. Choose **Mobile, desktop, or CLI** and enable Device Authorization Grant. No redirect URI is needed for this flow.
3. Allow `read:me:content read:library:public read:library:private read:catalog:data write:library`.
4. Copy the assigned public client ID into `OAUTH_CLIENT_ID` in `shared/oauth-config.js`, then rebuild. The empty default deliberately disables sign-in. Never use an example app ID or add a client secret.

The registered public client ID is configured. `read:me:content` covers the `me { id username }` query without email or roles. Public and private library scopes cover owned books and reads, including private entries, without follower-only access. `read:catalog:data` covers book, edition, author and image relationships used by the library query. `write:library` is the documented permission for progress and status updates; Hardcover does not publish a narrower progress-only permission. No social, account, email, reviews or catalog-write permissions are requested.

## Runtime

Settings writes one-shot actions to `hardcover_oauth_action` and immediately shows Starting. The phone service consumes that stored action during startup and on `onSettingsChange`. It must not delete the action before starting the device flow, because Zepp may launch the service after the click. Settings displays only a sanitized state, user code, verification URL and expiry. Zepp's Link component uses `source`, not `href`.

The device code stays in phone memory. Access and refresh tokens live in the separate `hardcover_oauth_session` settings key and are never sent to the watch, exposed in status, or logged. Zepp settings storage is not an OS keychain. No documented secure credential vault is available to this app, so persistent phone-side storage remains a security limitation. The advanced personal-token fallback has the same limitation and displays its input while editing.

Polling waits at least the server interval, adds five seconds on `slow_down`, backs off on network failures and stops after three consecutive failures or expiry. Starting twice reuses the in-flight operation. Sign-out, client-ID changes and destruction cancel timers and invalidate late responses.

Refresh requests are serialized. Before sending a rotating refresh token, storage records an in-flight marker. The newest token pair is persisted before an API request can proceed. An uncertain refresh response, invalid grant, failed persistence or restart with that marker clears credentials and requires sign-in. The old refresh token is never replayed. API mutations are not automatically retried.

Sign-out clears local credentials first and attempts server revocation. If offline, the user can also revoke the session from Hardcover's authorized-apps settings. Only effective account changes trigger watch invalidation; ordinary access-token refresh does not trigger the settings listener. The existing phone service also keys its client/cache by token, which must be considered when changing its cache implementation.

Phone requests await `oauth.getAccessToken()` before calling the existing synchronous service adapter. The latest token is provided through its `getToken` callback. Requests are queued so a token cannot change during an active mutation or cache check. Destruction clears polling timers and the service cache.

## Verification

`node --test test/oauth.test.js test/settings.test.js` exercises mocked polling, denial, expiry, single-flight startup, cancellation, bounded failures, rotation, uncertain refresh, revocation and sanitized settings output. No real account or token is used. Live Hardcover consent, Zepp background timer behavior, settings reactivity, iPhone browser opening and device transfer behavior remain untested on hardware.

## Sources

- https://docs.hardcover.app/api/oauth/getting-started-device/
- https://api.hardcover.app/.well-known/oauth-authorization-server
- https://docs.hardcover.app/api/graphql/actions/
- https://api.hardcover.app/capabilities.json
- https://docs.zepp.com/docs/reference/app-settings-api/ui/link/
- https://docs.zepp.com/docs/reference/side-service-api/settings-storage/

Context7 was consulted for Hardcover and Zepp. Current official Hardcover documentation and discovery take precedence over older indexed roadmap material.
