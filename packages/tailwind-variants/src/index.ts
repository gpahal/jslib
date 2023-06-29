import plugin from 'tailwindcss/plugin'

export default plugin(({ addVariant }) => {
  addVariant('hocus', ['&:hover', '&:focus'])
  addVariant('hocus-visible', ['&:hover', '&:focus-visible'])
})
