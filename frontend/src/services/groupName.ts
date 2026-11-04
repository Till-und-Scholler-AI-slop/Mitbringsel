/** The longest group name the backend accepts (after trimming whitespace). */
export const GROUP_NAME_MAX_LENGTH = 30

export type GroupNameProblem = 'empty' | 'tooLong'

/**
 * Checks a group name like the backend does (1 to 30 characters after
 * trimming) so the form can say so before sending. The backend still
 * validates; this only saves the round trip.
 */
export function validateGroupName(name: string): GroupNameProblem | null {
  const length = Array.from(name.trim()).length
  if (length === 0) return 'empty'
  if (length > GROUP_NAME_MAX_LENGTH) return 'tooLong'
  return null
}
