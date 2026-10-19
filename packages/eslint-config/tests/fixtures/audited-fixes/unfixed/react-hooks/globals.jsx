let renders = 0

export function Counter() {
  renders = renders + 1
  return <div>{renders}</div>
}
