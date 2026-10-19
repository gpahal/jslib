/* eslint react-hooks/gating: ["error", { "dynamicGating": { "source": "flags" } }] */
export function Label({ text }) {
  'use memo if(not-valid)'
  return <span>{text}</span>
}
