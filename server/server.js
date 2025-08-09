process.env.YTDL_NO_UPDATE = '1'
import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: '*' }))
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

    // Use more reliable Piped API instances
    const pipedInstances = [
      'https://pipedapi-libre.kavin.rocks',
      'https://api.piped.projectsegfau.lt',
      'https://pipedapi.moomoo.me',
      'https://pipedapi.syncpundit.io',
      'https://pipedapi.kavin.rocks',
      'https://piped.video',
    ]

    for (const base of pipedInstances) {
      try {
        console.log(`[piped] Trying ${base}`)
        const api = `${base}/api/v1/streams/${videoId}`
        const r = await fetch(api, { 
          headers: { 
            'user-agent': ua,
            'accept': 'application/json'
          },
          timeout: 8000 
        })
        
        if (!r.ok) {
          console.log(`[piped] ${base} failed: ${r.status}`)
          continue
        }
        
        const data = await r.json()
        const audioStreams = Array.isArray(data.audioStreams) ? data.audioStreams : []
        
        if (!audioStreams.length) {
          console.log(`[piped] ${base} no audio streams`)
          continue
        }

        // Prefer M4A/AAC streams
        const itag140 = audioStreams.find(s => String(s.itag || '') === '140')
        const mp4Streams = audioStreams.filter(s => 
          s.mimeType?.includes('audio/mp4') || 
          s.container === 'm4a' || 
          s.codec?.includes('mp4a') || 
          s.codecs?.includes('mp4a')
        )
        const webmStreams = audioStreams.filter(s => !mp4Streams.includes(s))
        
        mp4Streams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
        webmStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
        
        const best = itag140 || mp4Streams[0] || webmStreams[0]
        
        if (!best || !best.url) {
          console.log(`[piped] ${base} no valid stream URL`)
          continue
        }

        console.log(`[piped] Using ${base} with ${best.mimeType || 'unknown'} stream`)
        
        // Stream the audio directly (no ffmpeg conversion)
        const proxied = await fetch(best.url, { 
          headers: { 'user-agent': ua },
          timeout: 12000 
        })
        
        if (!proxied.ok || !proxied.body) {
          console.log(`[piped] Stream fetch failed: ${proxied.status}`)
          continue
        }

        // Set appropriate content type
        const contentType = best.mimeType || 'audio/mpeg'
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
        console.log(`[piped] ${base} error:`, e.message)
        continue
      }
    }

    // If all Piped instances failed
    console.error('[piped] All instances failed')
    if (!res.headersSent) res.status(500).end('All YouTube sources failed')
    
  } catch (err) {
    console.error('[youtube proxy error]', err?.message || err)
    if (!res.headersSent) res.status(500).end('Failed to fetch YouTube audio')
  }
})

app.get('/healthz', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})


