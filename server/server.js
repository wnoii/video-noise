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

    // Use Piped API - simple and reliable
    console.log('[piped] Using Piped API')
    
    const pipedInstances = [
      'https://pipedapi-libre.kavin.rocks',
      'https://pipedapi.moomoo.me',
      'https://pipedapi.syncpundit.io',
      'https://api.piped.projectsegfau.com'
    ]

    for (const base of pipedInstances) {
      try {
        console.log(`[piped] Trying ${base}`)
        const api = `${base}/streams/${videoId}`
        const r = await fetch(api, { 
          headers: { 
            'user-agent': ua,
            'accept': 'application/json'
          },
          timeout: 10000 
        })
        
        if (!r.ok) {
          console.log(`[piped] ${base} failed: ${r.status}`)
          continue
        }
        
        const data = await r.json()
        const audioStreams = data.audioStreams || []
        
        if (!audioStreams.length) {
          console.log(`[piped] ${base} no audio streams`)
          continue
        }

        // Get best quality audio
        audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
        const best = audioStreams[0]
        
        if (!best || !best.url) {
          console.log(`[piped] ${base} no valid stream URL`)
          continue
        }

        console.log(`[piped] Using ${base} with ${best.bitrate}kbps audio`)
        
        const stream = await fetch(best.url, { 
          headers: { 'user-agent': ua },
          timeout: 15000 
        })
        
        if (!stream.ok || !stream.body) {
          console.log(`[piped] Stream fetch failed: ${stream.status}`)
          continue
        }

        res.setHeader('Content-Type', 'audio/mpeg')
        
        const reader = stream.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) { 
            res.end()
            return 
          }
          res.write(Buffer.from(value))
        }
        
      } catch (e) {
        console.log(`[piped] ${base} error:`, e.message)
        continue
      }
    }

    // If all Piped instances fail, return error
    console.log('[piped] All instances failed')
    res.json({
      error: 'All Piped instances failed',
      message: 'Please try again later',
      videoId: videoId,
      timestamp: new Date().toISOString()
    })
    
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


