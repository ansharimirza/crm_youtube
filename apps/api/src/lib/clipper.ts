// Clipper: transcribe an uploaded source video, have Gemini pick segments that satisfy the
// campaign requirements, then cut each into a vertical (or landscape) clip with burned captions.

import { eq } from 'drizzle-orm'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { db, users, clipJobs, clips } from '../db'
import { pickClips } from './gemini'
import { transcribeAudio } from './transcribe'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const CLIPS_DIR = join(UPLOAD_DIR, 'clipper')
const SRC_DIR = join(UPLOAD_DIR, 'clipper', 'src')

// Download a YouTube (or other yt-dlp-supported) URL to a local mp4. Returns the file path.
export async function downloadYoutube(url: string, jobId: number): Promise<string> {
  await mkdir(SRC_DIR, { recursive: true })
  const out = join(SRC_DIR, `yt_${jobId}_${Date.now()}.mp4`)
  const proc = Bun.spawn([
    'yt-dlp',
    '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', // cap at 1080p to keep files sane
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '-o', out,
    url,
  ], { stdout: 'ignore', stderr: 'pipe' })
  const err = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) throw new Error(`Download YouTube gagal: ${err.slice(-300)}`)
  if (!(await Bun.file(out).exists())) throw new Error('Download selesai tapi file tidak ada')
  return out
}

interface Seg { start: number; end: number; text: string }

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100
  const p = (n: number) => String(n).padStart(2, '0')
  return `${h}:${p(m)}:${p(s)}.${p(c)}`
}
function escSub(s: string): string {
  return s.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

// Big centered captions with a thick black outline (readable over any footage).
function buildAss(events: Seg[], aspect: '9:16' | '16:9'): string {
  const [w, h] = aspect === '9:16' ? [1080, 1920] : [1920, 1080]
  const fontSize = aspect === '9:16' ? 54 : 46
  const marginV = aspect === '9:16' ? 260 : 90
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${w}`, `PlayResY: ${h}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,DejaVu Sans,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,5,1,2,80,80,${marginV},1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const dialog = events.map((e) => `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Cap,,0,0,0,,${e.text.replace(/\n/g, ' ').replace(/[{}]/g, '')}`)
  return [...header, ...dialog].join('\n')
}

// Full pipeline for one job. Runs in the background (fire-and-forget from the route).
export async function processClipJob(jobId: number): Promise<void> {
  const job = await db.query.clipJobs.findFirst({ where: eq(clipJobs.id, jobId) })
  if (!job) return
  const aspect = (job.aspectRatio === '16:9' ? '16:9' : '9:16') as '9:16' | '16:9'
  try {
    // URL job: download the source video first (yt-dlp).
    let sourcePath = job.sourceVideoPath
    if (!sourcePath) {
      if (!job.sourceUrl) throw new Error('Tidak ada video sumber (upload atau link)')
      await db.update(clipJobs).set({ status: 'downloading' }).where(eq(clipJobs.id, jobId))
      sourcePath = await downloadYoutube(job.sourceUrl, jobId)
      await db.update(clipJobs).set({ sourceVideoPath: sourcePath }).where(eq(clipJobs.id, jobId))
    }

    await db.update(clipJobs).set({ status: 'transcribing' }).where(eq(clipJobs.id, jobId))
    const { segments } = await transcribeAudio(sourcePath)
    if (!segments.length) throw new Error('Transkrip kosong — audio tidak terbaca')

    await db.update(clipJobs).set({ status: 'selecting' }).where(eq(clipJobs.id, jobId))
    const u = await db.query.users.findFirst({ where: eq(users.id, job.userId) })
    const apiKey = u?.geminiApiKey || process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('Gemini API key belum diatur (Settings)')
    const timed = segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n')
    const picks = await pickClips(timed, job.requirements, job.clipCount, apiKey)
    if (!picks.length) throw new Error('AI tidak menemukan klip yang sesuai syarat')

    await db.update(clipJobs).set({ status: 'rendering' }).where(eq(clipJobs.id, jobId))
    await mkdir(CLIPS_DIR, { recursive: true })
    for (const p of picks) {
      const start = Math.max(0, p.start_sec)
      const dur = Math.min(90, Math.max(3, p.end_sec - start))
      const [row] = await db.insert(clips).values({
        jobId, title: (p.title || 'Clip').slice(0, 200), startSec: start, endSec: start + dur,
        reason: (p.reason || '').slice(0, 500), status: 'rendering',
      }).returning()
      try {
        const out = await renderClip(row.id, sourcePath, start, dur, segments, aspect)
        await db.update(clips).set({ status: 'done', path: out }).where(eq(clips.id, row.id))
      } catch (e) {
        await db.update(clips).set({ status: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).where(eq(clips.id, row.id))
      }
    }
    await db.update(clipJobs).set({ status: 'done' }).where(eq(clipJobs.id, jobId))
  } catch (e) {
    await db.update(clipJobs).set({ status: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).where(eq(clipJobs.id, jobId))
  }
}

async function renderClip(clipId: number, src: string, start: number, dur: number, segments: Seg[], aspect: '9:16' | '16:9'): Promise<string> {
  const end = start + dur
  const events = segments
    .filter((s) => s.text && Math.min(s.end, end) - Math.max(s.start, start) > 0.3)
    .map((s) => ({ start: Math.max(s.start, start) - start, end: Math.min(s.end, end) - start, text: s.text }))
  const assPath = join(CLIPS_DIR, `cap_${clipId}.ass`)
  await writeFile(assPath, buildAss(events, aspect))
  const out = join(CLIPS_DIR, `clip_${clipId}_${Date.now()}.mp4`)

  // Fill-crop to the target frame (better than padding for real footage), then burn captions.
  const dims = aspect === '9:16' ? '1080:1920' : '1920:1080'
  const vf = `scale=${dims}:force_original_aspect_ratio=increase,crop=${dims},subtitles='${escSub(assPath)}'`
  const args = [
    '-y', '-ss', start.toFixed(2), '-i', src, '-t', dur.toFixed(2), '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out,
  ]
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const errText = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) throw new Error(`ffmpeg clip gagal: ${errText.slice(-400)}`)
  await rm(assPath, { force: true }).catch(() => {})
  return out
}
