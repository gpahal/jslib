# @gpahal/font-fallback

Generates local `@font-face` fallbacks with `size-adjust` and metric overrides to reduce layout shift while a web font loads. It uses [Capsize](https://github.com/seek-oss/capsize) math and `@capsizecss/metrics` data.

It reads a web font's regular face, from a family in `@capsizecss/metrics`, which covers Google Fonts, or from a font file, such as one from Fontshare or your own project. Fonts are trusted, build-time inputs: don't pass fonts users upload or URLs they supply.

Each fallback gets one regular rule. The browser synthesises bold and italic from it, so their match is approximate. Widths are weighted for Latin text, so line breaks can differ, especially in other scripts. A font file must have glyphs for Latin text, so a font of another script without them, such as a Thai or CJK subset, is rejected; for CJK text, whose glyphs share one width, the ascent and descent overrides matter more than `size-adjust`.

- [Install](#install)
- [Quick start](#quick-start)
- [Recipes](#recipes)
  - [A family name](#a-family-name)
  - [A font file](#a-font-file)
  - [An https: URL](#an-https-url)
  - [Bytes](#bytes)
  - [Other fallbacks](#other-fallbacks)
  - [Other descriptors and size-adjust][]
  - [Write the rules yourself](#write-the-rules-yourself)
  - [The CLI](#the-cli)
- [Browser support][]
- [Rejected inputs][]
- [Trusted input](#trusted-input)
- [Reference](#reference)

## Install

```sh
pnpm add @gpahal/font-fallback
```

Requires Node 24.22 or later, and doesn't run in browsers. It loads the full `@capsizecss/metrics` collection on the first family lookup. To keep that data out of your bundle, mark `@gpahal/font-fallback` and `@capsizecss/metrics` as external.

## Quick start

```ts
import { getFontFallbacks } from '@gpahal/font-fallback'

const { css, fontFamily } = await getFontFallbacks('Figtree')
const styles = `${css}
body {
  font-family: ${fontFamily}, sans-serif;
}`
```

`css` holds a rule for each fallback:

```css
/* fallback Arial */
@font-face {
  font-family: 'Figtree fallback Arial';
  src:
    local('Arial'), local('ArialMT'), local('Liberation Sans'), local('LiberationSans'),
    local('Arimo Regular'), local('Arimo-Regular');
  size-adjust: 100.717634%;
  ascent-override: 94.323105%;
  descent-override: 24.82187%;
  line-gap-override: 0%;
}
```

`fontFamily` is the web font followed by its fallbacks, `Figtree, 'Figtree fallback Helvetica Neue', 'Figtree fallback Segoe UI', 'Figtree fallback Roboto', 'Figtree fallback Arial'`. Both are safe to inline in a `<style>` element.

The package is strict: an input that's unusual in any way throws, and nothing is trimmed, guessed or clamped, except that up to 1% of Latin text, by weight, may lack glyphs, measured with the font's `.notdef` as Capsize does. The only things skipped are default fallbacks that are the web font, such as Arial for `getFontFallbacks('Arial')`, or too unlike it for a size-adjusted rule, so the defaults can give fewer fallbacks than their list has. [Rejected inputs][] lists every check.

## Recipes

### A family name

```ts
await getFontFallbacks('Inter')
```

A family name is looked up in the `@capsizecss/metrics` snapshot this package depends on, not the live Google Fonts catalogue. It must match the family's name exactly, case included: `inter` throws with the hint "Did you mean `Inter`?". A name is letters, digits, single spaces and hyphens, up to 64 characters, so quotes, surrounding whitespace and face suffixes such as `Inter:wght@400` throw. The family's regular face is read, and a family without one throws. `-apple-system` and `BlinkMacSystemFont`, which name the system UI font, throw too, as no page loads them as a web font; they're taken as fallbacks. Its metrics are the snapshot's, so a variable family isn't measured at optical size 16 the way a variable font file is.

### A font file

```ts
await getFontFallbacks(new URL('fonts/satoshi-regular.woff2', import.meta.url), {
  name: 'Satoshi',
  fallbacks: ['Arial'],
})
```

Pass a `file:` `URL`, not a path string, whose path ends in `.ttf`, `.otf` or `.woff2`, in any case. A string that looks like a path throws with a hint to pass `pathToFileURL(path)`, and a `file:` URL with a host, such as `file://server/share/f.ttf`, throws on every OS, as Windows would read it over the network. A font file needs `name`, the `font-family` name of your `@font-face`; the font's own name records are never read. `name` can also have underscores and periods, so a generated name such as Next.js's `__Inter_d65c78` works. Its default fallbacks come from the category of the family in `@capsizecss/metrics` that `name` names exactly, so a font whose `name` it lacks needs `category` or `fallbacks`.

The file must be a single TTF, OTF or WOFF2 font of a regular face:

- A static font must have an OS/2 `usWeightClass` of 400.
- A variable font is read at weight 400, which its `wght` axis must include whatever its default, and otherwise at its default instance, which must be the regular face: `wdth` must default to 100, and `ital`, `slnt` and `GRAD` to 0. Other axes, such as Roboto Flex's `XOPQ`, are read at their default, as browsers render them unless `font-variation-settings` sets them.
- Widths are measured at weight 400 and optical size 16, clamped to the `opsz` axis, matching 16px text under `font-optical-sizing: auto`, so text at other sizes can differ: at 48px, the fallback of a font with an `opsz` axis can be 10% or more wider. Away from the default instance, they're varied by the font's `HVAR` table, at the instance its `avar` table maps them to, so a variable font without `HVAR`, such as Recursive, is rejected when it's read away from its default instance.
- It must be upright: no italic or oblique flag, and an italic angle of 0.
- It needs glyphs with a width for the characters of Latin text the average width is weighted by, accented ones such as `á` and `é` included, though up to 1% of that text, by weight, may lack them. A character without a glyph is measured with the font's `.notdef` glyph, as Capsize does, and a glyph without a width adds nothing.

Its ascent, descent and line gap come from its `hhea` table only, whatever the OS/2 `USE_TYPO_METRICS` flag says, as Capsize reads them. Windows (DirectWrite, which Chrome, Edge and Firefox use there) renders with the OS/2 typo metrics when that flag is set. When it isn't, it renders with `usWinAscent` and `usWinDescent`, plus a line gap that makes the box at least the `hhea` one. When the line box that gives differs from the `hhea` one by over 1%, the result has `windowsLineHeightRatio`, the Windows box's height over the `hhea` box's, such as `1.024` for Roboto, whose fallback lines are then 2.4% shorter than the web font's on Windows. A variable font's are read at the same instance as its widths, varied by its `MVAR` table. A positive descent is read below the baseline, as Capsize reads it.

### An https: URL

```ts
await getFontFallbacks('https://cdn.example.com/fonts/satoshi-regular.woff2', {
  name: 'Satoshi',
  category: 'sans-serif',
})
```

A string that starts with `https://`, in any case, or a `URL` with `https:`, is fetched with the global `fetch`. Like a file, it needs `name`. The URL must point straight at a font file on a public host, with a path that ends in `.ttf`, `.otf` or `.woff2`; before fetching, the host is looked up with `node:dns/promises`, and one that resolves to a non-public address is rejected. A string must be the URL as the URL parser writes it, but for the case of its scheme and host. [Rejected inputs][] lists every URL rule, and [Trusted input](#trusted-input) their limits. Font URLs from Google Fonts (`fonts.gstatic.com`), Fontshare and Fontsource pass; Google's CSS API URLs and unpkg, which redirects, don't.

A fetch fails after 10 seconds, the lookup included, on a redirect, a status that isn't OK, a `Content-Type` that isn't a font type, or a body over 20 MiB. Error messages name an `https:` URL by its `href`, except where the URL could hold a secret, such as credentials or a query, and a `file:` URL by its path, give the reason, such as `failed to fetch: timed out after 10 seconds` or `failed to read: ENOENT`, and keep the underlying error as `cause`. Once `signal` is aborted, the call rejects with its reason, such as an `AbortError`, whether it's fetching, reading or looking up families. A `URL` and bytes are copied when passed, so changing them after the call has no effect.

A stable HTTPS URL doesn't promise stable font bytes: the host can replace the file, and the fallbacks change with it. For repeatable builds, check the font file in and pass its path, or fetch it yourself, verify a content digest such as SHA-256, and pass the bytes.

### Bytes

```ts
const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
await getFontFallbacks(new Uint8Array(await response.arrayBuffer()), {
  name: 'Satoshi',
  category: 'sans-serif',
})
```

A `Uint8Array`, such as a `Buffer`, of up to 20 MiB, is parsed as it is, with the same checks as a file but for the extension. Fetch a font yourself like this when it needs credentials, headers, a query, redirects or another HTTP client.

### Other fallbacks

```ts
await getFontFallbacks(new URL('fonts/lora.woff2', import.meta.url), {
  name: 'Lora',
  category: 'serif',
})
await getFontFallbacks('Inter', { fallbacks: ['Helvetica Neue', 'Arial'] })
await getFontFallbacks('Inter', { fallbacks: [...DEFAULT_FALLBACKS['sans-serif'], 'Ubuntu'] })
```

`category` picks a default list, which is otherwise the family's category in `@capsizecss/metrics`, with display and handwriting fonts as `sans-serif`. A default that's the web font's `name` or family, compared in any case, is left out, so `Roboto` falls back to `Helvetica Neue`, `Segoe UI` and `Arial`. `fallbacks` replaces the defaults, so it can't be combined with `category`. `DEFAULT_FALLBACKS` holds each category's defaults.

The defaults leave out `-apple-system`: its metrics are SF's at its default optical size, but macOS renders 16px text at a smaller optical size, which is 7 to 9% wider, so lines wrap differently. Helvetica Neue, which macOS and iOS have, matches its metrics. Prefer `Helvetica Neue` or `Arial` to `Helvetica` in `fallbacks` too: on macOS, Chrome makes Helvetica's line boxes 15% taller, whatever the rule's `ascent-override`.

The rules for Arial, Times New Roman and Courier New also name the Linux fonts with the same metrics in `src: local()`: Liberation Sans and Arimo, Liberation Serif and Tinos, and Liberation Mono and Cousine, so a fallback applies on Linux desktops and CI screenshot runners too. When the web font is one of those Linux fonts, such as Arimo, its own names are left out, as a font can't fall back to itself.

Each fallback must be the exact name of a family in `@capsizecss/metrics` with a regular face. A fallback in `fallbacks` that's repeated, or that's the web font's `name` or family, compared in any case as CSS compares family names, throws. So does a fallback in `fallbacks` too unlike the web font for a size-adjusted rule, such as Arial for the very wide Diplomata: see the override ranges in [Rejected inputs][]. A default fallback that's too unlike it is left out instead, keeping the order of the rest, so `Amiri Quran` falls back to `Georgia` and `Times New Roman` without `Noto Serif`, and the call throws only when every default is too unlike it.

### Other descriptors and size-adjust

```ts
await getFontFallbacks('Inter', {
  fontFaceProperties: { 'font-display': 'swap', 'unicode-range': 'U+0000-00FF' },
  sizeAdjust: 105,
})
```

`fontFaceProperties` adds descriptors to each rule, after the ones the package computes: `font-display`, `font-feature-settings`, `font-language-override`, `font-named-instance`, `font-stretch`, `font-style`, `font-variation-settings`, `font-weight`, `font-width` and `unicode-range`, in lowercase. Its values are CSS, written as they are, so a value that could end the rule or a `<style>` element throws (see [Rejected inputs][]), and the rules stay safe to inline. Quote a string, such as a feature tag, with `'`: `{ 'font-feature-settings': "'liga' 0" }`. A descriptor the package computes, such as `src` or `size-adjust`, throws.

`sizeAdjust` replaces each rule's computed `size-adjust` with a percentage from 50 to 200, such as `105` for 105%, and the ascent, descent and line gap overrides are computed from it, so lines still take the web font's height, except in Safari: see [Browser support][]. Use it when the widths weighted for Latin text don't suit your text. The override ranges in [Rejected inputs][] still apply. Neither option has a CLI flag.

### Write the rules yourself

```ts
const { fallbacks } = await getFontFallbacks('Figtree')
const faces = fallbacks.map(({ familyName, localNames, sizeAdjust }) => ({
  familyName,
  localNames,
  sizeAdjust,
}))
```

Each entry of `fallbacks` is one rule with its numbers, for a CSS-in-JS library. `sizeAdjust`, `ascentOverride`, `descentOverride` and `lineGapOverride` are ratios: 1 is 100%. Its names aren't escaped, so escape them where you render them.

### The CLI

```sh
font-fallback Inter
font-fallback ./fonts/lora.woff2 --name Lora --category serif --css > fallbacks.css
font-fallback ./fonts/satoshi-regular.woff2 -n Satoshi -f Arial -f 'Segoe UI'
font-fallback https://cdn.example.com/fonts/satoshi-regular.woff2 -n Satoshi -c sans-serif --json
curl -fsS -H "Authorization: Bearer $TOKEN" https://fonts.example.com/satoshi.woff2 | font-fallback - -n Satoshi -c sans-serif
font-fallback -n Satoshi -c sans-serif -- -satoshi.woff2
font-fallback Inter --fallback=-apple-system
```

```text
font-fallback <font> [-c sans-serif|serif|monospace] [-f <family>]... [-n <name>] [--css | --json]
```

The CLI reads its one font in this order:

| Argument | Source |
| --- | --- |
| `-` | The font file's bytes, read from stdin, up to 20 MiB, checked as bytes are |
| Starts with `https://`, in any case | A URL to fetch, under the URL rules |
| A family with a face suffix, such as `Inter:wght@400` | A family name, which the library rejects without echoing it |
| Starts with `file:/`, in any case, such as `file:///fonts/f.ttf` | A `file:` URL, read as the library reads one. A `file:` argument without the `/`, such as `file:f.ttf`, is rejected with a hint to pass the path |
| Starts with another `<scheme>:`, such as `http:`, `data:` or `https:` without `//` | Rejected, without echoing the argument. An `http:` URL gets a hint to pass its `https://` URL, and a `data:` URL a hint to decode it and pipe the bytes to `-`. A Windows path from a drive's root, such as `C:\fonts\f.ttf`, isn't a scheme. Prefix a path such as `fonts:f.ttf` with `./`, which the error suggests for another argument that looks like a path |
| Has a `/` or `\`, or ends in `.ttf`, `.otf`, `.woff2`, `.woff`, `.ttc`, `.otc` or `.dfont`, in any case | A font path, relative to the current directory. Only `.ttf`, `.otf` and `.woff2` files are read, and `.woff` and collections throw with a specific message |
| Anything else | A family name, which the library checks |

A font file, URL or stdin needs `-n`, and `-c` or `-f` unless `-n` names a family in `@capsizecss/metrics`. A font that starts with `-`, such as the file `-satoshi.woff2`, goes after the options and `--`, and a fallback that starts with `-` goes after `=`, as in `--fallback=-apple-system`. Each `-f` names a fallback, and together they replace the defaults, so `-f` can't be combined with `-c`.

`--json` prints everything as JSON, `windowsLineHeightRatio` included. For a font path, a `file:` URL or stdin, errors print each underlying error as a `Caused by:` line; for a URL or a family name, they print the message alone. For a font file with an `opsz` axis or a `windowsLineHeightRatio`, the table is followed by a note; `--css` and `--json` print no notes. Run `font-fallback --help` for the options, or `pnpm dlx @gpahal/font-fallback` without installing.

## Browser support

Chrome, Edge and Firefox apply every descriptor of a rule. Safari applies only `size-adjust` and ignores `ascent-override`, `descent-override` and `line-gap-override`, so in Safari a fallback matches the web font's widths but not its line heights, and text can still shift vertically when the web font loads.

## Rejected inputs

Every input below throws. Option and source errors are `TypeError`s.

| Input | Rejected when | Pass instead |
| --- | --- | --- |
| `source` | Not a string, `URL` or `Uint8Array`, such as an `ArrayBuffer` | A `Uint8Array` of it |
| A string | It doesn't start with `https://` and isn't letters, digits, single spaces and hyphens, with an optional leading hyphen, up to 64 characters: an empty string, surrounding or repeated whitespace, quotes, a face suffix such as `Inter:wght@400`, a path, or another scheme such as `http:` or `file:`. A path gets a hint to pass `pathToFileURL(path)` | A family name, an `https://` URL, or a `URL` for a font file |
| A family name | It isn't in `@capsizecss/metrics` exactly, case included | The name it suggests, or another family |
| A family name | Its family has no regular face | A font file of its regular face |
| A family name | It's `-apple-system` or `BlinkMacSystemFont`, in any case, which name the system UI font | Your web font's family name or font file |
| A family name or a fallback | It's an icon font: `Material Icons`, `Material Symbols` or one of their styles, such as `Material Symbols Outlined` | None: icon fonts aren't supported |
| A family name or a fallback | It's an emoji font, such as `Noto Color Emoji` or `Noto Emoji` | None: emoji fonts aren't supported |
| A `URL` | Neither `file:` nor `https:` | Bytes you load yourself |
| A `file:` URL | It has a host, such as `file://server/share/f.ttf`, it has no path on this system, such as one with an encoded `/`, or its path ends in a separator or doesn't end in `.ttf`, `.otf` or `.woff2`. A `.woff` path and a `.ttc` or `.otc` collection get their own message | A local font file |
| A `file:` URL | It isn't a regular file, such as a folder or a FIFO, or it's over 20 MiB | A font file |
| An `https://` string | It has whitespace, a control or format character, or a backslash, which the URL parser would drop or rewrite | The URL without them, percent-encoded where needed |
| An `https://` string | The URL parser rewrites it otherwise, but for the case of its scheme and host: it has an extra slash after `https://`, a default port, a dot segment, or a character the parser percent-encodes | The URL as parsed, which the error names |
| An `https:` URL | It has a username or password, a query, a fragment, a port, an IP address, `localhost`, `*.localhost`, `localhost.localdomain`, `localhost4`, `localhost4.localdomain4`, `localhost6`, `localhost6.localdomain6`, `ip6-localhost` or `ip6-loopback` as its host, or a path that ends in a separator or doesn't end in `.ttf`, `.otf` or `.woff2` | The font file's own URL, or bytes you fetch yourself |
| An `https:` URL | Its host resolves to a loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), shared (`100.64.0.0/10`), unspecified (`0.0.0.0/8`, `::`) multicast (`224.0.0.0/4`, `ff00::/8`), IETF protocol assignment (`192.0.0.0/24`) or reserved (`240.0.0.0/4`) address, an IPv4-mapped (`::ffff:0:0/96`), SIIT (`::ffff:0:0:0/96`), NAT64 (`64:ff9b::/96`) or 6to4 (`2002::/16`) form of an IPv4 one, or a local-use NAT64 (`64:ff9b:1::/48`) address | The font file's path or bytes, downloaded yourself |
| An `https:` URL | Its host doesn't resolve, or it redirects, times out after 10 seconds, has a status that isn't OK, a `Content-Type` that isn't `font/ttf`, `font/otf`, `font/sfnt`, `font/opentype`, `font/woff2`, `font/woff`, `font/collection`, `application/octet-stream`, `binary/octet-stream`, `application/vnd.ms-opentype`, `application/font-*` or `application/x-font-*`, or a body over 20 MiB | The final URL, or bytes you fetch yourself |
| Bytes | Over 20 MiB | A font file |
| A font file | It's empty, or its signature isn't `00 01 00 00` (TrueType), `OTTO` (CFF) or `wOF2`: a WOFF font, a collection such as a `.ttc` file, Apple's `true`, a DFont, or anything else | Its WOFF2 or TTF, or one font of the collection |
| A font file | Its extension doesn't match its signature: `.ttf` needs TrueType, `.otf` TrueType or CFF, and `.woff2` WOFF2 | The file under its right extension |
| A WOFF2 font | Its header's length isn't the file's, its flavor isn't TrueType or CFF, it has fewer than 1 or more than 64 tables, a table repeats, its tables' lengths add up to over 64 MiB, or its stream decompresses to another size | The complete font file |
| A WOFF2 font | Its `hmtx` table, or another table it reads, is transformed, as only untransformed tables are read | Its TTF |
| A TTF or OTF font | It has fewer than 1 or more than 64 tables, its table directory or a table runs past the end of the file, or a table repeats | The complete font file |
| A font file | It lacks a `head`, `hhea`, `maxp`, `hmtx`, `cmap`, `name`, `OS/2` or `post` table, or one other than `name`, which is never read, fails to parse | A complete font file |
| A font file | Its `cmap` table has over 64 encoding records, or none for Unicode: platform 0 with encoding 0 to 4 or 6, or platform 3 with encoding 1 or 10 | Another font file |
| A variable font | Its `wght` axis doesn't include 400, an axis's default is outside its range, or its default instance isn't otherwise the regular face: `wdth` must default to 100, and `ital`, `slnt` and `GRAD` to 0 | A static regular font, or the family name |
| A variable font | It's read away from its default instance, as its `wght` axis doesn't default to 400 or its `opsz` axis has to be set to 16, or the end of its range nearest 16, and it has no `HVAR` table to vary its widths by | A static regular font, or the family name |
| A variable font | Its `avar` table has a version other than 1, including `avar` v2 | A static regular font, or the family name |
| A variable font | It has over 64 axes, its `avar` or `MVAR` table fails to parse, its `MVAR` table has over 64 value records, or it's read away from its default instance and its `HVAR` or `MVAR` table's region list has another axis count than its `fvar` table | A static regular font, or the family name |
| A static font | Its `usWeightClass` isn't 400 | The regular font, or the family name |
| A font file | It's italic or oblique: the OS/2 italic or oblique flag, or the `head` italic flag, is set, or its italic angle isn't 0 | The upright font, or the family name |
| A font file | Its `hhea` table declares no glyph widths | Another font file |
| A font file | It has no glyph of a positive width for any character of Latin text, as from a corrupt `cmap` or `hmtx` table, or a font of only other scripts | The full font |
| A font file | It lacks glyphs of a positive width for over 1% of Latin text, by weight, as an icon font does | Its latin subset or the full font. Icon fonts aren't supported |
| A font file | Its `unitsPerEm` isn't an integer from 16 to 16384, its ascent isn't positive, its line gap is negative, or its average width of Latin text isn't positive (`xWidthAvg > 0`) | Another font file |
| `name` | It isn't letters, digits, underscores, periods, single spaces and hyphens, with an optional leading hyphen, up to 64 characters | The `font-family` name of your `@font-face` |
| `name` | It's missing for a font file, URL or bytes | The `name` option |
| `name` | For a font file, it isn't a family in `@capsizecss/metrics`, and neither `category` nor `fallbacks` is set | `category` or `fallbacks`, or the name it suggests for one in another case |
| `fallbacks` | It's empty, a fallback isn't a family name, isn't in `@capsizecss/metrics` exactly or has no regular face there, a fallback repeats, or a fallback is the web font's `name` or family, compared in any case | Other fallbacks |
| `fallbacks` and `category` | Both are set | One of them |
| `fontFaceProperties` | It isn't an object, a name isn't one of the descriptors it takes, in lowercase, or is one the package computes (`font-family`, `src`, `size-adjust`, `ascent-override`, `descent-override` or `line-gap-override`), or a value isn't a string, is empty, has surrounding whitespace, control, format, line separator or paragraph separator characters, lone surrogates, `;`, `{`, `}`, `<`, `>`, `&`, `"`, `\`, `!`, a comment, an unclosed single quote, parenthesis or bracket, or an unquoted `url()` argument | Other descriptors, or `sizeAdjust` for `size-adjust` and the overrides |
| `sizeAdjust` | It isn't a number from 50 to 200, or an override it gives is out of the range a fallback's is held to, below, whatever the fallback | A percentage, such as `105` for 105%, that suits the font, or none |
| Default fallbacks | Every one is the web font's `name` or family, compared in any case. A default that's the web font is otherwise left out | `fallbacks` |
| A fallback in `fallbacks`, or every default fallback | Its `sizeAdjust` isn't from 0.5 to 2, its `ascentOverride` isn't over 0 and at most 2, its `descentOverride` isn't from 0 to 1.5, its `lineGapOverride` isn't from 0 to 1, or one isn't finite: the font is too unlike the fallback for a size-adjusted rule. This applies to family names too, such as `Diplomata` and `Six Caps`. A default fallback out of range is otherwise left out. The error lists every fallback out of range | Another fallback, or for default fallbacks, `fallbacks` |

## Trusted input

Fontkitten parses files without memory or recursion limits, and the checks above bound only the container, the `cmap` encoding records, the variation axes, `avar`, `HVAR` and `MVAR`. The `name` table is never decoded, and `cmap`'s encoding records, `hmtx`, `post`, `fvar`, `avar`, `HVAR` and `MVAR` are read from their bytes. Widths are read without decoding glyph outlines. To handle user-uploaded fonts or user-supplied URLs, parse in a separate process with memory and CPU limits, and fetch through your own egress controls. The URL rules and the check of the host's addresses are best effort, not an SSRF defence: `fetch` resolves the host again, so DNS rebinding can still reach a private address. The check needs the host to resolve locally, so a URL fails on a network that reaches the internet only through a proxy. For such a network or a font on an intranet host, download the file and pass its path or bytes.

## Reference

`getFontFallbacks(source, options?)` takes a family name, an `https:` URL string, a `file:` or `https:` `URL`, or a `Uint8Array`, and returns `{ css, fontFamily, fallbacks }`, plus `windowsLineHeightRatio` for a font file whose line box on Windows differs from its `hhea` one by over 1% (see [A font file](#a-font-file)).

| Option | Default | What it does |
| --- | --- | --- |
| `category` | the family's | Picks the default fallbacks: `sans-serif`, `serif` or `monospace` |
| `fallbacks` | the category's | Local families to fall back to, in order, in place of the defaults. Each must match a family exactly, and none may repeat or be the web font. It can't be combined with `category` |
| `name` | the family name | The web font's `font-family` name, which the fallback names start with: letters, digits, underscores, periods, single spaces and hyphens. Required for a font file, URL or bytes |
| `fontFaceProperties` |  | Other `@font-face` descriptors for each rule, such as `{ 'font-display': 'swap' }`. See [Other descriptors and size-adjust][] |
| `sizeAdjust` | computed | Each rule's `size-adjust`, as a percentage from 50 to 200, with the other overrides computed from it |
| `signal` |  | Aborts fetching and reading, and rejects with its reason once it's aborted, or an `AbortError` if it has none. A signal of another realm, such as jsdom's, or a polyfill with `aborted`, `addEventListener` and `removeEventListener` works too |

| Category     | Default fallbacks                               |
| ------------ | ----------------------------------------------- |
| `sans-serif` | `Helvetica Neue`, `Segoe UI`, `Roboto`, `Arial` |
| `serif`      | `Georgia`, `Times New Roman`, `Noto Serif`      |
| `monospace`  | `Courier New`, `Roboto Mono`                    |

An unknown or invalid option throws a `TypeError`, and an option set to `undefined` is left unset.

[browser support]: #browser-support
[other descriptors and size-adjust]: #other-descriptors-and-size-adjust
[rejected inputs]: #rejected-inputs
