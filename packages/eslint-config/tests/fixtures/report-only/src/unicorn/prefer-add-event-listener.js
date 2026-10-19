// Assigning `onclick` replaces the last handler, and `addEventListener` adds one on each call
export function render(button, state) {
  button.onclick = () => {
    state.count += 1
  }
}
