const path = require('node:path')

function resolveFromHere(file) {
  return path.join(__dirname, file)
}

module.exports = { resolveFromHere }
