// Wrapping puts newlines and indentation in the string, so `split(' ')` yields tokens that
// `classList.add` rejects
/* eslint better-tailwindcss/enforce-consistent-line-wrapping: "error" */
export function style(element) {
  const classes = 'flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50'
  element.classList.add(...classes.split(' '))
}
