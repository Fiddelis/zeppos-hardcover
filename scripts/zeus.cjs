// Zeus 1.9.3 registers aliases against the current project's package.json.
// Initialize its packaged aliases explicitly so a local install can run.
const path = require('node:path')
const packagePath = require.resolve('@zeppos/zeus-cli/package.json')
const aliasPath = require.resolve('module-alias', { paths: [path.dirname(packagePath)] })
require(aliasPath)(packagePath)
require(path.join(path.dirname(packagePath), 'bin/main.js'))
