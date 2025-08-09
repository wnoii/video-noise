import express from 'express'
import cors from 'cors'
import ytdl from '@distube/ytdl-core'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: '*'}))
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
    res.setHeader('Content-Type', 'audio/mpeg')

    if (ffmpegPath) { try { ffmpeg.setFfmpegPath(ffmpegPath) } catch {} }

    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    const stream = ytdl(ytUrl, {
      quality: 'highestaudio',
      filter: (f)=> (f.hasAudio && !f.hasVideo),
      highWaterMark: 1 << 25,
      requestOptions: { headers: { 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9' } },
    })
    ffmpeg(stream)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .format('mp3')
      .on('error', () => { if (!res.headersSent) res.status(500).end('Transcode error') })
      .pipe(res, { end: true })
  } catch (e) {
    if (!res.headersSent) res.status(500).end('Failed')
  }
})

app.get('/healthz', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})


