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
            
            // Now get audio stream using Invidious API (more reliable than ytdl-core)
            console.log('[invidious] Getting audio stream with Invidious API')
            
            const invidiousInstances = [
              'https://invidious.syncpundit.io',
              'https://invidious.weblibre.org', 
              'https://invidious.nerdvpn.de',
              'https://invidious.privacydev.net',
              'https://invidious.projectsegfau.com'
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
                
                const videoData = await r.json()
                const formatStreams = videoData.formatStreams || []
                const adaptiveFormats = videoData.adaptiveFormats || []
                
                const allFormats = [...formatStreams, ...adaptiveFormats]
                const audioFormats = allFormats.filter(f => 
                  f.type && f.type.includes('audio') && !f.type.includes('video')
                )
                
                if (!audioFormats.length) {
                  console.log(`[invidious] ${base} no audio formats`)
                  continue
                }

                audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
                const best = audioFormats[0]
                
                if (!best || !best.url) {
                  console.log(`[invidious] ${base} no valid stream URL`)
                  continue
                }

                console.log(`[invidious] Using ${base} with ${best.type || 'unknown'} format`)
                
                const proxied = await fetch(best.url, { 
                  headers: { 'user-agent': ua },
                  timeout: 12000 
                })
                
                if (!proxied.ok || !proxied.body) {
                  console.log(`[invidious] Stream fetch failed: ${proxied.status}`)
                  continue
                }

                const contentType = best.type || 'audio/mpeg'
                res.setHeader('Content-Type', contentType)
                
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

            // If Invidious fails, fall back to ytdl-core
            console.log('[invidious] All instances failed, trying ytdl-core fallback')
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


