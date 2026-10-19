// A PIXI container's `appendChild` isn't the DOM's
export function add(stage, sprite) {
  stage.appendChild(sprite)
}
