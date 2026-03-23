require('dotenv').config()
const express = require('express')
const { parseTextWithAI } = require('./ai')
const { getUserByPhone, saveTransaction, getTransactions } = require('./db')
const { sendMessage, sendButtons, markRead, formatINR } = require('./whatsapp')
const { getSession, setSession, clearSession } = require('./session')

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

// ─── Startup env check ────────────────────────────────────────────────────────
const required = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_VERIFY_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SARVAM_API_KEY']
for (const key of required) {
  if (!process.env[key]) console.error(`[STARTUP] Missing env var: ${key}`)
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'FinFlow WhatsApp Bot', time: new Date().toISOString() })
})

// ─── Webhook verification (Meta calls this once to verify) ────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully')
    res.status(200).send(challenge)
  } else {
    console.error('[Webhook] Verification failed')
    res.sendStatus(403)
  }
})

// ─── Webhook handler (Meta sends messages here) ───────────────────────────────
app.post('/webhook', async (req, res) => {
  // Always respond 200 immediately to Meta
  res.sendStatus(200)

  try {
    const body = req.body
    if (body.object !== 'whatsapp_business_account') return

    const entry = body.entry?.[0]
    const changes = entry?.changes?.[0]
    const value = changes?.value

    if (!value?.messages) return

    const message = value.messages[0]
    const from = message.from // sender's phone number
    const messageId = message.id

    // Mark as read
    await markRead(messageId)

    // ── Handle button replies (confirm/cancel) ────────────────────────────────
    if (message.type === 'interactive') {
      const buttonId = message.interactive?.button_reply?.id
      await handleButtonReply(from, buttonId)
      return
    }

    // ── Handle text messages ──────────────────────────────────────────────────
    if (message.type === 'text') {
      const text = message.text.body.trim()
      await handleTextMessage(from, text)
      return
    }

    // ── Unsupported message type ──────────────────────────────────────────────
    await sendMessage(from,
      'FinFlow only supports text messages for now.\n\n' +
      'Just type your transaction like:\n' +
      '"spent 500 on lunch"\n' +
      '"received 50000 salary"'
    )

  } catch (err) {
    console.error('[Webhook Error]', err.message)
  }
})

// ─── Handle text messages ─────────────────────────────────────────────────────
async function handleTextMessage(from, text) {
  // Check if user is connected
  const user = await getUserByPhone(from)

  if (!user) {
    await sendMessage(from,
      'Welcome to *FinFlow* 👋\n\n' +
      'Your WhatsApp is not linked yet.\n\n' +
      'To connect:\n' +
      '1. Open FinFlow app\n' +
      '2. Go to Settings → Connect WhatsApp\n' +
      '3. Enter your number: *+' + from + '*'
    )
    return
  }

  // Parse transaction with AI
  await sendMessage(from, '⏳ Processing...')

  const parsed = await parseTextWithAI(text)

  if (!parsed || !parsed.amount) {
    await sendMessage(from,
      '❌ Could not understand that.\n\n' +
      'Try:\n' +
      '• "spent 500 on lunch"\n' +
      '• "received 50000 salary"\n' +
      '• "paid 1200 electricity bill"'
    )
    return
  }

  // Store in session and show preview with buttons
  setSession(from, { pending: parsed, userId: user.user_id, timestamp: Date.now() })

  const typeLabel = parsed.type === 'income' ? 'Income' : 'Expense'
  const preview =
    `*Transaction Preview*\n` +
    `──────────────────\n` +
    `Amount:    ${formatINR(parsed.amount)}\n` +
    `Type:      ${typeLabel}\n` +
    `Category:  ${parsed.category}\n` +
    `Date:      ${parsed.date}\n` +
    `Note:      ${parsed.note || '—'}\n` +
    `──────────────────\n` +
    `Is this correct?`

  await sendButtons(from, preview, [
    { id: 'confirm_save', title: '✅ Save' },
    { id: 'cancel', title: '❌ Cancel' }
  ])
}

// ─── Handle button replies ────────────────────────────────────────────────────
async function handleButtonReply(from, buttonId) {
  const session = getSession(from)

  if (buttonId === 'confirm_save') {
    if (!session.pending) {
      await sendMessage(from, 'Session expired. Please send your transaction again.')
      return
    }

    const { data, error } = await saveTransaction(session.userId, session.pending)

    if (error) {
      await sendMessage(from, '❌ Failed to save. Please try again.')
      return
    }

    clearSession(from)

    const p = session.pending
    const typeLabel = p.type === 'income' ? 'Income' : 'Expense'

    await sendMessage(from,
      `✅ *Transaction Saved*\n` +
      `──────────────────\n` +
      `${formatINR(p.amount)} — ${p.category}\n` +
      `${typeLabel}  ·  ${p.date}\n` +
      `Note: ${p.note || '—'}\n` +
      `──────────────────\n` +
      `Added to FinFlow`
    )

    return
  }

  if (buttonId === 'cancel') {
    clearSession(from)
    await sendMessage(from, 'Cancelled. Send a transaction to try again.')
    return
  }
}

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 FinFlow WhatsApp Bot running on port ${PORT}`)
})
