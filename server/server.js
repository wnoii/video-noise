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

    // Try YouTube Data API first
    if (YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_API_KEY_HERE') {
      console.log('[youtube-api] Trying YouTube Data API')
      try {
        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,contentDetails&key=${YOUTUBE_API_KEY}`
        const response = await fetch(apiUrl, {
          headers: { 'User-Agent': ua },
          timeout: 10000
        })
        
        if (response.ok) {
          const data = await response.json()
          if (data.items && data.items.length > 0) {
            const video = data.items[0]
            console.log(`[youtube-api] Found video: ${video.snippet.title}`)
            
            // For now, return video info and we'll implement streaming later
            res.json({
              success: true,
              videoId: videoId,
              title: video.snippet.title,
              duration: video.contentDetails.duration,
              message: 'Video found via YouTube Data API. Streaming implementation in progress.',
              timestamp: new Date().toISOString()
            })
            return
          }
        }
      } catch (e) {
        console.log('[youtube-api] Error:', e.message)
      }
    }

    // Fallback: Try ytdl-core with better error handling
    console.log('[ytdl] Trying ytdl-core as fallback')
    try {
      const ytdl = (await import('@distube/ytdl-core')).default

      const stream = ytdl(ytUrl, {
        quality: 'highestaudio',
        filter: (f) => (f.hasAudio && !f.hasVideo),
        highWaterMark: 1 << 25,
        requestOptions: { 
          headers: { 
            'user-agent': ua, 
            'accept-language': 'en-US,en;q=0.9' 
          } 
        },
      })

      // Stream directly without FFmpeg
      res.setHeader('Content-Type', 'audio/mpeg')
      stream.pipe(res)
        
    } catch (e) {
      console.error('[ytdl] error:', e.message)
      
      // Final fallback: return error with instructions
      res.json({
        error: 'YouTube processing failed',
        message: 'Please set up YouTube Data API key or try again later',
        videoId: videoId,
        timestamp: new Date().toISOString(),
        instructions: 'To fix this: 1) Get YouTube Data API key from Google Cloud Console, 2) Set YOUTUBE_API_KEY environment variable in Render'
      })
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


