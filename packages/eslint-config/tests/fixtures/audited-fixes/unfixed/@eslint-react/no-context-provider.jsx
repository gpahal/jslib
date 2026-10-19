import { createContext } from 'react'

const ThemeContext = createContext('light')

export function Theme({ children }) {
  return <ThemeContext.Provider value="dark">{children}</ThemeContext.Provider>
}
