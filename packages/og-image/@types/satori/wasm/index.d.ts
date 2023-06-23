declare module 'satori/wasm' {
  import { ReactNode } from 'react'
  import { SatoriOptions } from 'satori'
  import * as yoga_layout from 'yoga-layout'

  declare let Yoga: typeof yoga_layout
  declare function init(yoga: typeof Yoga): void

  declare function satori(element: ReactNode, options: SatoriOptions): Promise<string>

  export { SatoriOptions, satori as default, init }
}
