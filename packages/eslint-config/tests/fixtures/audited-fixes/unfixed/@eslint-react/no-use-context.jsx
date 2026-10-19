import { createContext, useContext } from 'react'

const ThemeContext = createContext('light')

export function Theme() {
  const theme = useContext(ThemeContext)
  return <div>{theme}</div>
}
