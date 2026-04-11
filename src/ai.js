const fetch = require('node-fetch')

// ─── Get today's date in IST (Asia/Kolkata) ──────────────────────────────────
function getTodayIST() {
  const now = new Date()
  const istDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }))
  return istDate.toISOString().split('T')[0]
}

// ─── Parse text with Sarvam-m ────────────────────────────────────────────────
async function parseTextWithAI(text) {
  try {
    const today = getTodayIST()
    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': process.env.SARVAM_API_KEY
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        messages: [
          {
            role: 'system',
            content: `You are a financial transaction parser for an Indian finance app. The user may write in ANY language (English, Hindi, Bengali, Tamil, Telugu, or any other). Always extract details and return output in ENGLISH only.

Extract transaction details and return ONLY valid JSON.
No explanation, no markdown, no extra text.

Categories (use EXACTLY one):
Food & Dining, Transport, Shopping, Bills & Utilities,
Entertainment, Health, Education, Rent, Groceries,
Personal Care, Salary, Freelance, Business, Investment,
Gift, Other

Smart category matching rules:
- food, lunch, dinner, breakfast, restaurant, cafe, swiggy, zomato, dominos → Food & Dining
- uber, ola, auto, rickshaw, petrol, diesel, bus, metro, train ticket → Transport
- amazon, flipkart, shopping, clothes, shoes, mall → Shopping
- electricity, water, internet, wifi, mobile bill, recharge, gas bill → Bills & Utilities
- movie, netflix, spotify, game, concert → Entertainment
- doctor, medicine, hospital, pharmacy, medical → Health
- school, college, course, fees, books → Education
- rent, house rent, apartment, pg → Rent
- grocery, vegetables, fruits, kirana, supermarket → Groceries
- salon, parlour, haircut, spa → Personal Care
- salary, stipend, payment received → Salary
- freelance, project payment, client → Freelance
- business income, shop income → Business
- mutual fund, stocks, fd, investment → Investment
- gift, birthday, wedding gift → Gift

Rules:
- amount: number only, no currency symbols
- type: "income" or "expense" only
- category: EXACTLY one from list above
- date: YYYY-MM-DD format, use today if not mentioned
- note: brief description in ENGLISH, capitalize first letter
- If text is in Hindi/Bengali/any language, translate the note to English

Today's date: ${today}

IMPORTANT: If the message contains MULTIPLE transactions (e.g. "lunch 500, auto 200, grocery 1200"), return a JSON ARRAY of objects. If single transaction, return a single JSON object.

For MULTIPLE transactions return:
[
  {
    "amount": 500,
    "type": "expense",
    "category": "Food & Dining",
    "date": "${today}",
    "note": "Lunch"
  },
  {
    "amount": 200,
    "type": "expense",
    "category": "Transport",
    "date": "${today}",
    "note": "Auto rickshaw"
  }
]

For SINGLE transaction return:
{
  "amount": 500,
  "type": "expense",
  "category": "Food & Dining",
  "date": "${today}",
  "note": "Lunch at restaurant"
}`
          },
          { role: 'user', content: text }
        ],
        max_tokens: 800,
        temperature: 0.1
      })
    })

    const data = await response.json()
    if (data.error) { console.error('Sarvam error:', data.error); return null }

    let content = data.choices?.[0]?.message?.content
    if (!content) return null

    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    const jsonMatch = content.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (!jsonMatch) return null

    try {
      const result = JSON.parse(jsonMatch[0])
      if (Array.isArray(result)) {
        return result.map(item => {
          if (item.note) item.note = item.note.charAt(0).toUpperCase() + item.note.slice(1)
          return item
        })
      }
      if (result.note) {
        result.note = result.note.charAt(0).toUpperCase() + result.note.slice(1)
      }
      return result
    } catch(e) {
      let attempt = jsonMatch[0]
      const opens = (attempt.match(/\{/g) || []).length
      const closes = (attempt.match(/\}/g) || []).length
      attempt += '}'.repeat(Math.max(0, opens - closes))
      const result = JSON.parse(attempt)
      if (result.note) result.note = result.note.charAt(0).toUpperCase() + result.note.slice(1)
      return result
    }
  } catch (err) {
    console.error('Text parse error:', err.message)
    return null
  }
}

// ─── Parse receipt photo with Gemini ─────────────────────────────────────────
async function parsePhotoWithAI(base64Image, mimeType = 'image/jpeg') {
  try {
    const today = getTodayIST()
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Image } },
              { text: `You are a receipt and document scanner for an Indian finance app. The receipt may be in ANY language. Always extract details and return output in ENGLISH only. Currency is INR (Indian Rupees ₹).

Analyze this receipt/bill/document image carefully and extract transaction details.

Categories (use EXACTLY one):
Food & Dining, Transport, Shopping, Bills & Utilities,
Entertainment, Health, Education, Rent, Groceries,
Personal Care, Salary, Freelance, Business, Investment,
Gift, Other

CRITICAL amount extraction rules:
- amount: exact total as number, preserve decimals
- ₹19.00 = 19, NOT 190 or 1900
- ₹1,200 = 1200
- ₹19.50 = 19.50
- Never multiply or modify the amount
- If amount has paise (decimal), keep as decimal number
- Look for "Amount Paid", "Total", "Grand Total", "Net Amount" fields on receipt for the correct amount
- Remove commas from amounts (₹1,200 → 1200) but keep decimal points (₹19.50 → 19.50)

Other rules:
- type: always "expense" for receipts
- category: EXACTLY one from list above
- date: YYYY-MM-DD format, use today if not visible
- note: merchant name or brief description in ENGLISH, max 50 characters, capitalize first letter
- confidence: 0.0 to 1.0 how confident you are

Today's date: ${today}

IMPORTANT: For most receipts (Jio recharge, restaurant bill, etc.) return the TOTAL as a SINGLE transaction object. Only return a JSON ARRAY of multiple objects if the receipt is clearly a multi-category bill (e.g. supermarket with different categories like food, household, personal care). Do NOT split a single-category grocery run into line items.

For SINGLE item receipt return:
{
  "amount": 1200,
  "type": "expense",
  "category": "Groceries",
  "date": "${today}",
  "note": "Big Bazaar grocery shopping",
  "confidence": 0.95
}

For MULTI-CATEGORY receipt return:
[
  { "amount": 150, "type": "expense", "category": "Groceries", "date": "${today}", "note": "Rice 5kg", "confidence": 0.9 },
  { "amount": 80, "type": "expense", "category": "Personal Care", "date": "${today}", "note": "Shampoo", "confidence": 0.9 }
]

Return ONLY the JSON, no explanation, no markdown backticks.` }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
        })
      }
    )

    const data = await response.json()
    if (data.error) { console.error('Gemini error:', data.error); return null }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!content) return null

    const jsonMatch = content.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (!jsonMatch) return null

    const result = JSON.parse(jsonMatch[0])
    if (Array.isArray(result)) {
      return result.map(item => {
        if (item.note) item.note = item.note.charAt(0).toUpperCase() + item.note.slice(1)
        return item
      })
    }
    if (result.note) {
      result.note = result.note.charAt(0).toUpperCase() + result.note.slice(1)
    }
    return result
  } catch (err) {
    console.error('Photo parse error:', err.message)
    return null
  }
}

// ─── Download WhatsApp media ──────────────────────────────────────────────────
async function downloadWhatsAppMedia(mediaId) {
  try {
    // Step 1: Get media URL
    const urlRes = await fetch(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    )
    const urlData = await urlRes.json()
    if (!urlData.url) return null

    // Step 2: Download media
    const mediaRes = await fetch(urlData.url, {
      headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` }
    })
    const buffer = await mediaRes.buffer()
    const base64 = buffer.toString('base64')
    const mimeType = urlData.mime_type || 'image/jpeg'

    return { base64, mimeType }
  } catch (err) {
    console.error('Media download error:', err.message)
    return null
  }
}

module.exports = { parseTextWithAI, parsePhotoWithAI, downloadWhatsAppMedia }
