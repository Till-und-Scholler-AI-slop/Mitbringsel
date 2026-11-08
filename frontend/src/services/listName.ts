/** The longest list name the backend accepts (after trimming whitespace). */
export const LIST_NAME_MAX_LENGTH = 50

export type ListNameProblem = 'empty' | 'tooLong'

/**
 * Checks a list name like the backend does (1 to 50 characters after
 * trimming) so the form can say so before sending. The backend still
 * validates; this only saves the round trip.
 */
export function validateListName(name: string): ListNameProblem | null {
  const length = Array.from(name.trim()).length
  if (length === 0) return 'empty'
  if (length > LIST_NAME_MAX_LENGTH) return 'tooLong'
  return null
}
