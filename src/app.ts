import express from 'express'
import { generateIcal } from './ical'
import logger from './helpers/logger'

const {
  SYNC_ID_AS_URL,
  ACTUAL_SYNC_ID,
} = process.env

const app = express()

app.disable('x-powered-by')

const resolvePath = () => {
  if (SYNC_ID_AS_URL === 'true') {
    const urlPath = `/${ACTUAL_SYNC_ID}.ics`
    logger.debug({ urlPath }, 'Using SyncID as URL')

    return urlPath
  }

  return '/actual.ics'
}

app.get(resolvePath(), async (_req, res) => {
  try {
    const iCalString = await generateIcal()

    res.header('Content-Type', 'text/calendar; charset=utf-8')
    res.header('Content-Disposition', 'attachment; filename="calendar.ics"')

    res.send(iCalString)
  } catch (err) {
    logger.error({ err, errorMessage: err instanceof Error ? err.message : String(err) }, 'Error generating iCal')
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/healthcheck', (_req, res) => {
  res.send('OK')
})

export default app
