// The `export … from` goes at the end, so `./prefer-template.js` loads after `./prefer-https.js`
import label from './prefer-template.js'
import './prefer-https.js'

export default label
