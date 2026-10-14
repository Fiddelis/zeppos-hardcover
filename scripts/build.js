import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(root, '.zeus')
mkdirSync(buildRoot, { recursive: true })
const stage = mkdtempSync(join(buildRoot, 'build-'))
try {
  // Zeus packages every source file as an intermediate product. Give it only
  // app inputs, not tests, documentation, tools, or other workspace content.
  for (const path of ['app.js', 'app.json', 'package.json', 'page', 'app-side', 'app-settings', 'assets', 'shared']) {
    cpSync(join(root, path), join(stage, path), { recursive: true })
  }
  const result = spawnSync(process.execPath, [join(root, 'scripts/zeus.cjs'), 'build'], { cwd: stage, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Zeus build failed with exit code ${result.status}`)
  const artifacts = readdirSync(join(stage, 'dist')).filter(name => name.endsWith('.zab'))
  if (!artifacts.length) throw new Error('Zeus produced no .zab package')
  mkdirSync(join(root, 'dist'), { recursive: true })
  artifacts.forEach(name => {
    cpSync(join(stage, 'dist', name), join(root, 'dist', name))
    console.log(`Built dist/${name}`)
  })
} finally {
  // This uniquely created staging directory is ours, never user work.
  rmSync(stage, { recursive: true, force: true })
}
