import { CODE_BLOCK_FILES } from '@/internal/files'
import type { TypedConfig } from '@/internal/types'

/**
 * Code blocks in Markdown are examples, not documented modules
 */
export function commentLayout({ files }: { files: Array<string> }): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/comment-layout/rules',
      files,
      ignores: CODE_BLOCK_FILES,
      rules: {
        '@gpahal/comment-layout': 'error',
      },
    },
  ]
}
