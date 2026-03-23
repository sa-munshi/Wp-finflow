const fs = require('fs')
const path = require('path')

const DB_FILE = path.join(__dirname, '../data/transactions.json')

// Ensure data directory exists
function ensureDir() {
  const dir = path.dirname(DB_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// Load all data
function loadAll() {
  ensureDir()
  if (!fs.existsSync(DB_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  } catch (e) {
    return {}
  }
}

// Save all data
function saveAll(data) {
  ensureDir()
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2))
}

// ─── TEST USERS ───────────────────────────────────────────────────────────────
// Add your WhatsApp number here (no + or spaces)
// "+91 90469 39869" → "919046939869"
const TEST_USERS = {
  "919046939869": "Sadab",
  "917407486131": "Sadab"  // ← add this line
}
// Get user by phone
function getUserByPhone(phone) {
  const name = TEST_USERS[phone]
  if (!name) return null
  return { user_id: phone, name }
}

// Save transaction locally
function saveTransaction(userId, parsed) {
  try {
    const all = loadAll()
    if (!all[userId]) all[userId] = []

    const tx = {
      id: Date.now().toString(),
      amount: Number(parsed.amount),
      type: parsed.type || 'expense',
      category: parsed.category || 'Other',
      note: parsed.note || '',
      date: parsed.date || new Date().toISOString().split('T')[0],
      saved_at: new Date().toISOString()
    }

    all[userId].push(tx)
    saveAll(all)
    console.log('[LOCAL] Saved transaction:', tx)
    return { data: tx, error: null }
  } catch (err) {
    console.error('[LOCAL] Save failed:', err.message)
    return { data: null, error: err.message }
  }
}

// Get last 5 transactions
function getTransactions(userId) {
  const all = loadAll()
  return (all[userId] || []).slice(-5).reverse()
}

module.exports = { getUserByPhone, saveTransaction, getTransactions }

