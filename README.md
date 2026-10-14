# Zepp OS Hardcover

An unofficial companion for your Hardcover library on a Zepp OS watch.

Currently Reading comes first, with a cover, title, and progress. Swipe up and down to move between those books. Swipe sideways for Want to Read and Read. Those lists do not download covers. Read shows your rating when you have one.

Update progress by absolute current page or percentage. The value is the page you are on, not pages read in a session. Tap a cover or a list title to move a book between Currently Reading, Want to Read, and Read. Saving does not automatically finish a book or create a new reading record.

The watch does not talk to Hardcover. The Zepp app on your phone holds the token, downloads covers, and sends updates. The watch receives book data and local cover files.

This is not an official Hardcover or Zepp Health product.

## Connect Hardcover

Create a personal API token and paste it into the miniapp settings in Zepp. Do not enable the `all` permission.

Required permissions:

- `read:me:content`
- `read:library:public`
- `read:library:private`
- `read:catalog:data`
- `write:library`

The settings screen links to the Hardcover form with those permissions selected: [Create a Hardcover token](https://hardcover.app/account/api/keys/new?scope=read:me:content+read:library:public+read:library:private+read:catalog:data+write:library). Copy the token when Hardcover shows it. It is shown only once.

The token stays in Zepp settings storage on the phone. That storage is not an OS keychain. Do not commit the token or share a screenshot that contains it.

## Install with developer mode

The current package is installed from your computer, not from the Zepp store.

1. Install Zepp on your phone, sign in, and pair the watch.
2. Turn on developer mode. Open Profile, Settings, About, and tap the Zepp icon seven times until the prompt appears.
3. In this project, install dependencies and start a preview:

```sh
npm ci
npm run zeus -- preview
```

4. When the terminal shows a QR code, open Profile, go to the paired device page, scroll to the bottom, and open Developer Mode.
5. Tap Scan and scan the QR code. Keep the phone near the watch and leave Bluetooth connected.
6. Open Hardcover on the watch. In Zepp, open the miniapp settings, create the token, paste it, and save.

If installation reports that the Bluetooth channel is unavailable or DFU is busy, wait a moment and scan again.

Developer mode can also take a watch screenshot and collect device logs. Settings-page logs are not available in that viewer. To turn developer mode off, remove it from Profile, Settings.

Official steps: [Zepp developer mode](https://docs.zepp.com/docs/guides/tools/zepp-app/) and [preview on a watch](https://docs.zepp.com/docs/guides/quick-start/preview/).

## Development

```sh
npm test
npm run build
```

Tests use simulated Zepp responses. They do not replace trying the app on a paired watch. `docs/previews/` contains illustrations drawn from the layout code, not device screenshots.

The configured build is a rectangular layout. App ID `20001` is a placeholder. Register your own app before distribution. Public distribution should use OAuth instead of asking people to paste a personal token. See [publishing notes](docs/publishing.md).

## References

- [Zepp OS documentation](https://docs.zepp.com/)
- [Hardcover API](https://docs.hardcover.app/api/getting-started/)
