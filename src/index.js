require('dotenv').config()
const express = require('express')
const fetch = require('node-fetch')
const { parseTextWithAI, parsePhotoWithAI, downloadWhatsAppMedia } = require('./ai')
const {
  getUserByPhone,
  connectUser,
  connectUserByCode,
  disconnectUser,
  saveTransaction,
  getTransactions,
  getBalance,
  getMonthlyBalance,
  hasSeenWelcome,
  markWelcomeSeen
} = require('./db')
const { sendMessage, sendImage, sendButtons, markRead, formatINR } = require('./whatsapp')
const {
  getSession, setSession, clearSession,
  getPreview, setPreview,
  getPendingBulk, setPendingBulk, clearPendingBulk,
  checkNlpLimit, checkScanLimit
} = require('./session')

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

// ─── Image URLs ───────────────────────────────────────────────────────────────
const BASE_URL = process.env.APP_URL || 'https://app.sadabmunshi.online'
const WELCOME_IMAGE = `${BASE_URL}/finflow-logo.png`

// ─── Startup check ────────────────────────────────────────────────────────────
const required = [
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'SARVAM_API_KEY',
  'GEMINI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APP_URL',
  'WEBHOOK_SECRET'
]
for (const key of required) {
  if (!process.env[key]) console.warn(`[STARTUP] ⚠️  Missing env var: ${key}`)
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'FinFlow WhatsApp', time: new Date().toISOString() })
})

// ─── Webhook verify ───────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge)
  } else {
    res.sendStatus(403)
  }
})

// ─── Webhook handler ──────────────────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  res.sendStatus(200)

  const body = req.body
  if (body.object !== 'whatsapp_business_account') return
  const value = body.entry?.[0]?.changes?.[0]?.value
  if (!value?.messages) return

  const message = value.messages[0]
  const from = message.from

  processMessage(from, message).catch(err => {
    console.error('[Webhook Error]', err.message)
  })
})

// ─── Process incoming message (async, non-blocking) ───────────────────────────
async function processMessage(from, message) {
  try {
    await markRead(message.id)

    if (message.type === 'interactive') {
      await handleButtonReply(from, message.interactive?.button_reply?.id)
      return
    }

    if (message.type === 'image') {
      await handlePhotoMessage(from, message.image)
      return
    }

    if (message.type === 'text') {
      await handleTextMessage(from, message.text.body.trim())
      return
    }

    await sendMessage(from, '📝 Please send a text message or photo receipt.')
  } catch (err) {
    console.error('[Process Error]', err.message)
    try {
      await sendMessage(from, '⚠️ Something went wrong. Please try again.')
    } catch (e) {
      console.error('[Recovery Message Failed]', e.message)
    }
  }
}

// ─── Handle text messages ─────────────────────────────────────────────────────
async function handleTextMessage(from, text) {
  const lower = text.toLowerCase().trim()

  // ── Connect via link code ─────────────────────────────────────────────────
  if (text.startsWith('connect_')) {
    const code = text.slice('connect_'.length)
    const result = await connectUserByCode(code, from)
    if (result.ok) {
      await sendMessage(from,
        `✅ *WhatsApp Connected!*\n` +
        `──────────────────\n` +
        `Welcome to FinFlow! 🎉\n\n` +
        `Your WhatsApp is now linked.\n` +
        `Start adding transactions:\n\n` +
        `💬 _"spent 500 on lunch"_\n` +
        `💬 _"received 50000 salary"_\n` +
        `📷 Or send a receipt photo\n\n` +
        `Type *help* to see all commands.\n` +
        `──────────────────`
      )
    } else {
      await sendMessage(from,
        `❌ *Invalid or expired connect code*\n\n` +
        `Please try again:\n` +
        `1️⃣  Open FinFlow app\n` +
        `2️⃣  Go to Settings → WhatsApp\n` +
        `3️⃣  Tap *Open WhatsApp* again`
      )
    }
    return
  }

  const user = await getUserByPhone(from)

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!user) {
    const firstTime = !hasSeenWelcome(from)
    if (firstTime) {
      markWelcomeSeen(from)
      try {
        await sendImage(from, WELCOME_IMAGE,
          `👋 Welcome to *FinFlow*\nYour personal finance assistant`
        )
        await new Promise(r => setTimeout(r, 800))
      } catch (e) {
        console.error('[Welcome Image Failed]', e.message)
      }
    }
    await sendMessage(from,
      `*Account not linked* 🔗\n\n` +
      `To connect your FinFlow account:\n` +
      `1️⃣  Open the FinFlow app\n` +
      `2️⃣  Go to Settings → WhatsApp\n` +
      `3️⃣  Tap *Open WhatsApp* button\n\n` +
      `You will be connected automatically!`
    )
    return
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  // Help
  if (lower === 'help' || lower === '/help') {
    await sendMessage(from,
      `*FinFlow Bot* — Help\n` +
      `──────────────────\n\n` +
      `*Add a transaction:*\n` +
      `Just type naturally 💬\n` +
      `_"spent 500 on lunch"_\n` +
      `_"received 50000 salary"_\n` +
      `_"Kal 3000 ki grocery li"_\n\n` +
      `📷 Or send a *receipt photo*\n\n` +
      `*Commands:*\n` +
      `• preview on — Enable transaction preview\n` +
      `• preview off — Disable preview (default)\n` +
      `• balance — All time summary\n` +
      `• monthly — This month summary\n` +
      `• recent — Last 5 transactions\n` +
      `• disconnect — Unlink account\n` +
      `• help — Show this message\n\n` +
      `_Supports English, Hindi & Bengali_`
    )
    return
  }

  // Preview on/off
  if (lower === 'preview on') {
    setPreview(from, true)
    await sendMessage(from,
      `✅ *Preview enabled*\n\nYou'll see transaction details before saving. Send *preview off* to disable.`
    )
    return
  }

  if (lower === 'preview off') {
    setPreview(from, false)
    await sendMessage(from,
      `✅ *Preview disabled*\n\nTransactions will save instantly. Send *preview on* to enable preview.`
    )
    return
  }

  // Balance
  const balanceCommands = ['balance', '/balance', 'check my balance', 'check balance']
  if (balanceCommands.includes(lower)) {
    const b = await getBalance(user.user_id)
    const savingsRate = b.income > 0
      ? Math.round(((b.income - b.expense) / b.income) * 100)
      : 0
    await sendMessage(from,
      `💰 *Balance Summary*\n` +
      `──────────────────\n` +
      `🟢  Income:   *${formatINR(b.income)}*\n` +
      `🔴  Expense:  *${formatINR(b.expense)}*\n` +
      `🏦  Balance:  *${formatINR(b.balance)}*\n` +
      `📈  Savings:  ${savingsRate}%\n` +
      `──────────────────\n` +
      `_All time summary_`
    )
    return
  }

  // Monthly
  if (lower === 'monthly' || lower === '/monthly') {
    const m = await getMonthlyBalance(user.user_id)
    const month = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    const savingsRate = m.income > 0
      ? Math.round(((m.income - m.expense) / m.income) * 100)
      : 0
    await sendMessage(from,
      `📅 *${month}*\n` +
      `──────────────────\n` +
      `🟢  Income:   *${formatINR(m.income)}*\n` +
      `🔴  Expense:  *${formatINR(m.expense)}*\n` +
      `🏦  Balance:  *${formatINR(m.balance)}*\n` +
      `📈  Savings:  ${savingsRate}%\n` +
      `──────────────────`
    )
    return
  }

  // Recent
  if (lower === 'recent' || lower === '/recent') {
    const txs = await getTransactions(user.user_id)
    if (!txs.length) {
      await sendMessage(from, '📭 No transactions yet.\n\nType something like _"spent 500 on lunch"_ to add one.')
      return
    }
    const list = txs.map(t => {
      const emoji = t.type === 'income' ? '🟢' : '🔴'
      return `${emoji}  *${formatINR(t.amount)}*  ${t.category}\n    📝 ${t.note || '—'}  ·  📅 ${t.date}`
    }).join('\n\n')

    await sendMessage(from,
      `📋 *Recent Transactions*\n` +
      `──────────────────\n\n` +
      `${list}\n\n` +
      `──────────────────\n` +
      `_Showing last ${txs.length} transactions_`
    )
    return
  }

  // Disconnect
  if (lower === 'disconnect' || lower === '/disconnect') {
    await sendButtons(from,
      `⚠️ *Disconnect Account?*\n\n` +
      `This will unlink your WhatsApp from FinFlow.\n` +
      `Your data will remain safe in the app.`,
      [
        { id: 'confirm_disconnect', title: '✅ Yes, disconnect' },
        { id: 'cancel', title: '❌ Cancel' }
      ]
    )
    return
  }

  // "Add a transaction" icebreaker tap
  if (lower === 'add a transaction') {
    await sendMessage(from,
      `✏️ *Add a Transaction*\n\n` +
      `Just type naturally:\n\n` +
      `💬  _"spent 500 on lunch"_\n` +
      `💬  _"received 50000 salary"_\n` +
      `💬  _"paid 1200 electricity"_\n\n` +
      `Or send a 📷 *receipt photo*`
    )
    return
  }

  // ── Parse as transaction ──────────────────────────────────────────────────

  // Rate limit: 30 NLP (Sarvam) requests per 5 hours per phone number
  const nlpCheck = checkNlpLimit(from)
  if (!nlpCheck.allowed) {
    await sendMessage(from,
      `⏱️ *Too many requests*\n\n` +
      `You've reached the limit of 30 transactions per 5 hours.\n` +
      `Please try again in *${nlpCheck.resetInMinutes} minute${nlpCheck.resetInMinutes !== 1 ? 's' : ''}*.\n\n` +
      `_This limit keeps the service fast and fair for everyone._`
    )
    return
  }

  await sendMessage(from, '⏳ _Processing..._')
  const parsed = await parseTextWithAI(text)

  if (!parsed || (Array.isArray(parsed) ? parsed.length === 0 : !parsed.amount)) {
    await sendMessage(from,
      `❌ *Couldn't understand that*\n\n` +
      `Try:\n` +
      `• _"spent 500 on lunch"_\n` +
      `• _"received 50000 salary"_\n\n` +
      `Type *help* for all commands`
    )
    return
  }

  if (Array.isArray(parsed)) {
    await handleBulkResult(from, parsed, user.user_id)
  } else {
    if (getPreview(from)) {
      await showTransactionPreview(from, parsed, user.user_id)
    } else {
      await saveAndConfirm(from, parsed, user.user_id)
    }
  }
}

// ─── Handle photo messages ────────────────────────────────────────────────────
async function handlePhotoMessage(from, image) {
  const user = await getUserByPhone(from)
  if (!user) {
    await sendMessage(from, '🔗 Please link your account first. Type *help* for instructions.')
    return
  }

  // Rate limit: 15 receipt scans (Gemini) per 5 hours per phone number
  const scanCheck = checkScanLimit(from)
  if (!scanCheck.allowed) {
    await sendMessage(from,
      `⏱️ *Too many receipt scans*\n\n` +
      `You've reached the limit of 15 receipt scans per 5 hours.\n` +
      `Please try again in *${scanCheck.resetInMinutes} minute${scanCheck.resetInMinutes !== 1 ? 's' : ''}*.\n\n` +
      `_You can still add transactions by typing them manually._`
    )
    return
  }

  await sendMessage(from, '🔍 _Scanning your receipt..._')

  let fileData
  try {
    fileData = await downloadWhatsAppMedia(image.id)
  } catch (err) {
    console.error('[Photo Download Error]', err.message)
    await sendMessage(from,
      `❌ *Could not download image*\n\n` +
      `Please try sending the photo again.\n` +
      `Or type the transaction manually.`
    )
    return
  }

  if (!fileData) {
    await sendMessage(from,
      `❌ *Could not download image*\n\n` +
      `Please try sending the photo again.\n` +
      `Or type the transaction manually.`
    )
    return
  }

  const parsed = await parsePhotoWithAI(fileData.base64, fileData.mimeType)

  if (!parsed || (Array.isArray(parsed) ? parsed.length === 0 : !parsed.amount)) {
    await sendMessage(from,
      `❌ *Could not read receipt*\n\n` +
      `Make sure:\n` +
      `• Receipt is clear and well-lit\n` +
      `• Text is readable\n\n` +
      `Or type the transaction manually`
    )
    return
  }

  if (Array.isArray(parsed)) {
    await handleBulkResult(from, parsed, user.user_id)
  } else {
    if (getPreview(from)) {
      await showTransactionPreview(from, parsed, user.user_id)
    } else {
      await saveAndConfirm(from, parsed, user.user_id)
    }
  }
}

// ─── Save a single transaction and confirm without preview ────────────────────
async function saveAndConfirm(from, parsed, userId) {
  try {
    const { error } = await saveTransaction(userId, parsed)
    if (error) {
      await sendMessage(from, '❌ Failed to save. Please try again.')
      return
    }
    const typeEmoji = parsed.type === 'income' ? '🟢' : '🔴'
    const typeLabel = parsed.type === 'income' ? 'Income' : 'Expense'
    await sendMessage(from,
      `✅ *Saved to FinFlow*\n` +
      `──────────────────\n` +
      `${typeEmoji}  *${formatINR(parsed.amount)}*\n` +
      `📂  ${parsed.category}  ·  ${typeLabel}\n` +
      `📅  ${parsed.date}\n` +
      `📝  ${parsed.note || '—'}\n` +
      `──────────────────\n` +
      `_Open the app to view all transactions_`
    )
    if (parsed.type === 'expense') {
      triggerBudgetAlert(userId).catch(err => {
        console.error('[Budget Alert Fire Error]', err.message)
      })
    }
  } catch (err) {
    console.error('[Save Error]', err.message)
    await sendMessage(from, '❌ Failed to save. Please try again.')
  }
}

// ─── Handle bulk transactions (array result from AI) ─────────────────────────
async function handleBulkResult(from, transactions, userId) {
  try {
    if (getPreview(from)) {
      setPendingBulk(from, { transactions, userId })
      const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0)
      const lines = transactions.map(t => {
        const emoji = t.type === 'income' ? '🟢' : '🔴'
        return `${emoji} ${formatINR(t.amount)} · ${t.category}${t.note ? ' · ' + t.note : ''}`
      }).join('\n')
      await sendButtons(from,
        `📋 *${transactions.length} Transactions Found*\n` +
        `──────────────────\n` +
        `${lines}\n` +
        `──────────────────\n` +
        `Total: ${formatINR(total)}\n\n` +
        `Save all transactions?`,
        [
          { id: 'confirm_save_all', title: '✅ Save All' },
          { id: 'cancel', title: '❌ Cancel' }
        ]
      )
    } else {
      const results = await saveBulkTransactions(userId, transactions)
      const saved = results.filter(r => !r.error)
      const failed = results.filter(r => r.error)
      const expenseTotal = saved.filter(r => r.tx.type === 'expense').reduce((sum, r) => sum + Number(r.tx.amount), 0)
      const lines = saved.map(r => {
        const emoji = r.tx.type === 'income' ? '🟢' : '🔴'
        return `${emoji} ${formatINR(r.tx.amount)} · ${r.tx.category}`
      }).join('\n')
      let msg =
        `✅ *${saved.length} Transaction${saved.length !== 1 ? 's' : ''} Saved*\n` +
        `──────────────────\n` +
        `${lines}\n` +
        `──────────────────\n` +
        `Total spent: ${formatINR(expenseTotal)}`
      if (failed.length) {
        msg += `\n\n⚠️ ${failed.length} transaction(s) failed to save.`
      }
      await sendMessage(from, msg)
      if (saved.some(r => r.tx.type === 'expense')) {
        triggerBudgetAlert(userId).catch(err => {
          console.error('[Budget Alert Fire Error]', err.message)
        })
      }
    }
  } catch (err) {
    console.error('[Bulk Handle Error]', err.message)
    await sendMessage(from, '❌ Failed to process bulk transactions. Please try again.')
  }
}

// ─── Save multiple transactions, collect results ──────────────────────────────
async function saveBulkTransactions(userId, transactions) {
  const results = []
  for (const tx of transactions) {
    try {
      const { error } = await saveTransaction(userId, tx)
      results.push({ tx, error: error || null })
    } catch (err) {
      results.push({ tx, error: err.message })
    }
  }
  return results
}

// ─── Show transaction preview with confirm/cancel ─────────────────────────────
async function showTransactionPreview(from, parsed, userId) {
  setSession(from, { pending: parsed, userId, timestamp: Date.now() })

  const typeEmoji = parsed.type === 'income' ? '🟢' : '🔴'
  const typeLabel = parsed.type === 'income' ? 'Income' : 'Expense'

  const preview =
    `${typeEmoji} *Transaction Preview*\n` +
    `──────────────────\n` +
    `💵  *${formatINR(parsed.amount)}*\n` +
    `📊  ${typeLabel}\n` +
    `📂  ${parsed.category}\n` +
    `📅  ${parsed.date}\n` +
    `📝  ${parsed.note || '—'}\n` +
    `──────────────────\n` +
    `Confirm to save?`

  await sendButtons(from, preview, [
    { id: 'confirm_save', title: '✅ Save' },
    { id: 'cancel', title: '❌ Cancel' }
  ])
}

// ─── Trigger budget alert (non-blocking) ──────────────────────────────────────
async function triggerBudgetAlert(userId) {
  try {
    const appUrl = process.env.APP_URL
    const secret = process.env.WEBHOOK_SECRET
    if (!appUrl || !secret) return

    await fetch(`${appUrl}/api/notifications/budget-alert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': secret
      },
      body: JSON.stringify({ user_id: userId })
    })
  } catch (err) {
    console.error('[Budget Alert Error]', err.message)
  }
}

// ─── Handle button replies ────────────────────────────────────────────────────
async function handleButtonReply(from, buttonId) {
  const session = getSession(from)

  // Save all bulk transactions
  if (buttonId === 'confirm_save_all') {
    const bulkData = getPendingBulk(from)
    if (!bulkData || !bulkData.transactions || !bulkData.transactions.length) {
      await sendMessage(from, '⚠️ Session expired. Please send your transactions again.')
      return
    }
    const { transactions, userId } = bulkData
    clearPendingBulk(from)
    const results = await saveBulkTransactions(userId, transactions)
    const saved = results.filter(r => !r.error)
    const failed = results.filter(r => r.error)
    const expenseTotal = saved.filter(r => r.tx.type === 'expense').reduce((sum, r) => sum + Number(r.tx.amount), 0)
    const lines = saved.map(r => {
      const emoji = r.tx.type === 'income' ? '🟢' : '🔴'
      return `${emoji} ${formatINR(r.tx.amount)} · ${r.tx.category}`
    }).join('\n')
    let msg =
      `✅ *${saved.length} Transaction${saved.length !== 1 ? 's' : ''} Saved*\n` +
      `──────────────────\n` +
      `${lines}\n` +
      `──────────────────\n` +
      `Total spent: ${formatINR(expenseTotal)}`
    if (failed.length) {
      msg += `\n\n⚠️ ${failed.length} transaction(s) failed to save.`
    }
    await sendMessage(from, msg)
    if (saved.some(r => r.tx.type === 'expense')) {
      triggerBudgetAlert(userId).catch(err => {
        console.error('[Budget Alert Fire Error]', err.message)
      })
    }
    return
  }

  // Save transaction
  if (buttonId === 'confirm_save') {
    if (!session.pending) {
      await sendMessage(from, '⚠️ Session expired. Please send your transaction again.')
      return
    }
    const { error } = await saveTransaction(session.userId, session.pending)
    if (error) {
      await sendMessage(from, '❌ Failed to save. Please try again.')
      return
    }
    const p = session.pending
    const userId = session.userId
    clearSession(from)
    const typeEmoji = p.type === 'income' ? '🟢' : '🔴'
    const typeLabel = p.type === 'income' ? 'Income' : 'Expense'
    await sendMessage(from,
      `✅ *Saved to FinFlow*\n` +
      `──────────────────\n` +
      `${typeEmoji}  *${formatINR(p.amount)}*\n` +
      `📂  ${p.category}  ·  ${typeLabel}\n` +
      `📅  ${p.date}\n` +
      `📝  ${p.note || '—'}\n` +
      `──────────────────\n` +
      `_Open the app to view all transactions_`
    )

    if (p.type === 'expense') {
      triggerBudgetAlert(userId).catch(err => {
        console.error('[Budget Alert Fire Error]', err.message)
      })
    }
    return
  }

  // Disconnect confirm
  if (buttonId === 'confirm_disconnect') {
    await disconnectUser(from)
    clearSession(from)
    await sendMessage(from,
      `✅ *Account Disconnected*\n\n` +
      `Your WhatsApp has been unlinked from FinFlow.\n` +
      `Your data is safe in the app.\n\n` +
      `To reconnect, go to FinFlow app → Settings → Connect WhatsApp`
    )
    return
  }

  // Cancel
  if (buttonId === 'cancel') {
    clearSession(from)
    await sendMessage(from, "↩️ Cancelled. Send a transaction whenever you're ready.")
    return
  }
}

// ─── Send notification ────────────────────────────────────────────────────────
app.post('/send-notification', async (req, res) => {
  try {
    if (req.headers['x-bot-secret'] !== process.env.WEBHOOK_SECRET) {
      return res.sendStatus(403)
    }

    const { phone, type } = req.body

    if (!phone || !type) {
      return res.status(400).json({ ok: false, error: 'phone and type are required' })
    }

    if (type === 'disconnected') {
      await sendMessage(phone,
        `🔗 *Account Disconnected*\n` +
        `──────────────────\n` +
        `Your WhatsApp has been unlinked from FinFlow.\n` +
        `Your data is safe in the app.\n` +
        `To reconnect: Settings → Connect WhatsApp\n` +
        `──────────────────`
      )
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Send Notification Error]', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 FinFlow WhatsApp Bot running on port ${PORT}`)
})
