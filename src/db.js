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
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    const istTime = new Date(now.getTime() + istOffset)

    const { data, error } = await getSupabase()
      .from('transactions')
      .insert({
        user_id: userId,
        amount: Number(parsed.amount),
        type: parsed.type || 'expense',
        category: parsed.category || 'Other',
        note: parsed.note || '',
        date: parsed.date || istTime.toISOString().split('T')[0],
        created_at: istTime.toISOString()
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
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    const istTime = new Date(now.getTime() + istOffset)
    const monthPrefix = istTime.toISOString().slice(0, 7)

    const { data, error } = await getSupabase()
      .from('transactions')
      .select('amount, type')
      .eq('user_id', userId)
      .gte('date', `${monthPrefix}-01`)
      .lte('date', `${monthPrefix}-31`)

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
  disconnectUser,
  saveTransaction,
  getTransactions,
  getBalance,
  getMonthlyBalance,
  hasSeenWelcome,
  markWelcomeSeen
}
