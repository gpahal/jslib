// `Buffer` may be another class, such as a WebGL library's, without Node's `from`
import { Buffer } from './gl.js'

export function create(gl, data) {
  return new Buffer(gl, data)
}
