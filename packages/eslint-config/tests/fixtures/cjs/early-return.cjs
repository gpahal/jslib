// CommonJS allows `return` at the top level, since Node wraps the file in a function
if (!process.env.HOME) {
  module.exports = undefined
  return
}

const path = require('node:path')

module.exports = path.join(process.env.HOME, '.tool')
