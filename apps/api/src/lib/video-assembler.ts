// Auto-edit: assemble per-scene Veo clips + TTS narration into one MP4, with
// optional burned captions (scene-level) and background music.
//
// BATCH MODE (for long videos on small RAM): render each scene to a small
// self-contained segment (one ffmpeg, 2 inputs), then stitch all segments with
// the concat *demuxer* (streams from disk — constant memory regardless of count),
// applying captions + music in a single final pass. This keeps memory flat even
// for 100+ scenes / 8-minute videos on a 2-core/4GB box.
//
// Sync: each scene's visual is forced to exactly its narration duration (tpad
// freezes the last frame if the clip is shorter; trim cuts it if longer), so the
// stitched video and narration line up by construction.

import { mkdir, writeFile, rm } from 'node:fs/promises'
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

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new AssembleError(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`)
}

// One scene -> a uniform segment file (video fitted to narration + that narration
// as audio). Uniform codec params so the concat demuxer can stitch them.
async function renderSegment(scene: AssembleScene, segPath: string): Promise<void> {
  const d = Math.max(0.1, scene.narrationDur).toFixed(3)
  const filter =
    `[0:v]tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[v];` +
    `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${d},asetpts=PTS-STARTPTS[a]`
  await runFfmpeg([
    '-y',
    '-i', scene.videoPath,
    '-i', scene.narrationPath,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-video_track_timescale', '30000',
    segPath,
  ])
}

function fmtSrtTime(sec: number): string {
  const ms = Math.round(sec * 1000)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor((ms % 3_600_000) / 60_000))}:${p(Math.floor((ms % 60_000) / 1000))},${p(ms % 1000, 3)}`
}

function buildSrt(scenes: AssembleScene[]): string {
  let t = 0
  const blocks: string[] = []
  scenes.forEach((s, i) => {
    const start = t
    const end = t + Math.max(0.1, s.narrationDur)
    t = end
    const text = (s.caption ?? '').trim()
    if (text) blocks.push(`${i + 1}\n${fmtSrtTime(start)} --> ${fmtSrtTime(end)}\n${text}\n`)
  })
  return blocks.join('\n')
}

export async function assembleVideo(
  scenes: AssembleScene[],
  outPath: string,
  opts: AssembleOptions = {},
): Promise<{ path: string }> {
  if (scenes.length === 0) throw new AssembleError('No scenes to assemble')

  const workDir = join(dirname(outPath), `assemble_${Date.now()}`)
  await mkdir(workDir, { recursive: true })

  try {
    // Phase A — render each scene to a segment (sequential = flat memory)
    const segPaths: string[] = []
    for (let i = 0; i < scenes.length; i++) {
      const segPath = join(workDir, `seg_${String(i).padStart(4, '0')}.mp4`)
      await renderSegment(scenes[i], segPath)
      segPaths.push(segPath)
    }

    // concat list (demuxer streams these from disk)
    const listPath = join(workDir, 'segments.txt')
    await writeFile(listPath, segPaths.map((p) => `file '${p}'`).join('\n'))

    // captions over the full timeline
    const srt = buildSrt(scenes)
    let srtPath: string | undefined
    if (srt.trim()) {
      srtPath = join(workDir, 'captions.srt')
      await writeFile(srtPath, srt)
    }

    // Phase B — single final pass: concat + optional captions + optional music
    if (!srtPath && !opts.musicPath) {
      // nothing to overlay → fast stream copy
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outPath])
    } else {
      const inputs = ['-f', 'concat', '-safe', '0', '-i', listPath]
      if (opts.musicPath) inputs.push('-stream_loop', '-1', '-i', opts.musicPath)

      const fparts: string[] = []
      // video: burn captions (re-encode) or copy
      let vmap = '0:v'
      let vcodec = ['-c:v', 'copy']
      if (srtPath) {
        fparts.push(`[0:v]subtitles='${srtPath}'[vout]`)
        vmap = '[vout]'
        vcodec = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']
      }
      // audio: mix music (re-encode) or copy narration
      let amap = '0:a'
      let acodec = ['-c:a', 'copy']
      if (opts.musicPath) {
        fparts.push(`[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.12[mus]`)
        fparts.push(`[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0,dynaudnorm[aout]`)
        amap = '[aout]'
        acodec = ['-c:a', 'aac', '-b:a', '192k']
      }

      const args = ['-y', ...inputs]
      if (fparts.length) args.push('-filter_complex', fparts.join(';'))
      args.push('-map', vmap, '-map', amap, ...vcodec, ...acodec, '-movflags', '+faststart', outPath)
      await runFfmpeg(args)
    }

    return { path: outPath }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
