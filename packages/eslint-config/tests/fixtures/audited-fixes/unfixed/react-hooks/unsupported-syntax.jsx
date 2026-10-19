/* eslint react-hooks/unsupported-syntax: "error" */
export function Calc({ code }) {
  const value = eval(code)
  return <div>{value}</div>
}
