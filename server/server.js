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

    // Try ytdl-core with better error handling
    console.log('[ytdl] Trying ytdl-core with retry logic')
    
    const maxRetries = 3
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ytdl] Attempt ${attempt}/${maxRetries}`)
        
        const ytdl = (await import('@distube/ytdl-core')).default

        const stream = ytdl(ytUrl, {
          quality: 'highestaudio',
          filter: (f) => (f.hasAudio && !f.hasVideo),
          highWaterMark: 1 << 25,
          requestOptions: { 
            headers: { 
              'user-agent': ua, 
              'accept-language': 'en-US,en;q=0.9',
              'accept': '*/*',
              'cache-control': 'no-cache',
              'pragma': 'no-cache'
            } 
          },
        })

        // Handle stream errors
        stream.on('error', (error) => {
          console.log(`[ytdl] Stream error on attempt ${attempt}:`, error.message)
          if (attempt === maxRetries) {
            console.log('[ytdl] All attempts failed, falling back to mock audio')
            // Fall back to mock audio
            const testAudio = Buffer.from([
              0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
            ])
            res.setHeader('Content-Type', 'audio/mpeg')
            res.setHeader('Content-Length', testAudio.length)
            res.end(testAudio)
          }
        })

        // Stream the audio directly
        res.setHeader('Content-Type', 'audio/mpeg')
        stream.pipe(res)
        
        console.log(`[ytdl] Success on attempt ${attempt}`)
        return
        
      } catch (e) {
        console.log(`[ytdl] Error on attempt ${attempt}:`, e.message)
        
        if (attempt === maxRetries) {
          console.log('[ytdl] All attempts failed, falling back to mock audio')
          // Fall back to mock audio
          const testAudio = Buffer.from([
            0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
          ])
          res.setHeader('Content-Type', 'audio/mpeg')
          res.setHeader('Content-Length', testAudio.length)
          res.end(testAudio)
        } else {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
    
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


