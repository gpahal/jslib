export function deferred(): { promise: Promise<void>; resolve: () => void } {
  const { promise, resolve }: PromiseWithResolvers<void> = Promise.withResolvers()
  return { promise, resolve: () => resolve() }
}
