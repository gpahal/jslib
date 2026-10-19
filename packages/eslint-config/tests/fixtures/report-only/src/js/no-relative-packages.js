// The package's `exports` doesn't expose `index.js` by that path, so the package import fails
import { value } from '../../packages/relative-target/index.js'

export const copy = value
