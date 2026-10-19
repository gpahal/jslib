/**
 * `stylelint-config-recess-order` ships no types. Its `groups` export is the property groups that
 * its config passes to `order/properties-order`
 */
declare module 'stylelint-config-recess-order/groups' {
  const groups: Array<{ properties: Array<string> }>
  export default groups
}
