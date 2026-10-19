/**
 * Messages for the errors std's own modules throw, in the repo's error shape
 */

import { formatMessage } from '@/errors'

export function stdMessage(subjects: ReadonlyArray<string>, description: string): string {
  return formatMessage('@gpahal/std', subjects, description)
}
