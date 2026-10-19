// An interface merges with another declaration of the same name, as a module augmentation adds
// one, and the `Record` type alias that the fix writes can't
export interface Scores {
  [name: string]: number
}
