import * as actualApi from '@actual-app/api'
import ical, { ICalCalendarMethod } from 'ical-generator'
import { RRule } from 'rrule'
import { DateTime, DurationLikeObject } from 'luxon'
import { RecurConfig, ScheduleEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import { formatCurrency } from './helpers/number'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import logger from './helpers/logger'

const {
  ACTUAL_SERVER,
  ACTUAL_MAIN_PASSWORD,
  ACTUAL_SYNC_ID,
  ACTUAL_SYNC_PASSWORD,
  ACTUAL_PATH = '.actual-cache',
  TZ = 'UTC',
  CLEAR_CACHE_ON_ERROR = 'true',
} = process.env

if (!ACTUAL_SERVER || !ACTUAL_MAIN_PASSWORD || !ACTUAL_SYNC_ID) {
  throw new Error('Missing ACTUAL_SERVER, ACTUAL_MAIN_PASSWORD or ACTUAL_SYNC_ID')
}

// * Extract error message from multiple sources
const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.stack || String(error)
  }

  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>
    // * Check common error properties
    if (errorObj.message && typeof errorObj.message === 'string') {
      return errorObj.message
    }
    if (errorObj.stack && typeof errorObj.stack === 'string') {
      return errorObj.stack
    }
    if (errorObj.reason && typeof errorObj.reason === 'string') {
      return errorObj.reason
    }
    // * Check for other common error properties from APIs
    if (errorObj.error && typeof errorObj.error === 'string') {
      return errorObj.error
    }
    if (errorObj.code && typeof errorObj.code === 'string') {
      return errorObj.code
    }
    if (errorObj.details && typeof errorObj.details === 'string') {
      return errorObj.details
    }
  }

  return String(error)
}

// * Extract error stack trace if available
const extractErrorStack = (error: unknown): string | undefined => {
  if (error instanceof Error && error.stack) {
    return error.stack
  }
  
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>
    if (errorObj.stack && typeof errorObj.stack === 'string') {
      return errorObj.stack
    }
  }
  
  return undefined
}

// * Check if error is migration-related by checking multiple sources
const isMigrationError = (error: unknown): boolean => {
  const errorMessage = extractErrorMessage(error).toLowerCase()
  const errorStack = extractErrorStack(error)?.toLowerCase() || ''
  const combinedText = `${errorMessage} ${errorStack}`

  const migrationKeywords = [
    'out-of-sync-migrations',
    'migration',
    'timestamp',
    'database is out of sync',
    'appliedids',
    'available',
    'error updating',  // From the logs: "Error updating Error: out-of-sync-migrations"
    'migrate',  // Migration function calls
  ]

  return migrationKeywords.some(keyword => combinedText.includes(keyword.toLowerCase()))
}

// * Categorize error type for better diagnostics
const categorizeError = (error: unknown): string => {
  const errorMessage = extractErrorMessage(error).toLowerCase()
  const errorStack = extractErrorStack(error)?.toLowerCase() || ''

  // * Check for migration errors first, since they're most common
  if (isMigrationError(error)) {
    return 'MIGRATION_ERROR'
  }

  if (errorMessage.includes('network') || errorMessage.includes('connection') || errorMessage.includes('timeout')) {
    return 'NETWORK_ERROR'
  }

  if (errorMessage.includes('auth') || errorMessage.includes('password') || errorMessage.includes('credential')) {
    return 'AUTHENTICATION_ERROR'
  }

  if (errorMessage.includes('sync') && errorMessage.includes('id')) {
    return 'SYNC_ID_ERROR'
  }

  if (errorMessage.includes('server') && (errorMessage.includes('url') || errorMessage.includes('host'))) {
    return 'SERVER_URL_ERROR'
  }

  // * Check for budget download errors (this is where migration errors often manifest)
  if (errorStack.includes('download-budget') || errorStack.includes('downloadbudget') ||
      errorMessage.includes('download-budget') || errorMessage.includes('downloadbudget')) {
    return 'BUDGET_DOWNLOAD_ERROR'
  }

  return 'UNKNOWN_ERROR'
}

// * Track if we're currently handling a migration error to prevent infinite loops
let isHandlingMigrationError = false

// Actual SDK throws unhandled exceptions on downloadBudget if the SyncID is wrong, which breaks the app
// This should be fixed on Actual SDK side, but for now we can just ignore unhandled exceptions
// This may hide other issues, but it's better than breaking the app
process.on('uncaughtException', (error) => {
  const errorMessage = extractErrorMessage(error)
  const errorStack = extractErrorStack(error)
  const errorType = error?.constructor?.name || typeof error
  
  logger.error({ 
    error,
    errorMessage,
    errorStack,
    errorType,
    errorProperties: typeof error === 'object' && error !== null ? Object.keys(error) : [],
    isMigrationError: isMigrationError(error),
  }, 'Unhandled exception')
  
  // * If it's a migration error and we haven't handled it yet, try to clear cache
  if (isMigrationError(error) && !isHandlingMigrationError && CLEAR_CACHE_ON_ERROR === 'true') {
    isHandlingMigrationError = true
    logger.warn('Migration error detected in uncaught exception, clearing cache...')
    try {
      clearCache()
      logger.info('Cache cleared successfully from uncaught exception handler')
    } catch (clearError) {
      logger.error({ clearError }, 'Failed to clear cache from uncaught exception handler')
    } finally {
      isHandlingMigrationError = false
    }
  }
})

const clearCache = () => {
  if (existsSync(ACTUAL_PATH)) {
    logger.warn({ cachePath: ACTUAL_PATH }, 'Clearing corrupted cache directory')
    try {
      rmSync(ACTUAL_PATH, { recursive: true, force: true })
      logger.info('Cache directory cleared successfully')
    } catch (clearError) {
      logger.error({ clearError }, 'Failed to clear cache directory')
      throw clearError
    }
  }
  mkdirSync(ACTUAL_PATH, { recursive: true })
}

const getSchedules = async (retryOnMigrationError = true) => {
  try {
    if (!existsSync(ACTUAL_PATH)) {
      logger.debug('Creating directory:', ACTUAL_PATH)
      mkdirSync(ACTUAL_PATH, { recursive: true })
    }

    logger.info({
      serverURL: ACTUAL_SERVER,
      syncId: ACTUAL_SYNC_ID ? ACTUAL_SYNC_ID.substring(0, 8) + '...' : undefined,
      cachePath: ACTUAL_PATH,
      hasSyncPassword: !!ACTUAL_SYNC_PASSWORD
    }, 'Initializing Actual API connection')

    await actualApi.init({
      dataDir: ACTUAL_PATH,
      serverURL: ACTUAL_SERVER,
      password: ACTUAL_MAIN_PASSWORD,
    })
    logger.debug('Actual API initialized successfully')

    logger.info('Downloading budget data...')
    await actualApi.downloadBudget(ACTUAL_SYNC_ID, {
      password: ACTUAL_SYNC_PASSWORD,
    })
    logger.debug('Budget downloaded successfully')

    logger.debug('Querying schedules from database')
    const query = actualApi.q('schedules')
      .filter({
        tombstone: false,
      })
      .select(['*'])

    const { data } = await actualApi.runQuery(query) as { data: ScheduleEntity[] }
    logger.info({ scheduleCount: data.length }, 'Successfully retrieved schedules')

    return data
  } catch (error) {
    const errorMessage = extractErrorMessage(error)
    const errorStack = extractErrorStack(error)
    const errorType = error?.constructor?.name || typeof error
    const migrationErrorDetected = isMigrationError(error)
    const errorCategory = categorizeError(error)

    // * Log detailed error information
    logger.error({
      error,
      errorMessage,
      errorStack,
      errorType,
      errorCategory,
      errorProperties: typeof error === 'object' && error !== null ? Object.keys(error) : [],
      isMigrationError: migrationErrorDetected,
      retryOnMigrationError,
      clearCacheOnError: CLEAR_CACHE_ON_ERROR,
      environment: {
        ACTUAL_SERVER: ACTUAL_SERVER ? 'SET' : 'MISSING',
        ACTUAL_MAIN_PASSWORD: ACTUAL_MAIN_PASSWORD ? 'SET' : 'MISSING',
        ACTUAL_SYNC_ID: ACTUAL_SYNC_ID ? 'SET' : 'MISSING',
        ACTUAL_SYNC_PASSWORD: ACTUAL_SYNC_PASSWORD ? 'SET' : 'MISSING',
        ACTUAL_PATH,
        NODE_ENV: process.env.NODE_ENV,
      }
    }, 'Error fetching schedules')

    // * If it's a migration error and we haven't retried yet, clear cache and retry
    if (migrationErrorDetected && retryOnMigrationError && CLEAR_CACHE_ON_ERROR === 'true') {
      logger.warn('Migration sync error detected, clearing cache and retrying...')
      isHandlingMigrationError = true
      try {
        clearCache()
        logger.info('Cache cleared successfully, retrying...')
        return getSchedules(false)
      } catch (clearError) {
        logger.error({ clearError }, 'Failed to clear cache during retry')
        isHandlingMigrationError = false
        throw new Error(`Failed to fetch schedules: ${extractErrorMessage(error)} (cache clear also failed: ${extractErrorMessage(clearError)})`)
      } finally {
        isHandlingMigrationError = false
      }
    }

    // * Provide user-friendly error message based on error category
    let userFriendlyMessage = `Failed to fetch schedules: ${errorMessage}`

    switch (errorCategory) {
      case 'NETWORK_ERROR':
        userFriendlyMessage = 'Network connection failed. Check if your remote server can reach the Actual Budget server.'
        break
      case 'AUTHENTICATION_ERROR':
        userFriendlyMessage = 'Authentication failed. Check your ACTUAL_MAIN_PASSWORD and ACTUAL_SYNC_PASSWORD.'
        break
      case 'SYNC_ID_ERROR':
        userFriendlyMessage = 'Invalid Sync ID. Check your ACTUAL_SYNC_ID setting.'
        break
      case 'SERVER_URL_ERROR':
        userFriendlyMessage = 'Server URL issue. Check your ACTUAL_SERVER URL and ensure it\'s accessible.'
        break
      case 'BUDGET_DOWNLOAD_ERROR':
        userFriendlyMessage = 'Failed to download budget data. This could be a server issue or corrupted cache.'
        break
      case 'MIGRATION_ERROR':
        userFriendlyMessage = 'Database version mismatch detected. This usually happens when the Actual server and client are on different versions. Cache will be cleared and retried automatically.'
        break
      default:
        userFriendlyMessage = `Connection error: ${errorMessage || 'Unknown error occurred'}`
    }

    throw new Error(userFriendlyMessage)
  }
}

const resolveFrequency = (frequency: string) => {
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

export const generateIcal = async () => {
  const schedules = await getSchedules()
  const today = DateTime.now()

  logger.debug(`Found ${schedules.length} schedules`)

  const calendar = ical({
    name: 'Actual Balance iCal',
    // Homepage use an ical-date-parser, which breaks with timezone configured calendars
    // https://github.com/zxqx/ical-date-parser/issues/3
    // timezone: TZ,
  })

  // A method is required for outlook to display event as an invitation
  calendar.method(ICalCalendarMethod.REQUEST)

  // * If no schedules, add a placeholder event to make the calendar valid and informative
  if (schedules.length === 0) {
    calendar.createEvent({
      start: today.toJSDate(),
      summary: 'No scheduled transactions found',
      description: 'You don\'t have any active scheduled transactions in Actual. Add some schedules in Actual to see them here.',
      allDay: true,
      timezone: TZ,
    })
    return { calendarString: calendar.toString(), scheduleCount: 0 }
  }

  for (const schedule of schedules) {
    logger.debug(schedule, 'Processing Schedule')
    const recurringData = schedule._date
    const nextDate = DateTime.fromISO(schedule.next_date)

    const getEndDate = () => {
      if (recurringData.endMode === 'never') {
        return
      }

      if (recurringData.endMode === 'after_n_occurrences') {
        const windowMap = {
          daily: 'day',
          weekly: 'week',
          monthly: 'month',
          yearly: 'year',
        } satisfies Record<RecurConfig['frequency'], keyof DurationLikeObject>

        return DateTime.fromISO(recurringData.start).plus({
          [windowMap[recurringData.frequency]]: recurringData.endOccurrences,
        }).toJSDate()
      }

      if (!recurringData.endDate) {
        return
      }

      return DateTime.fromISO(recurringData.endDate).toJSDate()
    }

    const getStartDate = () => {
      if (recurringData.endMode ===  'never') {
        return nextDate.toJSDate()
      }

      return DateTime.fromISO(recurringData.start).toJSDate()
    }

    const getCount = () => {
      if (recurringData.endMode ===  'never') {
        const nextDateDiff = today.diff(nextDate, 'days').days

        // nextDate is in the future
        if (nextDateDiff < 0) {
          if (recurringData.frequency === 'daily') {
            return 30
          }

          if (recurringData.frequency === 'weekly') {
            return 4
          }

          if (recurringData.frequency === 'monthly') {
            return 12
          }

          return 2
        }

        if (recurringData.frequency === 'daily') {
          return Math.ceil(nextDateDiff)
        }

        if (recurringData.frequency === 'weekly') {
          return Math.ceil(nextDateDiff / 7)
        }

        if (recurringData.frequency === 'monthly') {
          return Math.ceil(nextDateDiff / 30)
        }

        return Math.ceil(nextDateDiff / 365)
      }

      if (recurringData.endMode === 'after_n_occurrences') {
        return recurringData.endOccurrences
      }

      return
    }

    const formatAmount = () => {
      const amount = schedule._amount
      if (typeof amount === 'number') {
        return formatCurrency(amount)
      }

      return `${formatCurrency(amount.num1)} ~ ${formatCurrency(amount.num2)}`
    }

    // Handle non-recurring schedules separately
    if (!recurringData.frequency) {
      logger.debug(`Generating single event for ${schedule.name}`)

      calendar.createEvent({
        start: nextDate.toJSDate(),
        summary: `${schedule.name} (${formatAmount()})`,
        allDay: true,
        timezone: TZ,
      })
      continue
    }

    // Only create RRule for recurring schedules
    const ruleOptions = {
      freq: resolveFrequency(recurringData.frequency),
      dtstart: getStartDate(),
      until: getEndDate(),
      count: getCount(),
      interval: 1,
      tzid: TZ,
    }

    logger.debug(ruleOptions, schedule.name)
    const rule = new RRule(ruleOptions)

    logger.debug(`Generating events for ${schedule.name}. ${rule.count()} events`)

    const moveOnWeekend = (date: Date) => {
      const dateTime = DateTime.fromJSDate(date)

      if (!recurringData.skipWeekend) {
        return dateTime
      }

      if (dateTime.weekday !== 6 && dateTime.weekday !== 7) {
        return dateTime
      }

      if (recurringData.weekendSolveMode === 'after') {
        const daysToMove = dateTime.weekday === 6 ? 2 : 1
        return dateTime.plus({ days: daysToMove })
      }

      if (recurringData.weekendSolveMode === 'before') {
        const daysToMove = dateTime.weekday === 6 ? -1 : -2
        return dateTime.plus({ days: daysToMove })
      }

      throw new Error('Invalid weekendSolveMode')
    }

    rule.all()
      .filter((date) => {
        return DateTime.fromJSDate(date) >= nextDate
      })
      .map((date) => {
        return calendar.createEvent({
          start: moveOnWeekend(date).toJSDate(),
          summary: `${schedule.name} (${formatAmount()})`,
          allDay: true,
          timezone: TZ,
        })
      })
  }

  return { calendarString: calendar.toString(), scheduleCount: schedules.length }
}
