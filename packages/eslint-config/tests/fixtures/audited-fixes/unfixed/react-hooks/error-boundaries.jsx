export function Safe({ render }) {
  try {
    return <div>{render()}</div>
  } catch {
    return null
  }
}
