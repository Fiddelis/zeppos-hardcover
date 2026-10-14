const TOKEN_KEY = 'hardcover_token'
const READY_KEY = 'hardcover_token_ready'
const TOKEN_URL = 'https://hardcover.app/account/api/keys/new?scope=read:me:content+read:library:public+read:library:private+read:catalog:data+write:library'
const BACKGROUND = '#101820'
const PANEL = '#24303d'
const ACCENT = '#eeb45f'
const WHITE = '#ffffff'
const MUTED = '#aeb8c4'
const INK = '#111820'

const pageStyle = {
  padding: '20px 20px 48px', background: BACKGROUND, backgroundColor: BACKGROUND, minHeight: '100vh'
}
const cardStyle = {
  marginTop: '16px', padding: '16px', borderRadius: '12px', background: PANEL, backgroundColor: PANEL
}
const buttonStyle = {
  marginTop: '14px', fontSize: '15px', borderRadius: '12px', background: ACCENT, color: INK, textAlign: 'center'
}

function text(value, { color = MUTED, size = '15px', bold = false, margin = '8px' } = {}) {
  return Text({
    paragraph: true, bold,
    style: { color, fontSize: size, lineHeight: '24px', marginBottom: margin }
  }, [value])
}

AppSettingsPage({
  state: { draft: '' },
  build(props) {
    const storage = props.settingsStorage
    const saved = Boolean(storage.getItem(TOKEN_KEY))
    const ready = Boolean(this.state.draft.trim() || storage.getItem(READY_KEY))
    return View({ style: pageStyle }, [
      text('HARDCOVER', { color: ACCENT, size: '12px', bold: true, margin: '4px' }),
      text('Your library on your watch', { color: WHITE, size: '24px', bold: true, margin: '8px' }),
      text('The token stays on this phone. The watch never receives it.'),
      View({ style: cardStyle }, [
        text('1. Create the token', { color: WHITE, size: '18px', bold: true }),
        text('Open Hardcover, name the token, and choose how long it lasts. Copy the token as soon as it appears.'),
        text('Enable read:me:content, read:library:public, read:library:private, read:catalog:data, and write:library. Do not enable all.'),
        Link({ source: TOKEN_URL }, [
          Button({ label: 'Create Hardcover token', color: 'primary', style: buttonStyle })
        ])
      ]),
      View({ style: cardStyle }, [
        text('2. Paste the token', { color: WHITE, size: '18px', bold: true }),
        text(ready
          ? 'Token received. Tap Save. The pasted value is not shown on this screen.'
          : 'Tap the highlighted area and paste the copied token.'),
        View({
          style: {
            marginTop: '12px', padding: '16px', borderRadius: '12px',
            background: '#33404d', backgroundColor: '#33404d'
          }
        }, [
          TextInput({
            label: ready ? 'Token ready to save' : 'Tap here to paste the token',
            placeholder: 'Paste the Hardcover token',
            bold: true,
            multiline: true,
            rows: 3,
            style: {
              width: '100%', color: WHITE, background: '#33404d', backgroundColor: '#33404d',
              border: '1px solid #eeb45f', borderRadius: '12px', padding: '14px', fontSize: '16px'
            },
            labelStyle: { fontSize: '16px', color: ACCENT, background: '#33404d', padding: '14px' },
            subStyle: { color: WHITE, fontSize: '16px', background: '#33404d' },
            onChange: value => {
              this.state.draft = value
              storage.setItem(READY_KEY, value.trim() ? '1' : '')
            }
          })
        ]),
        Button({
          label: 'Save token', color: 'primary', style: buttonStyle,
          onClick: () => {
            const token = this.state.draft.trim()
            if (!token) return
            this.state.draft = ''
            storage.setItem(READY_KEY, '')
            storage.setItem(TOKEN_KEY, token)
          }
        })
      ]),
      View({ style: { ...cardStyle, marginBottom: '24px' } }, [
        text('3. Open it on the watch', { color: WHITE, size: '18px', bold: true }),
        text(saved
          ? 'Token saved on this phone. Open Hardcover on the watch with Zepp connected.'
          : 'After saving, open the app on the watch and keep Zepp connected.'),
        ...(saved ? [Button({
          label: 'Remove saved token', color: 'secondary',
          style: { ...buttonStyle, background: '#33404d', color: WHITE },
          onClick: () => {
            this.state.draft = ''
            storage.setItem(READY_KEY, '')
            storage.removeItem(TOKEN_KEY)
          }
        })] : [])
      ])
    ])
  }
})
