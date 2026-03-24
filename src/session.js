// Simple in-memory session store
// Stores pending parsed transaction per user phone
const sessions = new Map()

// ─── Phone-number rate limiters ───────────────────────────────────────────────
// Each map stores phone → array of request timestamps (ms)
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000

const nlpRequests = new Map()    // Sarvam text-parse calls
const scanRequests = new Map()   // Gemini receipt-scan calls

function _trimWindow(timestamps) {
  const cutoff = Date.now() - FIVE_HOURS_MS
  return timestamps.filter(t => t > cutoff)
}

/**
 * Check NLP (Sarvam) rate limit — 30 requests per 5 hours per phone.
 * Returns { allowed: true } or { allowed: false, resetInMinutes: N }
 */
function checkNlpLimit(phone) {
  const raw = nlpRequests.get(phone) || []
  const timestamps = _trimWindow(raw)
  if (timestamps.length >= 30) {
    const resetInMs = (timestamps[0] + FIVE_HOURS_MS) - Date.now()
    return { allowed: false, resetInMinutes: Math.max(1, Math.ceil(resetInMs / 60000)) }
  }
  timestamps.push(Date.now())
  nlpRequests.set(phone, timestamps)
  return { allowed: true }
}

/**
 * Check Gemini receipt-scan rate limit — 15 requests per 5 hours per phone.
 * Returns { allowed: true } or { allowed: false, resetInMinutes: N }
 */
function checkScanLimit(phone) {
  const raw = scanRequests.get(phone) || []
  const timestamps = _trimWindow(raw)
  if (timestamps.length >= 15) {
    const resetInMs = (timestamps[0] + FIVE_HOURS_MS) - Date.now()
    return { allowed: false, resetInMinutes: Math.max(1, Math.ceil(resetInMs / 60000)) }
  }
  timestamps.push(Date.now())
  scanRequests.set(phone, timestamps)
  return { allowed: true }
}

function getSession(phone) {
  return sessions.get(phone) || { pending: null }
}

function setSession(phone, data) {
  sessions.set(phone, data)
}

function clearSession(phone) {
  sessions.delete(phone)
}

// ─── Preview preference (persists in-memory, resets on server restart) ────────
const previewEnabled = new Map()

function getPreview(phone) {
  return previewEnabled.get(phone) || false
}

function setPreview(phone, enabled) {
  previewEnabled.set(phone, enabled)
}

// ─── Pending bulk transactions for preview confirmation ───────────────────────
function getPendingBulk(phone) {
  const session = sessions.get(phone)
  return (session && session.pendingBulk) ? session.pendingBulk : null
}

function setPendingBulk(phone, transactions) {
  const session = sessions.get(phone) || {}
  sessions.set(phone, { ...session, pendingBulk: transactions, timestamp: Date.now() })
}

function clearPendingBulk(phone) {
  const session = sessions.get(phone)
  if (session) {
    delete session.pendingBulk
    sessions.set(phone, session)
  }
}

// Clean up sessions older than 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [phone, session] of sessions.entries()) {
    if (session.timestamp && now - session.timestamp > 10 * 60 * 1000) {
      sessions.delete(phone)
    }
  }
}, 5 * 60 * 1000)

// Clean up rate-limit entries beyond 5-hour window every hour
setInterval(() => {
  for (const [phone, timestamps] of nlpRequests.entries()) {
    const trimmed = _trimWindow(timestamps)
    if (trimmed.length === 0) nlpRequests.delete(phone)
    else nlpRequests.set(phone, trimmed)
  }
  for (const [phone, timestamps] of scanRequests.entries()) {
    const trimmed = _trimWindow(timestamps)
    if (trimmed.length === 0) scanRequests.delete(phone)
    else scanRequests.set(phone, trimmed)
  }
}, 60 * 60 * 1000)

module.exports = {
  getSession, setSession, clearSession,
  getPreview, setPreview,
  getPendingBulk, setPendingBulk, clearPendingBulk,
  checkNlpLimit, checkScanLimit
}
