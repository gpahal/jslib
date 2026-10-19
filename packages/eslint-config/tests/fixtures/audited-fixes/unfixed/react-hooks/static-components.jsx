/* eslint react-hooks/static-components: "error" */
export function Parent() {
  function Child() {
    return <span>child</span>
  }
  return <Child />
}
