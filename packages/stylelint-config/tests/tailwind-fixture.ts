export const TAILWIND_CSS = `@import 'tailwindcss';
@import './theme.css' layer(theme);
@config '../tailwind.config.js';
@plugin '@tailwindcss/typography';
@source '../node_modules/@my-company/ui-lib';
@source not '../src/legacy';
@reference '../app.css';
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --*: initial;
  --color-*: initial;
  --color-brand-500: oklch(72% 0.11 178);
  --font-display: 'Satoshi', sans-serif;
  --font-display--font-feature-settings: 'cv02', 'cv03';
  --text-tiny: 0.625rem;
  --text-tiny--line-height: 1.5rem;
  --text-tiny--letter-spacing: 0.125rem;
  --breakpoint-3xl: 120rem;
}

@theme inline {
  --font-sans: var(--font-inter);
}

@utility tab-4 {
  tab-size: 4;
}

@variant hocus (&:hover, &:focus);

.card {
  padding: --spacing(4);
  color: --alpha(theme(--color-brand-500) / 50%);
  background-color: theme(--color-brand-500);

  @variant dark {
    color: white;
  }

  @apply rounded-lg shadow-md;
}

@media (width >= theme(--breakpoint-3xl)) {
  .card {
    margin: --spacing(8);
  }
}
`
