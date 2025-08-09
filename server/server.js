import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: '*' }))

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is working!', timestamp: new Date().toISOString() })
})

app.get('/api/youtube', async (req, res) => {
  try {
    const ytUrl = req.query.url
    if (!ytUrl || !/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(ytUrl)) {
      res.status(400).end('Invalid url')
      return
    }

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

    // Use Invidious API (more reliable than Piped)
    const invidiousInstances = [
      'https://invidious.snopyta.org',
      'https://invidious.kavin.rocks',
      'https://invidious.projectsegfau.lt',
      'https://invidious.prvcy.eu',
      'https://invidious.slipfox.xyz',
    ]

    for (const base of invidiousInstances) {
      try {
        console.log(`[invidious] Trying ${base}`)
        const api = `${base}/api/v1/videos/${videoId}`
        const r = await fetch(api, { 
          headers: { 
            'user-agent': ua,
            'accept': 'application/json'
          },
          timeout: 8000 
        })
        
        if (!r.ok) {
          console.log(`[invidious] ${base} failed: ${r.status}`)
          continue
        }
        
        const data = await r.json()
        const formatStreams = data.formatStreams || []
        const adaptiveFormats = data.adaptiveFormats || []
        
        // Combine all audio formats
        const allFormats = [...formatStreams, ...adaptiveFormats]
        const audioFormats = allFormats.filter(f => 
          f.type && f.type.includes('audio') && !f.type.includes('video')
        )
        
        if (!audioFormats.length) {
          console.log(`[invidious] ${base} no audio formats`)
          continue
        }

        // Sort by quality (bitrate)
        audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
        const best = audioFormats[0]
        
        if (!best || !best.url) {
          console.log(`[invidious] ${base} no valid stream URL`)
          continue
        }

        console.log(`[invidious] Using ${base} with ${best.type || 'unknown'} format`)
        
        // Stream the audio directly
        const proxied = await fetch(best.url, { 
          headers: { 'user-agent': ua },
          timeout: 12000 
        })
        
        if (!proxied.ok || !proxied.body) {
          console.log(`[invidious] Stream fetch failed: ${proxied.status}`)
          continue
        }

        // Set appropriate content type
        const contentType = best.type || 'audio/mpeg'
        res.setHeader('Content-Type', contentType)
        
        // Stream directly to client
        const reader = proxied.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) { 
            res.end()
            return 
          }
          res.write(Buffer.from(value))
        }
        
      } catch (e) {
        console.log(`[invidious] ${base} error:`, e.message)
        continue
      }
    }

    // If all Invidious instances failed
    console.error('[invidious] All instances failed')
    if (!res.headersSent) res.status(500).end('All YouTube sources failed')
    
  } catch (err) {
    console.error('[youtube proxy error]', err?.message || err)
    if (!res.headersSent) res.status(500).end('Failed to process YouTube URL')
  }
})

app.get('/healthz', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})


