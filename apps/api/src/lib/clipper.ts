// Clipper: transcribe an uploaded source video, have Gemini pick segments that satisfy the
// campaign requirements, then cut each into a vertical (or landscape) clip with burned captions.

import { eq } from 'drizzle-orm'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { db, users, clipJobs, clips } from '../db'
import { pickClips } from './gemini'
import { transcribeAudio, type TranscriptWord } from './transcribe'

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


function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100
  const p = (n: number) => String(n).padStart(2, '0')
  return `${h}:${p(m)}:${p(s)}.${p(c)}`
}
function escSub(s: string): string {
  return s.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

const WORDS_PER_LINE = 4 // short punchy lines like TikTok/Loka Clip captions

// Karaoke word-by-word captions: each line shows a few words; the current word fills in
// bright yellow as it's spoken (\k). `words` are already rebased to clip-relative time.
function buildAss(words: TranscriptWord[], aspect: '9:16' | '16:9'): string {
  const [w, h] = aspect === '9:16' ? [1080, 1920] : [1920, 1080]
  const fontSize = aspect === '9:16' ? 58 : 48
  const marginV = aspect === '9:16' ? 300 : 100
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${w}`, `PlayResY: ${h}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // PrimaryColour = spoken (yellow), SecondaryColour = not-yet-spoken (white). Thick black outline.
    `Style: Cap,DejaVu Sans,${fontSize},&H0000FFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,5,1,2,90,90,${marginV},1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const clean = words.map((x) => ({ ...x, word: x.word.replace(/[{}\n]/g, '').trim() })).filter((x) => x.word)
  const lines: string[] = []
  for (let i = 0; i < clean.length; i += WORDS_PER_LINE) {
    const group = clean.slice(i, i + WORDS_PER_LINE)
    if (!group.length) continue
    const start = group[0].start
    const end = group[group.length - 1].end
    // \k<centiseconds> before each word makes it fill as it's spoken.
    const text = group.map((x, j) => {
      const next = group[j + 1]?.start ?? x.end
      const durCs = Math.max(1, Math.round((next - x.start) * 100))
      return `{\\k${durCs}}${x.word} `
    }).join('').trim()
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`)
  }
  return [...header, ...lines].join('\n')
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
    const { segments, words } = await transcribeAudio(sourcePath)
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
        const out = await renderClip(row.id, sourcePath, start, dur, words, aspect)
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

// Re-render an existing clip in place (e.g. after tuning the reframe/captions). Re-transcribes
// the source for word timings, re-runs face-tracking, and replaces the clip file.
export async function rerenderClip(clipId: number): Promise<void> {
  const clip = await db.query.clips.findFirst({ where: eq(clips.id, clipId) })
  if (!clip) throw new Error('clip tidak ada')
  const job = await db.query.clipJobs.findFirst({ where: eq(clipJobs.id, clip.jobId) })
  if (!job?.sourceVideoPath) throw new Error('source video sudah tidak ada')
  const aspect = (job.aspectRatio === '16:9' ? '16:9' : '9:16') as '9:16' | '16:9'
  const { words } = await transcribeAudio(job.sourceVideoPath)
  const out = await renderClip(clip.id, job.sourceVideoPath, clip.startSec, clip.endSec - clip.startSec, words, aspect)
  await db.update(clips).set({ path: out, status: 'done' }).where(eq(clips.id, clip.id))
}

async function renderClip(clipId: number, src: string, start: number, dur: number, words: TranscriptWord[], aspect: '9:16' | '16:9'): Promise<string> {
  const end = start + dur
  // Words inside this clip, rebased so the clip starts at t=0.
  const clipWords = words
    .filter((x) => x.start >= start - 0.2 && x.start < end)
    .map((x) => ({ word: x.word, start: Math.max(0, x.start - start), end: Math.min(dur, x.end - start) }))
  const assPath = join(CLIPS_DIR, `cap_${clipId}.ass`)
  await writeFile(assPath, buildAss(clipWords, aspect))
  const out = join(CLIPS_DIR, `clip_${clipId}_${Date.now()}.mp4`)

  // For a vertical clip from LANDSCAPE footage, follow the speaker's face; otherwise plain
  // fill-crop. cropPart pans a fixed crop box (via face detection) or is a static fill.
  const dims = aspect === '9:16' ? '1080:1920' : '1920:1080'
  let cmdsPath: string | null = null
  let cropPart = `scale=${dims}:force_original_aspect_ratio=increase,crop=${dims}`
  if (aspect === '9:16') {
    const face = await faceCropCmds(clipId, src, start, dur).catch(() => null)
    if (face) {
      cmdsPath = face.cmdsPath
      cropPart = `sendcmd=f='${escSub(face.cmdsPath)}',crop=${face.cropW}:${face.cropH}:${face.startX}:0,scale=1080:1920`
    }
  }
  const vf = `${cropPart},subtitles='${escSub(assPath)}'`
  const args = [
    '-y', '-ss', start.toFixed(2), '-i', src, '-t', dur.toFixed(2), '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out,
  ]
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const errText = await new Response(proc.stderr).text()
  await rm(assPath, { force: true }).catch(() => {})
  if (cmdsPath) await rm(cmdsPath, { force: true }).catch(() => {})
  if ((await proc.exited) !== 0) throw new Error(`ffmpeg clip gagal: ${errText.slice(-400)}`)
  return out
}

// Run the Python face-tracker; returns a sendcmd file that pans the crop to follow the face.
// Only meaningful for landscape sources (returns null for portrait/square — no reframe needed).
async function faceCropCmds(clipId: number, src: string, start: number, dur: number): Promise<{ cmdsPath: string; cropW: number; cropH: number; startX: number } | null> {
  const cmdsPath = join(CLIPS_DIR, `crop_${clipId}.txt`)
  const script = join(process.cwd(), 'scripts', 'facecrop.py')
  const proc = Bun.spawn(['python3', script, src, start.toFixed(2), dur.toFixed(2), '9', '16', cmdsPath], { stdout: 'pipe', stderr: 'pipe' })
  const outText = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) return null
  try {
    const info = JSON.parse(outText.trim()) as { cropW: number; cropH: number; startX: number }
    // Portrait/square source: crop box spans (nearly) the whole width → no tracking benefit.
    if (!info.cropW || info.cropH < info.cropW) return null
    return { cmdsPath, cropW: info.cropW, cropH: info.cropH, startX: info.startX }
  } catch {
    return null
  }
}
