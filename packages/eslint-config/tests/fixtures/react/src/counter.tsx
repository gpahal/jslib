export function Counter({ count }: { count: number }) {
  return <div>{count && <span>{count}</span>}</div>
}
