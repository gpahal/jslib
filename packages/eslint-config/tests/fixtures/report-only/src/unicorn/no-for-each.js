// `forEach` skips holes and the items that the callback adds, and `for…of` visits them
/* eslint unicorn/no-for-each: "error" */
const queue = [1]

export function drain(callback) {
  queue.forEach((item) => {
    callback(item, queue)
  })
}
