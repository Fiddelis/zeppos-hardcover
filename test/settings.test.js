import test from 'node:test'
import assert from 'node:assert/strict'

let page
globalThis.AppSettingsPage = definition => { page = definition }
for (const name of ['Section', 'View', 'Text', 'Button', 'Link', 'TextInput']) {
  globalThis[name] = (props, children) => ({ type: name, props, children })
}
await import('../app-settings/index.js')

function render(values = {}) {
  const data = new Map(Object.entries(values))
  const storage = {
    getItem: key => data.get(key),
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key)
  }
  const instance = { ...page, state: { ...page.state } }
  return { instance, storage, build: () => instance.build({ settingsStorage: storage }) }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  const children = Array.isArray(tree.children) ? tree.children : tree.children ? [tree.children] : []
  return [tree, ...children.flatMap(nodes)]
}
function textValue(node) {
  return Array.isArray(node.children) ? node.children.join('') : node.children
}

test('settings show a spaced token field and never render OAuth or saved secrets', () => {
  const tree = render({ hardcover_token: 'private-personal-token' }).build()
  const all = nodes(tree)
  assert.equal(tree.type, 'View')
  assert.equal(tree.props.style.background, '#101820')
  assert.equal(tree.props.style.minHeight, '100vh')
  assert.ok(all.some(node => node.type === 'Text' && textValue(node) === '2. Paste the token' && node.props.style.color === '#ffffff'))
  assert.ok(all.some(node => node.type === 'Text' && textValue(node).includes('read:catalog:data') && textValue(node).includes('Do not enable all')))
  assert.equal(all.find(node => node.type === 'TextInput').props.label, 'Tap here to paste the token')
  assert.equal(all.find(node => node.type === 'TextInput').props.style.background, '#33404d')
  assert.equal(all.find(node => node.type === 'TextInput').props.style.color, '#ffffff')
  assert.ok(all.filter(node => node.type === 'View' && node.props.style.background === '#24303d').length >= 3)
  assert.ok(all.some(node => node.type === 'Link' && node.props.source.startsWith('https://hardcover.app/account/api/keys/new?scope=')))
  assert.ok(!all.some(node => node.props.label === 'Entrar com Hardcover'))
  assert.ok(!JSON.stringify(tree).includes('private-personal-token'))
})

test('pasting marks the field ready without storing the token', () => {
  const f = render()
  nodes(f.build()).find(node => node.type === 'TextInput').props.onChange('  test-only-token  ')
  const all = nodes(f.build())
  assert.equal(all.find(node => node.type === 'TextInput').props.label, 'Token ready to save')
  assert.equal(f.storage.getItem('hardcover_token'), undefined)
  assert.equal(f.storage.getItem('hardcover_token_ready'), '1')
})

test('save stores a trimmed token and remove clears it', () => {
  const f = render()
  nodes(f.build()).find(node => node.type === 'TextInput').props.onChange('  test-only-token  ')
  nodes(f.build()).find(node => node.props.label === 'Save token').props.onClick()
  assert.equal(f.storage.getItem('hardcover_token'), 'test-only-token')
  assert.equal(f.instance.state.draft, '')
  nodes(f.build()).find(node => node.props.label === 'Remove saved token').props.onClick()
  assert.equal(f.storage.getItem('hardcover_token'), undefined)
})
