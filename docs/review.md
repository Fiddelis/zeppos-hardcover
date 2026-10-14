# Implementation review

Reviewed October 13, 2026.

## Verified

- Re-ran all 60 Node tests successfully after version 0.3.0 and the lead's UI review.
- Rebuilt the `.zab` package successfully with local Zeus.
- Read-only real-account tests confirmed library sections, pagination, phone response filtering and HTTPS cover download. The revised combined-library endpoint also returned valid aggregate counts and pagination, with 45 books at test time.
- API authentication and requests are handled by the phone service, not the watch.
- Progress writes refetch ownership and active reading records, require confirmation and never create or finish reads automatically.

## Remaining gaps

- The user confirmed the initial app works on their watch with a cover, but reported usability issues, including failed confirmation of the generic native picker. Version 0.3.0 uses a custom draggable wheel built from documented widget touch events. Its touch regions and gesture behavior still need device validation. No official simulator test was performed.
- No real-account mutation tests.
- PNG is the documented input for Zepp image conversion. The initial cover worked on the user's device. This is not a guarantee for every JPEG/WebP image or firmware version; failures retain the fallback.
- Percentage input currently rounds to an absolute page using the edition length. Both modes require a known total in the API client. This is not native percentage storage.
- Watch covers now have a persisted, account/book/URL-keyed index, file existence checks, and a 24-entry cleanup limit. Phone-side temporary download and conversion files remain an open cleanup task.
- Token configuration is for personal development only, without secure-vault guarantees. Public release needs OAuth.
- Only one rectangular build layout is configured; the project is for Zepp OS but not yet validated across devices.
- App registration and privacy policy remain necessary before distribution.
- The implementation agent reported 45 dependency audit findings in the Zeus toolchain. Review advisories and affected paths before publication; no forced dependency upgrades were applied.

## Lead review corrections

Added failing regressions and corrected four issues in the second implementation: crossing status sections discarded earlier phone records; cache eviction left an in-memory ready flag; cache reuse after refresh failed to repaint; pagination could mutate a destroyed page. All four regressions now pass.

For ordinary editions up to 5,000 pages, page entry uses one large native wheel rather than five digit columns. Larger editions use a digit fallback. Percentage offers tenths, safely rounds its initial value and caps the selector at 100%. Explicit Review and Save remain mandatory. The counter contains only the current index and total.

Package version increased to 0.2.0 for the next device test. No live progress mutations were sent during this revision.

## Version 0.3.0 review and visual changes

The lead owns visual design. The home screen now has a larger cover, restrained title/author typography, centered progress and reading counter, and one full-width Update progress button. Horizontal navigation opens cover-free lists; vertical navigation on the home changes reading books. List rows have separators and personal rating text. A centered Loading label with three animated dots replaces the phone-specific loading message.

After the user's direction, `setStatusBarVisible(false)` is called on opening and visibility is never forced to true on exit. Widgets use the space previously reserved for the system header. Whether this resolves the watchface overlay is not yet verified on hardware.

An additional failing regression caught `surface.options.role`, a property only present on the mocked widgets. The real API does not promise an options object on returned widgets. The editor now stores the touch surface in page state, uses only documented widget methods, and passes a regression with opaque mock widget handles. This removes a demonstrated code-level crash; it does not independently prove the previous hardware confirmation symptom had the same cause.

The touch wheel, Review and Save hit regions are separate. A success notice no longer offers a Retry action. The selected reading book survives a trip to a list, and list offsets are preserved across rendering/pagination. Tests cover these changes.

Remaining device checks: confirm a selected value, verify vertical versus horizontal gestures, list scrolling and pagination, repeat app exit to the watchface and entry into another app, and verify persistent covers after reopening. No real-account writes were sent.

## Version 0.4.0

Lead review completed with 68 passing Node tests and a successful build of `dist/20001-Hardcover-0.4.0-20261013191416.zab`. Rendering now lives in `page/visuals.js`; cache and lifecycle remain in `page/index.js`.

The review screen is removed. Update sends directly, and confirmed responses update the displayed and persisted book. Saved disappears after two seconds. Headings share centered 24-pixel reference typography. Footer actions fill the full width from the existing action height to the bottom, including Load more. The editor divides that same footer between Cancel and Update. Side shortcuts adjust pages by 10/100 and percentages by 5/10 points.

Valid library metadata opens immediately and refreshes in the background. Metadata expires after 24 hours and persists at most 200 books. Cover caching remains independent. Token changes send invalidation from the phone, but an offline watch cannot learn about a changed credential until the phone reconnects. Previously saved account data may therefore briefly appear offline.

The current page requests `setPageBrightTime({ brightTime: 120000 })`. Zepp documents automatic reset on page destruction. This is a finite timeout, not permanent screen-on, and does not disable palm or wrist behavior globally. Hardware validation remains necessary.

Lead review fixed an undeclared color constant in the loading tick and added a regression that actually executes the timer. Starting a write invalidates in-flight background reads so they cannot replace the edited record. Missing saved-book data is treated as uncertain and cannot be retried immediately. No live progress mutations were used. Updated preview images are code-derived illustrations, not device captures.

Official image conversion reference: https://docs.zepp.com/docs/reference/side-service-api/image-convert/
