import { generateCSSString } from '@/index'

const lightTheme = {
  bg: 'light',
  p3: {
    bg: 'light-p3',
  },
}

const darkTheme = {
  bg: 'dark',
  p3: {
    bg: 'dark-p3',
  },
}

const EXPECTED_CSS_STRING = `\
@theme {
  --color-*: initial;
  --color-bg: light;
}

@layer base {
  :root {
    --color-bg: light;

    @supports (color: color(display-p3 1 1 1)) {
      @media (color-gamut: p3) {
        --color-bg: light-p3;
      }
    }

    @media (prefers-color-scheme: dark) {
      --color-bg: dark;

      @supports (color: color(display-p3 1 1 1)) {
        @media (color-gamut: p3) {
          --color-bg: dark-p3;
        }
      }
    }
  }

  .light-theme {
    --color-bg: light;

    @supports (color: color(display-p3 1 1 1)) {
      @media (color-gamut: p3) {
        --color-bg: light-p3;
      }
    }
  }

  .dark-theme {
    --color-bg: dark;

    @supports (color: color(display-p3 1 1 1)) {
      @media (color-gamut: p3) {
        --color-bg: dark-p3;
      }
    }
  }
}`

test('generate-css-string', () => {
  const cssString = generateCSSString({
    default: lightTheme,
    defaultDark: darkTheme,
    selections: [
      {
        selector: '.light-theme',
        theme: lightTheme,
      },
      {
        selector: '.dark-theme',
        theme: darkTheme,
      },
    ],
  })

  expect(cssString.length).toBeGreaterThan(0)
  expect(cssString).toEqual(EXPECTED_CSS_STRING)
})
