# @gpahal/std

Standard library of TypeScript utilities. It has no Node-only code, so it runs in browsers too.

- [Install][]
- [Modules](#modules)
- [Examples](#examples)
- [Runtime support](#runtime-support)

## Install

```sh
pnpm add @gpahal/std
```

Requires Node 24.22 or later when it runs in Node.

## Modules

Import each module separately, such as `@gpahal/std/strings`. The JSDoc of each export documents the API. "Your own code" means trusted values, without hostile getters, proxies or iterators.

| Module | Main exports | Input |
| --- | --- | --- |
| `arrays` | `isArray`, `isArrayOf`, `isNonEmpty`, `toArray`, `unique`, `uniqueBy`, `chunk`, `partition` | Your own code |
| `envs` | `isWindows`, `hasDocument`, `isWebWorker`, and `isBrowser`, deprecated | Globals, read once when the module loads |
| `errors` | `CustomError`, `getErrorMessage`, `getErrorReason`, `getErrorCode`, `toError`, `describeValue`, `assertNever`, `invariant`, `formatNames`, `formatMessage`, `formatMessageList` | Any thrown value for the getters and `toError`, which never throw. Your own code for the formatting helpers |
| `functions` | `debounce`, `throttle`, `once`, `memoize` | Your own functions |
| `hash` | `fnv1a52Hash`, `shortHash` | Any string. Not cryptographic |
| `match` | `match`, `matchValue` | Your own code. A lookup by key, not pattern matching |
| `numbers` | `clamp` | Your own numbers |
| `objects` | `isObject`, `isRecord`, `isPlainObject`, `pick`, `omit`, `omitUndefinedValues`, `omitUndefinedValuesAndKeys`, `clonePlain` | Your own code |
| `promises` | `sleep`, `sleepWithWakeup`, `withTimeout`, `retry`, `mapLimit`, `mapLimitIterable`, `createMutex`, `createTrackedPromise`, `isPromise`, `isPromiseLike`, `MAX_TIMER_DELAY_MS` | Your own callbacks, iterables, async iterables, thenables and signals |
| `queue` | `createQueue` | Any value, from your own code |
| `strings` | `ensurePrefix`, `stripPrefix`, `trim`, `words`, `camelCase`, `kebabCase`, `shorten`, `trimBlankLines`, `escapeControls`, `toString` and more | Your own strings. `shorten`, `escapeControls` and the trims also take untrusted ones |
| `symbols` | `isSymbol` | Any value |
| `urls` | `isAbsoluteUrl`, `getSafeRedirectPath`, `getLinkActiveState`, `getUrlExtension`, `getPathExtension` | Untrusted input |

## Examples

### arrays

```ts
import { chunk, partition, toArray, uniqueBy } from '@gpahal/std/arrays'

toArray('a') // ['a']
toArray(['a', 'b']) // ['a', 'b']
uniqueBy(['Inter', 'inter', 'Arial'], (font) => font.toLowerCase()) // ['Inter', 'Arial']
chunk(['a', 'b', 'c'], 2) // [['a', 'b'], ['c']]
partition([1, 2, 3, 4], (item) => item % 2 === 0) // [[2, 4], [1, 3]]
```

### envs

```ts
import { hasDocument, isWebWorker, isWindows } from '@gpahal/std/envs'

export const pathSeparator = isWindows ? '\\' : '/'
export const context = hasDocument ? 'page' : isWebWorker ? 'worker' : 'server'
```

`hasDocument` is `true` when a global `document` exists, as in a browser's main thread or Node under jsdom, and `false` in workers, Deno and edge runtimes. `isWebWorker` is `true` in dedicated, shared and service workers. `isBrowser` is a deprecated alias of `hasDocument`.

### errors

`toError` gives an `Error` for any thrown value. An error from any realm comes back as it is, and any other value becomes `new Error(getErrorMessage(value), { cause: value })`.

```ts
import { CustomError, getErrorCode, getErrorMessage, toError } from '@gpahal/std/errors'

class ConfigError extends CustomError {}

getErrorMessage(new ConfigError('bad config')) // 'bad config'
getErrorMessage(undefined) // 'undefined'
getErrorCode(Object.assign(new Error('missing'), { code: 'ENOENT' })) // 'ENOENT'
toError('failed').message // 'failed'
toError({ code: 1 }).cause // { code: 1 }
```

The message is raw, so it can hold control and bidi characters from untrusted input. An `AggregateError` or `SuppressedError` from any realm gives its own message, then `: ` and the messages of its inner errors joined with `; `, leaving out ones its own message already holds. The search is bounded, so a graph that refers back to itself can't take exponential time. An object without a message gives the first message in its `cause` chain, then its `name` unless that is `Error`, then `'Unknown error'`.

<!-- eslint-disable unicorn/error-message -- The missing message is what the example shows -->

```ts
import { getErrorMessage } from '@gpahal/std/errors'

getErrorMessage(new AggregateError([new Error('a'), 'b'])) // 'a; b'
getErrorMessage(new AggregateError([new Error('a')], 'failed')) // 'failed: a'
getErrorMessage(new Error('', { cause: new Error('disk full') })) // 'disk full'
getErrorMessage(new TypeError()) // 'TypeError'
```

Thrown messages have the shape `<package>: <subject>: <description>`. `formatMessage` builds one, and `formatMessageList` builds one for several issues. `getErrorReason` gives an error's message without a final period, to append to a description, and escapes control characters as `escapeControls` does, keeping backslashes.

```ts
import { describeValue, formatMessage, getErrorReason } from '@gpahal/std/errors'

formatMessage(
  '@scope/config',
  ['`quotes`'],
  `expected "single" or "double", received ${describeValue(1)}`,
) // '@scope/config: `quotes`: expected "single" or "double", received `1`'
formatMessage(
  '@scope/config',
  ['`a.css`'],
  `reading it failed: ${getErrorReason(new Error('No such file.'))}`,
) // '@scope/config: `a.css`: reading it failed: No such file'
getErrorReason(new Error('a\u{202E}b')) // 'a\\u202eb'
```

`assertNever` marks code that the types say can't run, such as the `default` of an exhaustive `switch`. A call with a value that isn't `never` is a compile error, and at runtime it throws a `TypeError`. `invariant(condition, message)` throws a `TypeError` with `message` unless `condition` is truthy, and narrows `condition` for the code after it. A function `message` is called only when the condition fails.

```ts
import { assertNever, invariant } from '@gpahal/std/errors'

function label(status: 'on' | 'off') {
  switch (status) {
    case 'on': {
      return 'On'
    }
    case 'off': {
      return 'Off'
    }
    default: {
      return assertNever(status)
    }
  }
}

label('dim' as 'on') // TypeError: @gpahal/std: `assertNever`: expected no value, received `"dim"`

function getPort(ports: ReadonlyMap<string, number>, name: string): number {
  const port = ports.get(name)
  invariant(port !== undefined, () => `@scope/app: \`${name}\`: expected a known port`)
  return port
}

getPort(new Map(), 'db') // TypeError: @scope/app: `db`: expected a known port
```

### functions

```ts
import { debounce, memoize, once, throttle } from '@gpahal/std/functions'

// Runs once a burst of calls ends, with the last arguments
const save = debounce((text: string) => text.toUpperCase(), 500)
save('a')
save('ab')
save.flush() // 'AB'

// Runs at most once every 100ms: at the first call, then with the last arguments of each wait
const report = throttle((y: number) => y * 2, 100)
report(1)
report(2)
report.flush() // 4

const load = once(() => ({ loadedAt: Date.now() }))
const first = load()
load() === first // true

// Keeps each result by the argument, or by what `key` gives, until `clear()`
const area = memoize((width: number, height: number) => width * height, {
  key: (width, height) => `${width}x${height}`,
})
area(2, 3) // 6
```

`memoize` compares keys as a `Map` does and holds object keys weakly. Without `key`, the first argument is the key, so a function of more than one parameter needs `key`. A call that throws keeps nothing, and a returned promise is kept even if it rejects.

`debounce` and `throttle` take `leading` and `trailing` options, and `debounce` also takes `maxWaitMs`, lodash's `maxWait`. The functions they return have `cancel()`, which drops the pending call, and `flush()`, which runs it now. As in lodash, a `flush()` that runs a call starts another wait, so `throttle` keeps its calls `waitMs` apart.

### hash

```ts
import { shortHash } from '@gpahal/std/hash'

shortHash('hello') // '15wypWkJi'
```

### match

```ts
import { match } from '@gpahal/std/match'

// The lookup has an entry for each value of the value's type, and no other key
function label(key: 'a' | 'b') {
  return match(key, { a: 'first', b: () => 'second' })
}

label('b') // 'second'
match('c' as string, { a: 1, b: 2 }) // Error: @gpahal/std: `match`: expected a value with an entry in `lookup`, received `"c"`. Known values: `"a"`, `"b"`
```

### numbers

```ts
import { clamp } from '@gpahal/std/numbers'

clamp(15, 0, 10) // 10
clamp(-5, 0, 10) // 0
clamp(5, 10, 0) // RangeError: @gpahal/std: `clamp`: `min`: expected at most `max`, which is `0`, received `10`
```

### objects

```ts
import { clonePlain, isPlainObject, omit, omitUndefinedValues, pick } from '@gpahal/std/objects'

omitUndefinedValues({ a: 1, b: undefined }) // { a: 1 }
pick({ a: 1, b: 2, c: 3 }, ['a', 'c']) // { a: 1, c: 3 }
omit({ a: 1, b: 2, c: 3 }, ['b']) // { a: 1, c: 3 }
isPlainObject(Object.create(null)) // true
isPlainObject({ [Symbol.toStringTag]: 'Options' }) // false

const rule = { ignore: ['a'] }
const copy = clonePlain(rule)
copy.ignore.push('b')
clonePlain(rule) // { ignore: ['a'] }
```

A plain object has `Object.prototype` or `null` as its prototype, in any realm, and the `[object Object]` tag, as es-toolkit checks. So an `arguments` object, a module namespace and an object with a `Symbol.toStringTag` aren't plain. `omitUndefinedValues` rejects them, and `clonePlain` keeps them as they are. A copied array keeps its holes and drops keys that aren't indexes.

### promises

| To | Use |
| --- | --- |
| Map a finite list with at most `limit` calls at once, and get every result in input order | `mapLimit` |
| Map a long, endless or async iterable and take the results in input order as they come | `mapLimitIterable` |
| Call a flaky operation again after each failure, waiting longer each time | `retry` |
| Stop waiting for an operation after a time, and abort its signal | `withTimeout` |
| Run async callbacks one at a time, in call order | `createMutex` |

Cancellation is cooperative. A signal tells the work to stop, and work that ignores it keeps running after the caller stops waiting. `withTimeout` rejects on time. `mapLimit` and `mapLimitIterable` reject on the first failure or abort and start no new calls, while running ones go on in the background. `retry` waits for a running `fn` or `shouldRetry` to settle before it stops. Pass the signal on, as to `fetch`, so the work stops too. Delays longer than `MAX_TIMER_DELAY_MS`, the most `setTimeout` supports, reject or throw with a `RangeError`.

```ts
import {
  createMutex,
  mapLimit,
  mapLimitIterable,
  retry,
  sleep,
  withTimeout,
} from '@gpahal/std/promises'

const controller = new AbortController()
const sleeping = sleep(10_000, { signal: controller.signal })
controller.abort(new Error('cancelled'))
await sleeping // Error: cancelled

// `fn` gets a signal that aborts when time runs out
await withTimeout(async (signal) => sleep(10_000, { signal }), 10) // DOMException: The operation was aborted due to timeout

// At most 2 calls run at once, and the results keep the input order
await mapLimit(['a', 'b', 'c'], 2, async (item, index) => `${index}:${item}`) // ['0:a', '1:b', '2:c']

// Takes async iterables too, and starts at most 2 calls ahead of the loop
const doubled = mapLimitIterable([1, 2, 3], 2, async (item) => item * 2)
let sum = 0
for await (const item of doubled) {
  sum += item
}
sum // 12

// Calls `fn` up to 1 + `retries` times, doubling the wait from `minDelayMs` up to `maxDelayMs`.
// `retries: Infinity` retries until `fn` succeeds, so pass a `signal` that can stop it
await retry(
  async (attempt) => {
    if (attempt < 3) {
      throw new Error('flaky')
    }
    return attempt
  },
  { retries: 3, minDelayMs: 1, shouldRetry: (error) => !(error instanceof TypeError) },
) // 3

const mutex = createMutex()
await mutex.runExclusive(async () => {
  // No other `runExclusive` callback of `mutex` runs until this one settles
  await sleep(100)
})
```

### queue

```ts
import { createQueue } from '@gpahal/std/queue'

const queue = createQueue<string>()
queue.enqueue('a')
const entry = queue.enqueue('b')
queue.remove(entry) // O(1), from anywhere in the queue
queue.dequeue() // 'a'
```

### strings

```ts
import { escapeControls, kebabCase, shorten } from '@gpahal/std/strings'

kebabCase('fooBar') // 'foo-bar'
shorten('abcdefghijklmnopqrstuvwxyz', 10) // 'abcde…wxyz'
escapeControls(String.raw`C:\a`, { keepBackslashes: true }) // 'C:\\a'
```

### symbols

```ts
import { isSymbol } from '@gpahal/std/symbols'

isSymbol(Symbol('a')) // true
isSymbol('Symbol(a)') // false
```

### urls

```ts
import {
  getLinkActiveState,
  getSafeRedirectPath,
  getUrlExtension,
  isAbsoluteUrl,
} from '@gpahal/std/urls'

isAbsoluteUrl('//evil.com') // true

// Redirect to what it returns, not to the user-supplied target. Its JSDoc lists what it rejects
getSafeRedirectPath('/a?b=1#c') // '/a?b=1#c'
getSafeRedirectPath('/%252F%252Fevil.com', '/home') // '/home'

// A name that a server or file system could end early, as at a `;`, gives no extension
getUrlExtension('https://example.com/a.png?v=1') // 'png'
getUrlExtension('/a.php;.png') // ''

// A relative link resolves against the current page, as an `<a href>` does
getLinkActiveState('b', { pathname: '/docs/b' }) // { isActive: true, isChildActive: false }
getLinkActiveState('../', { pathname: '/docs/a/b' }) // { isActive: false, isChildActive: true }
```

## Runtime support

[Install][] gives the Node version std needs. The build targets ES2024 without polyfills. In browsers, these features are needed only by the functions that use them:

- `URL.parse`: `getSafeRedirectPath`, `getLinkActiveState` and `getUrlExtension`.
- `Intl.Segmenter`: `shorten`.
- The regular expression `v` flag: `words` without a pattern, `camelCase` and `kebabCase`. Loading `strings` doesn't need it.

[Install]: #install
