import plugin from 'tailwindcss/plugin'

export default plugin(({ addVariant }) => {
  addVariant('hocus', ['&:hover', '&:focus'])
})
