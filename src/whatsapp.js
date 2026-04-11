const fetch = require('node-fetch')

function getApiUrl() {
  return `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
  }
}

// Send a plain text message
async function sendMessage(to, text) {
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    })
    const data = await res.json()
    if (data.error) console.error('[WA Send Error]', data.error)
    return data
  } catch (err) {
    console.error('[WA Send Failed]', err.message)
  }
}

// Send an image message with optional caption
async function sendImage(to, imageUrl, caption = '') {
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: imageUrl, caption }
      })
    })
    const data = await res.json()
    if (data.error) console.error('[WA Image Error]', data.error)
    return data
  } catch (err) {
    console.error('[WA Image Failed]', err.message)
  }
}

// Send interactive buttons (confirm/cancel)
async function sendButtons(to, bodyText, buttons) {
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title }
            }))
          }
        }
      })
    })
    const data = await res.json()
    if (data.error) console.error('[WA Button Error]', data.error)
    return data
  } catch (err) {
    console.error('[WA Button Failed]', err.message)
  }
}

// Send a document message (e.g. PDF) with optional caption
async function sendDocument(to, documentUrl, filename, caption = '') {
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { link: documentUrl, filename, caption }
      })
    })
    const data = await res.json()
    if (data.error) console.error('[WA Document Error]', data.error)
    return data
  } catch (err) {
    console.error('[WA Document Failed]', err.message)
  }
}

// Mark message as read
async function markRead(messageId) {
  try {
    await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      })
    })
  } catch (err) {
    console.error('[WA markRead Failed]', err.message)
  }
}

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`
}

function formatDateIST(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
}

module.exports = { sendMessage, sendImage, sendDocument, sendButtons, markRead, formatINR, formatDateIST }
