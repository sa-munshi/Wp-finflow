const { createClient } = require('@supabase/supabase-js')

// ─── Supabase client (service role for server-side access) ────────────────────
let supabase = null

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
    }
    supabase = createClient(url, key)
  }
  return supabase
}

// ─── Normalize phone number ──────────────────────────────────────────────────
// WhatsApp sends "919046939869", we store the same format in settings table
function normalizePhone(phone) {
  return phone.replace(/[^0-9]/g, '')
}

// ─── Get current IST date/time ───────────────────────────────────────────────
// India does not observe DST, so fixed +5:30 offset is safe
function getISTNow() {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  return new Date(now.getTime() + istOffset)
}

function getISTDateString() {
  return getISTNow().toISOString().split('T')[0]
}

function getISTMonthPrefix() {
  return getISTNow().toISOString().slice(0, 7)
}

function getPreviousISTMonthPrefix() {
  const now = getISTNow()
  now.setUTCDate(1)
  now.setUTCMonth(now.getUTCMonth() - 1)
  return now.toISOString().slice(0, 7)
}

// ─── Get user by WhatsApp phone ──────────────────────────────────────────────
async function getUserByPhone(phone) {
  try {
    const normalized = normalizePhone(phone)
    const { data, error } = await getSupabase()
      .from('settings')
      .select('user_id, name')
      .eq('whatsapp_phone', normalized)
      .single()

    if (error || !data) return null
    return { user_id: data.user_id, name: data.name || 'User' }
  } catch (err) {
    console.error('[DB] getUserByPhone error:', err.message)
    return null
  }
}

// ─── Connect user (set whatsapp_phone by user_id) ────────────────────────────
async function connectUser(userId, phone) {
  try {
    const normalized = normalizePhone(phone)
    const { error } = await getSupabase()
      .from('settings')
      .update({ whatsapp_phone: normalized })
      .eq('user_id', userId)

    if (error) {
      console.error('[DB] connectUser error:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[DB] connectUser error:', err.message)
    return false
  }
}

// ─── Connect user by whatsapp_connect_code (Supabase lookup) ─────────────────
async function connectUserByCode(rawCode, phone) {
  try {
    const code = rawCode.trim().toUpperCase()
    const normalized = normalizePhone(phone)

    // Look up user by connect code (stored and compared as uppercase)
    const { data, error } = await getSupabase()
      .from('settings')
      .select('user_id')
      .eq('whatsapp_connect_code', code)
      .limit(1)
      .single()

    if (error || !data) return { ok: false, found: false }

    // Update phone and clear the one-time code
    const { error: updateError } = await getSupabase()
      .from('settings')
      .update({ whatsapp_phone: normalized, whatsapp_connect_code: null })
      .eq('user_id', data.user_id)

    if (updateError) {
      console.error('[DB] connectUserByCode update error:', updateError.message)
      return { ok: false, found: true }
    }

    return { ok: true, found: true }
  } catch (err) {
    console.error('[DB] connectUserByCode error:', err.message)
    return { ok: false, found: false }
  }
}

// ─── Disconnect user (clear whatsapp_phone) ──────────────────────────────────
async function disconnectUser(phone) {
  try {
    const normalized = normalizePhone(phone)
    const { error } = await getSupabase()
      .from('settings')
      .update({ whatsapp_phone: null })
      .eq('whatsapp_phone', normalized)

    if (error) {
      console.error('[DB] disconnectUser error:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[DB] disconnectUser error:', err.message)
    return false
  }
}

// ─── Save transaction to Supabase ────────────────────────────────────────────
async function saveTransaction(userId, parsed) {
  try {
    const istTime = getISTNow()

    const { data, error } = await getSupabase()
      .from('transactions')
      .insert({
        user_id: userId,
        amount: Number(parsed.amount),
        type: parsed.type || 'expense',
        category: parsed.category || 'Other',
        note: parsed.note || '',
        date: parsed.date || getISTDateString(),
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('[DB] saveTransaction error:', error.message)
      return { data: null, error: error.message }
    }

    console.log('[DB] Saved transaction:', data.id)
    return { data, error: null }
  } catch (err) {
    console.error('[DB] saveTransaction error:', err.message)
    return { data: null, error: err.message }
  }
}

// ─── Get last 5 transactions ─────────────────────────────────────────────────
async function getTransactions(userId) {
  try {
    const { data, error } = await getSupabase()
      .from('transactions')
      .select('amount, type, category, note, date')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      console.error('[DB] getTransactions error:', error.message)
      return []
    }
    return data || []
  } catch (err) {
    console.error('[DB] getTransactions error:', err.message)
    return []
  }
}

// ─── Get all-time balance summary ────────────────────────────────────────────
async function getBalance(userId) {
  try {
    const { data, error } = await getSupabase()
      .from('transactions')
      .select('amount, type')
      .eq('user_id', userId)

    if (error) {
      console.error('[DB] getBalance error:', error.message)
      return { income: 0, expense: 0, balance: 0 }
    }

    const txs = data || []
    const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
    return { income, expense, balance: income - expense }
  } catch (err) {
    console.error('[DB] getBalance error:', err.message)
    return { income: 0, expense: 0, balance: 0 }
  }
}

// ─── Get this month's balance ────────────────────────────────────────────────
async function getMonthlyBalance(userId) {
  try {
    const monthPrefix = getISTMonthPrefix()
    const [year, month] = monthPrefix.split('-').map(Number)
    const lastDay = new Date(year, month, 0).getDate()

    const { data, error } = await getSupabase()
      .from('transactions')
      .select('amount, type')
      .eq('user_id', userId)
      .gte('date', `${monthPrefix}-01`)
      .lte('date', `${monthPrefix}-${String(lastDay).padStart(2, '0')}`)

    if (error) {
      console.error('[DB] getMonthlyBalance error:', error.message)
      return { income: 0, expense: 0, balance: 0 }
    }

    const txs = data || []
    const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
    return { income, expense, balance: income - expense }
  } catch (err) {
    console.error('[DB] getMonthlyBalance error:', err.message)
    return { income: 0, expense: 0, balance: 0 }
  }
}

// ─── Get signed URL for monthly report PDF ───────────────────────────────────
async function getReportSignedUrl(userId, fileName) {
  try {
    const { data, error } = await getSupabase()
      .storage
      .from('reports')
      .createSignedUrl(`${userId}/${fileName}`, 3600)

    if (error || !data?.signedUrl) return null
    return data.signedUrl
  } catch (err) {
    console.error('[DB] getReportSignedUrl error:', err.message)
    return null
  }
}

// ─── Welcome seen tracker (in-memory, resets on restart) ─────────────────────
const welcomeSeen = new Set()

function hasSeenWelcome(phone) {
  return welcomeSeen.has(phone)
}

function markWelcomeSeen(phone) {
  welcomeSeen.add(phone)
}

module.exports = {
  getUserByPhone,
  connectUser,
  connectUserByCode,
  disconnectUser,
  saveTransaction,
  getTransactions,
  getBalance,
  getMonthlyBalance,
  getReportSignedUrl,
  getISTDateString,
  getISTMonthPrefix,
  getPreviousISTMonthPrefix,
  hasSeenWelcome,
  markWelcomeSeen
}
