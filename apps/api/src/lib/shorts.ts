// Cut a vertical Short (9:16) from a project's finished video. Gemini reads the timed
// narration script and picks the best self-contained hook segment; ffmpeg then cuts it,
// fits the 16:9 doodle onto a 1080x1920 white canvas, and burns captions in the lower band.

import { and, eq } from 'drizzle-orm'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { db, users, veoProjects, veoShorts } from '../db'
import { pickShortSegment } from './gemini'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
const SHORTS_DIR = join(UPLOAD_DIR, 'veo', 'shorts')

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor((ms % 3_600_000) / 60_000))}:${p(Math.floor((ms % 60_000) / 1000))},${p(ms % 1000, 3)}`
}

// Escape a filesystem path for use inside an ffmpeg subtitles= filter value.
function escSub(s: string): string {
  return s.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

interface SceneWin { start: number; end: number; text: string }

// Public: create a short (async render). Returns the new short row id immediately.
export async function generateProjectShort(userId: number, projectId: number): Promise<{ id: number }> {
  const project = await db.query.veoProjects.findFirst({
    where: and(eq(veoProjects.id, projectId), eq(veoProjects.userId, userId)),
    with: { scenes: { orderBy: (s, { asc }) => [asc(s.sceneNumber)] } },
  })
  if (!project) throw new Error('Project tidak ditemukan')
  if (!project.finalVideoPath) throw new Error('Belum ada video final — rakit dulu')

  // Rebuild the same scene windows the assembler used, so timings match the video.
  const eligible = project.scenes.filter((s) => s.status === 'done' && (s.videoUrl || s.firstImagePath))
  if (eligible.length === 0) throw new Error('Belum ada scene siap')
  const total = project.narrationFullDuration ?? 0
  const wins: SceneWin[] = []
  let t = 0
  for (const s of eligible) {
    const d = (s.alignedDuration ?? s.narrationDuration ?? 0) || total / eligible.length
    wins.push({ start: t, end: t + d, text: (s.narrationText || '').replace(/\s+/g, ' ').trim() })
    t += d
  }
  const videoDur = t

  const timedScript = wins.map((w) => `[${w.start.toFixed(1)}-${w.end.toFixed(1)}] ${w.text}`).join('\n')
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) })
  const apiKey = u?.geminiApiKey || process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini API key belum diatur (Settings)')

  const pick = await pickShortSegment(timedScript, apiKey)

  // Snap to nearest scene boundaries, then clamp to a Short-friendly 15..59s.
  let start = wins.reduce((b, w) => (Math.abs(w.start - pick.start_sec) < Math.abs(b - pick.start_sec) ? w.start : b), wins[0].start)
  let end = wins.reduce((b, w) => (Math.abs(w.end - pick.end_sec) < Math.abs(b - pick.end_sec) ? w.end : b), wins[wins.length - 1].end)
  if (end <= start) end = Math.min(videoDur, start + 40)
  let dur = end - start
  if (dur < 15) { end = Math.min(videoDur, start + 20); dur = end - start }
  if (dur > 59) { end = start + 55; dur = 55 }

  const title = (pick.title || project.title).slice(0, 200)
  const [row] = await db.insert(veoShorts).values({ projectId, title, startSec: start, endSec: end, status: 'rendering' }).returning()

  void renderShort(row.id, project.finalVideoPath, start, dur, wins).catch(async (e) => {
    await db.update(veoShorts)
      .set({ status: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
      .where(eq(veoShorts.id, row.id))
  })
  return { id: row.id }
}

async function renderShort(shortId: number, srcVideo: string, start: number, dur: number, wins: SceneWin[]): Promise<void> {
  await mkdir(SHORTS_DIR, { recursive: true })
  const end = start + dur

  // Captions: each scene's line, timed relative to the clip start.
  const lines: string[] = []
  let idx = 1
  for (const w of wins) {
    const s = Math.max(w.start, start)
    const e = Math.min(w.end, end)
    if (e - s < 0.3 || !w.text) continue
    lines.push(String(idx++), `${srtTime(s - start)} --> ${srtTime(e - start)}`, w.text, '')
  }
  const srtPath = join(SHORTS_DIR, `cap_${shortId}.srt`)
  await writeFile(srtPath, lines.join('\n'))
  const out = join(SHORTS_DIR, `short_${shortId}_${Date.now()}.mp4`)

  // Fit the 16:9 source onto a 1080x1920 white canvas; captions sit in the lower white band.
  const style = 'FontName=Arial,Fontsize=15,PrimaryColour=&H000000&,OutlineColour=&HFFFFFF&,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=300,MarginL=60,MarginR=60,Bold=1'
  const vf = `scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,subtitles='${escSub(srtPath)}':force_style='${style}'`

  const args = [
    '-y', '-ss', start.toFixed(2), '-i', srcVideo, '-t', dur.toFixed(2),
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out,
  ]
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const errText = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) throw new Error(`ffmpeg short gagal: ${errText.slice(-400)}`)

  await rm(srtPath, { force: true }).catch(() => {})
  await db.update(veoShorts).set({ status: 'done', path: out }).where(eq(veoShorts.id, shortId))
}
