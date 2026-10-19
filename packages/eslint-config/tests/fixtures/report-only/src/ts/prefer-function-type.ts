// An interface merges with another declaration of the same name, as a module augmentation adds
// one, and the type alias that the fix writes can't
export interface Handler {
  (event: string): void
}
