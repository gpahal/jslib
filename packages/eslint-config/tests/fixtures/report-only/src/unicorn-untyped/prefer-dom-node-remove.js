// A PIXI container's `removeChild` isn't the DOM's
export function remove(stage, sprite) {
  stage.removeChild(sprite)
}
