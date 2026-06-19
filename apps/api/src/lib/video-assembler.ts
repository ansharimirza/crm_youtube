// Auto-edit: assemble per-scene Veo clips + TTS narration into one MP4, with
// optional burned captions (scene-level) and background music.
// Runs ffmpeg (installed in the API container). Meant for the Indonesia VPS.
//
// Sync guarantee: each scene's visual is forced to exactly its narration duration
// (tpad freezes the last frame if the clip is shorter; trim cuts it if longer), so
// concatenated visuals and concatenated narration line up by construction.

import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

const FPS = 30

export class AssembleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssembleError'
  }
}

export interface AssembleScene {
  videoPath: string // Veo clip (≈8s; its own audio is dropped)
  narrationPath: string // TTS audio (wav)
  narrationDur: number // exact seconds — drives the cut
  caption?: string // text shown during this scene (optional)
}

export interface AssembleOptions {
  musicPath?: string // background music (looped + ducked under narration)
}

function fmtSrtTime(sec: number): string {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const milli = ms % 1000
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`
}

function buildSrt(scenes: AssembleScene[]): string {
  let t = 0
  const blocks: string[] = []
  scenes.forEach((s, i) => {
    const start = t
    const end = t + Math.max(0.1, s.narrationDur)
    t = end
    const text = (s.caption ?? '').trim()
    if (!text) return
    blocks.push(`${i + 1}\n${fmtSrtTime(start)} --> ${fmtSrtTime(end)}\n${text}\n`)
  })
  return blocks.join('\n')
}

function buildFilterComplex(scenes: AssembleScene[], opts: { hasMusic: boolean; srtPath?: string }): string {
  const n = scenes.length
  const parts: string[] = []
  const vLabels: string[] = []
  const aLabels: string[] = []

  scenes.forEach((s, i) => {
    const d = Math.max(0.1, s.narrationDur).toFixed(3)
    parts.push(
      `[${i}:v]tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[v${i}]`,
    )
    vLabels.push(`[v${i}]`)
    parts.push(
      `[${n + i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`,
    )
    aLabels.push(`[a${i}]`)
  })

  // Video: concat, then optional caption burn
  if (opts.srtPath) {
    parts.push(`${vLabels.join('')}concat=n=${n}:v=1:a=0[vcat]`)
    parts.push(`[vcat]subtitles='${opts.srtPath}'[vout]`)
  } else {
    parts.push(`${vLabels.join('')}concat=n=${n}:v=1:a=0[vout]`)
  }

  // Audio: concat narration, then optional music mix (music input index = 2n)
  if (opts.hasMusic) {
    parts.push(`${aLabels.join('')}concat=n=${n}:v=0:a=1[narr]`)
    parts.push(`[${2 * n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.12[mus]`)
    parts.push(`[narr][mus]amix=inputs=2:duration=first:dropout_transition=0,dynaudnorm[aout]`)
  } else {
    parts.push(`${aLabels.join('')}concat=n=${n}:v=0:a=1[aout]`)
  }

  return parts.join(';')
}

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new AssembleError(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`)
  }
}

export async function assembleVideo(
  scenes: AssembleScene[],
  outPath: string,
  opts: AssembleOptions = {},
): Promise<{ path: string }> {
  if (scenes.length === 0) throw new AssembleError('No scenes to assemble')

  // Write captions if any scene has text
  let srtPath: string | undefined
  const srt = buildSrt(scenes)
  if (srt.trim()) {
    srtPath = join(dirname(outPath), `subs_${Date.now()}.srt`)
    await writeFile(srtPath, srt)
  }

  const inputs: string[] = []
  for (const s of scenes) inputs.push('-i', s.videoPath) // 0 .. n-1
  for (const s of scenes) inputs.push('-i', s.narrationPath) // n .. 2n-1
  if (opts.musicPath) inputs.push('-stream_loop', '-1', '-i', opts.musicPath) // 2n

  const args = [
    '-y',
    ...inputs,
    '-filter_complex',
    buildFilterComplex(scenes, { hasMusic: !!opts.musicPath, srtPath }),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    outPath,
  ]

  await runFfmpeg(args)
  return { path: outPath }
}
