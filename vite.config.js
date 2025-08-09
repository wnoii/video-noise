import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import ytdl from '@distube/ytdl-core'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'youtube-audio-proxy',
      configureServer(server) {
        server.middlewares.use('/api/youtube', async (req, res) => {
          try {
            const parsed = new URL(req.url, 'http://localhost')
            const ytUrl = parsed.searchParams.get('url')
            const prefer = parsed.searchParams.get('prefer')
            if (!ytUrl) { res.statusCode = 400; res.end('Missing url'); return }
            const isYouTube = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(ytUrl)
            if (!isYouTube) { res.statusCode = 400; res.end('Not a YouTube URL') ; return }

            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Cache-Control', 'no-cache')
            res.setHeader('X-Content-Type-Options', 'nosniff')
            res.setHeader('Accept-Ranges', 'none')
            res.setHeader('Connection', 'keep-alive')
            // Let the browser know we support streaming
            res.setHeader('Transfer-Encoding', 'chunked')
            const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

            const streamViaPiped = async () => {
              const videoId = (() => {
                try {
                  const u = new URL(ytUrl)
                  if (u.hostname.includes('youtu.be')) return u.pathname.slice(1)
                  if (u.searchParams.get('v')) return u.searchParams.get('v')
                  const parts = u.pathname.split('/')
                  return parts.pop() || ''
                } catch { return '' }
              })()
              if (!videoId) throw new Error('Cannot parse video id')
              const instances = [
                'https://pipedapi.kavin.rocks',
                'https://piped.video',
                'https://pipedapi.adminforge.de',
                'https://piped.projectsegfau.lt',
              ]
              let lastErr
              for (const base of instances) {
                try {
                  const api = `${base}/api/v1/streams/${videoId}`
                  const r = await fetch(api, { headers: { 'user-agent': ua } })
                  if (!r.ok) throw new Error(`piped api ${r.status}`)
                  const data = await r.json()
                  const audioStreams = Array.isArray(data.audioStreams) ? data.audioStreams : []
                  if (!audioStreams.length) throw new Error('no audio streams')
                  // Prefer M4A itag=140 if present, then other AAC/MP4, else WebM/Opus
                  const itag140 = audioStreams.find(s=> String(s.itag||'') === '140')
                  const isMp4 = (s)=> (s.mimeType?.includes('audio/mp4') || s.container==='m4a' || s.codec?.includes('mp4a') || s.codecs?.includes('mp4a'))
                  const mp4Streams = audioStreams.filter(s=> isMp4(s) && s!==itag140)
                  const webmStreams = audioStreams.filter(s=>!isMp4(s))
                  mp4Streams.sort((a,b)=> (b.bitrate||0)-(a.bitrate||0))
                  webmStreams.sort((a,b)=> (b.bitrate||0)-(a.bitrate||0))
                  const best = prefer==='mp4' ? (itag140 || mp4Streams[0] || webmStreams[0]) : (mp4Streams[0] || itag140 || webmStreams[0])
                  const proxied = await fetch(best.url, { headers: { 'user-agent': ua } })
                  if (!proxied.ok || !proxied.body) throw new Error(`stream fetch ${proxied.status}`)
                  try {
                    const { PassThrough } = await import('stream')
                    const ff = (await import('fluent-ffmpeg')).default
                    const ffPath = (await import('ffmpeg-static')).default
                    if (ffPath) { try { ff.setFfmpegPath(ffPath) } catch {} }
                    res.setHeader('Content-Type', 'audio/mpeg')
                    const pass = new PassThrough()
                    ;(async()=>{
                      const r = proxied.body.getReader()
                      while (true) {
                        const { done, value } = await r.read()
                        if (done) { pass.end(); break }
                        pass.write(Buffer.from(value))
                      }
                    })()
                    ff(pass).noVideo().audioCodec('libmp3lame').audioBitrate('192k').format('mp3')
                      .on('error', ()=>{ if(!res.headersSent) res.statusCode=500; try{res.end()}catch{} })
                      .pipe(res, { end: true })
                  } catch {
                    // fallback: stream as-is
                    const reader = proxied.body.getReader()
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) { res.end(); break }
                      res.write(Buffer.from(value))
                    }
                  }
                  return
                } catch (e) { lastErr = e }
              }
              throw lastErr || new Error('All Piped instances failed')
            }

            const streamViaYtdl = async () => {
              return await new Promise((resolve, reject) => {
                try {
                  const s = ytdl(ytUrl, {
                    quality: 'highestaudio',
                    // Prefer AAC/M4A if available
                    filter: (f)=> (f.mimeType?.includes('audio/mp4') || f.container === 'm4a' || (f.codecs && f.codecs.includes('mp4a')) || f.audioCodec === 'aac') || (f.hasAudio && !f.hasVideo),
                    highWaterMark: 1 << 25,
                    requestOptions: { headers: { 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9' } },
                  })
                  let piped = false
                  s.once('response', async (resp) => {
                    try {
                      const ct = (typeof resp?.headers?.['content-type'] === 'string' ? resp.headers['content-type'].split(';')[0] : '') || ''
                      const wantsMp4 = prefer==='mp4' || (/Safari\//.test(req.headers['user-agent']||'') && !/Chrome\//.test(req.headers['user-agent']||''))
                      if (true) { // Always transcode to MP3 for widest compatibility
                        const ff = (await import('fluent-ffmpeg')).default
                        const ffPath = (await import('ffmpeg-static')).default
                        if (ffPath) { try { ff.setFfmpegPath(ffPath) } catch {} }
                        res.setHeader('Content-Type', 'audio/mpeg')
                        ff(s).noVideo().audioCodec('libmp3lame').audioBitrate('192k').format('mp3')
                          .on('error', ()=>{ if(!res.headersSent) res.statusCode=500; try{res.end()}catch{} })
                          .on('end', resolve)
                          .pipe(res, { end: true })
                        piped = true
                      } else {
                        res.setHeader('Content-Type', ct || 'audio/mp4')
                        s.pipe(res)
                        piped = true
                      }
                    } catch (e) {
                      // fallback to direct pipe
                      s.pipe(res)
                      piped = true
                    }
                  })
                  s.once('error', (err) => {
                    if (!piped) reject(err)
                  })
                  s.once('end', () => { if (!piped) resolve(undefined) })
                } catch (e) {
                  reject(e)
                }
              })
            }

            try {
              await streamViaYtdl()
            } catch (yErr) {
              console.warn('[ytdl failed, trying piped]', yErr?.message || yErr)
              try { await streamViaPiped() }
              catch (pErr) {
                console.error('[piped stream error]', pErr?.message || pErr)
                if (!res.headersSent) res.statusCode = 500
                res.end('Stream error')
              }
            }
          } catch (err) {
            console.error('[youtube proxy error]', err?.message || err)
            if (!res.headersSent) res.statusCode = 500
            res.end('Failed to fetch YouTube audio')
          }
        })
      },
    },
  ],
})
