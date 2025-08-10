import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: '*' }))

// YouTube Data API Key - you'll need to get this from Google Cloud Console
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'YOUR_API_KEY_HERE'

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is working!', timestamp: new Date().toISOString() })
})

app.get('/api/youtube', async (req, res) => {
  try {
    let ytUrl = req.query.url
    if (!ytUrl || !/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(ytUrl)) {
      res.status(400).end('Invalid url')
      return
    }

    // Decode URL properly
    ytUrl = decodeURIComponent(ytUrl)

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Accept-Ranges', 'none')
    res.setHeader('Connection', 'keep-alive')

    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

    // Extract video ID
    const videoId = (() => {
      try {
        const u = new URL(ytUrl)
        if (u.hostname.includes('youtu.be')) return u.pathname.slice(1)
        if (u.searchParams.get('v')) return u.searchParams.get('v')
        const parts = u.pathname.split('/')
        return parts.pop() || ''
      } catch {
        return ''
      }
    })()
    
    if (!videoId) {
      res.status(400).end('Invalid YouTube URL')
      return
    }

    console.log(`[debug] Processing URL: ${ytUrl}, Video ID: ${videoId}`)

    // Return a working test audio file for now
    console.log('[test] Returning working test audio')
    
    // Create a simple sine wave audio (1 second, 440Hz)
    const sampleRate = 44100
    const duration = 1 // 1 second
    const frequency = 440 // A4 note
    const samples = sampleRate * duration
    
    const audioBuffer = new ArrayBuffer(samples * 2) // 16-bit samples
    const view = new DataView(audioBuffer)
    
    for (let i = 0; i < samples; i++) {
      const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.3
      const intSample = Math.floor(sample * 32767)
      view.setInt16(i * 2, intSample, true) // little-endian
    }
    
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Content-Length', audioBuffer.byteLength)
    res.end(Buffer.from(audioBuffer))
    
  } catch (err) {
    console.error('[youtube proxy error]', err?.message || err)
    if (!res.headersSent) res.status(500).end('Failed to process YouTube URL')
  }
})

app.get('/healthz', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
  if (YOUTUBE_API_KEY === 'YOUR_API_KEY_HERE') {
    console.log('⚠️  YouTube Data API key not set. Please set YOUTUBE_API_KEY environment variable.')
  }
})


