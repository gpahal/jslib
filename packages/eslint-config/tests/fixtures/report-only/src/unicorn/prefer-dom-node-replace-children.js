// `innerHTML = ''` on a `<template>` empties its `content`, which `replaceChildren()` leaves
export function clearRowTemplate() {
  document.getElementById('row-template').innerHTML = ''
}
