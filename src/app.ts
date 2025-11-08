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
    const { calendarString } = await generateIcal()

    res.header('Content-Type', 'text/calendar; charset=utf-8')
    res.header('Content-Disposition', 'attachment; filename="calendar.ics"')

    res.send(calendarString)
  } catch (err) {
    logger.error({ err, errorMessage: err instanceof Error ? err.message : String(err) }, 'Error generating iCal')
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/', async (_req, res) => {
  const calendarPath = resolvePath()
  
  try {
    // * Try to generate the calendar to check if it's working
    const { scheduleCount } = await generateIcal()
    
    const emptySchedulesWarning = scheduleCount === 0 ? `
    <div style="background: #fef3c7; border: 2px solid #fbbf24; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <strong style="color: #92400e;">⚠️ No Scheduled Transactions</strong>
      <p style="color: #78350f; margin-top: 8px; margin-bottom: 0;">You don't have any active scheduled transactions in Actual. The calendar will be empty until you add some schedules.</p>
    </div>
    ` : ''
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Actual iCal Feed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 600px;
      width: 100%;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 2em;
    }
    .status {
      display: inline-block;
      background: #10b981;
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 600;
      margin-bottom: 30px;
    }
    .info {
      background: #f3f4f6;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .info h2 {
      color: #1f2937;
      font-size: 1.2em;
      margin-bottom: 15px;
    }
    .info p {
      color: #6b7280;
      line-height: 1.6;
      margin-bottom: 10px;
    }
    .url-box {
      background: #1f2937;
      color: #10b981;
      padding: 12px;
      border-radius: 6px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.9em;
      word-break: break-all;
      margin: 15px 0;
    }
    .button {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 14px 28px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      transition: background 0.2s;
      margin-right: 10px;
      margin-top: 10px;
    }
    .button:hover {
      background: #5568d3;
    }
    .button-secondary {
      background: #6b7280;
    }
    .button-secondary:hover {
      background: #4b5563;
    }
    .instructions {
      margin-top: 30px;
      padding-top: 30px;
      border-top: 2px solid #e5e7eb;
    }
    .instructions h3 {
      color: #1f2937;
      margin-bottom: 15px;
    }
    .instructions ol {
      color: #6b7280;
      line-height: 1.8;
      padding-left: 20px;
    }
    .instructions li {
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📅 Actual iCal Feed</h1>
    <span class="status">✓ Online</span>
    ${emptySchedulesWarning}
    <div class="info">
      <h2>Calendar Feed</h2>
      <p>Your Actual scheduled transactions are available as an iCal feed.</p>
      <div class="url-box">${calendarPath}</div>
      <a href="${calendarPath}" class="button">Download Calendar</a>
      <a href="/healthcheck" class="button button-secondary">Health Check</a>
    </div>
    
    <div class="instructions">
      <h3>How to use:</h3>
      <ol>
        <li>Click "Download Calendar" to download the .ics file</li>
        <li>Or add <code>${calendarPath}</code> to your calendar app</li>
        <li>Supported apps: Google Calendar, Apple Calendar, Outlook, etc.</li>
      </ol>
    </div>
  </div>
</body>
</html>
    `
    
    res.send(html)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Actual iCal Feed - Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 600px;
      width: 100%;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 2em;
    }
    .status {
      display: inline-block;
      background: #ef4444;
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 600;
      margin-bottom: 30px;
    }
    .error {
      background: #fef2f2;
      border: 2px solid #fecaca;
      padding: 20px;
      border-radius: 8px;
      color: #991b1b;
    }
    .error pre {
      margin-top: 10px;
      font-size: 0.9em;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📅 Actual iCal Feed</h1>
    <span class="status">✗ Error</span>
    
    <div class="error">
      <strong>Failed to generate calendar:</strong>
      <pre>${errorMessage}</pre>
    </div>
  </div>
</body>
</html>
    `
    
    res.status(500).send(html)
  }
})

app.get('/healthcheck', (_req, res) => {
  res.send('OK')
})

export default app
