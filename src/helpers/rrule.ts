import { RRule } from 'rrule'

export const resolveFrequency = (frequency: string) => {
  switch (frequency) {
    case 'yearly':
      return RRule.YEARLY
    case 'monthly':
      return RRule.MONTHLY
    case 'weekly':
      return RRule.WEEKLY
    case 'daily':
      return RRule.DAILY
    default:
      throw new Error(`Invalid frequency: ${frequency}`)
  }
}
