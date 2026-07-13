// Auto-edit: assemble per-scene visuals + TTS narration into one MP4, with
// optional burned captions and background music.
//
// Each scene's visual is either a Veo CLIP (videoPath) or a STILL IMAGE animated
// with a Ken Burns pan/zoom (imagePath). Both are forced to exactly the scene's
// narration duration, so the stitched video and narration line up by construction.
//
// BATCH MODE (for long videos / small RAM): render each scene to a segment, then
// stitch via the concat *demuxer* (constant memory regardless of scene count).

import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'

const FPS = 30

export class AssembleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssembleError'
  }
}

export type SceneMotion = 'static' | 'zoom' | 'pan_left' | 'pan_right'

export interface AssembleScene {
  videoPath?: string // Veo clip (its own audio is dropped)
  imagePath?: string // still image → Ken Burns or static (used when no videoPath)
  noZoom?: boolean // still image held with NO motion (static mode)
  motion?: SceneMotion // per-scene motion for still images (overrides noZoom when set)
  narrationPath?: string // per-scene narration audio (omitted in full-narration mode)
  narrationDur: number // exact seconds — drives the cut
  caption?: string // optional burned subtitle text
}

export interface AssembleOptions {
  musicPath?: string // background music (looped + ducked under narration)
  // Full-narration mode: one voiceover for the whole video. Scenes are rendered
  // silent (each held for its computed narrationDur) and this audio is laid over the top.
  fullNarrationPath?: string
  width?: number // output size for Ken Burns scenes (default 1920)
  height?: number // default 1080
}

const NARR_FILTER = (d: string) =>
  `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${d},asetpts=PTS-STARTPTS`

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new AssembleError(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`)
}

// One scene -> a uniform segment file (visual fitted to its duration). With a
// per-scene narrationPath that narration is the segment audio; without one the
// segment is silent (full-narration mode lays a single track over everything).
// Uniform codec params so the concat demuxer can stitch them.
async function renderSegment(scene: AssembleScene, segPath: string, w: number, h: number): Promise<void> {
  const d = Math.max(0.1, scene.narrationDur).toFixed(3)
  const silent = !scene.narrationPath
  const commonOut = [
    '-map', '[v]', ...(silent ? ['-an'] : ['-map', '[a]']),
    '-t', d,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    ...(silent ? [] : ['-c:a', 'aac', '-b:a', '192k']),
    '-video_track_timescale', '30000',
    segPath,
  ]

  if (scene.imagePath && !scene.videoPath) {
    // Resolve the motion: explicit per-scene override, else project mode (noZoom → static).
    const motion: SceneMotion = scene.motion ?? (scene.noZoom ? 'static' : 'zoom')
    const df = Math.max(1, Math.round(Math.max(0.1, scene.narrationDur) * FPS))
    let vf: string
    if (motion === 'static') {
      // Fill the frame (image is already at the right aspect), no motion.
      vf =
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,` +
        `fps=${FPS},trim=duration=${d},setpts=PTS-STARTPTS,format=yuv420p[v]`
    } else {
      // Ken Burns family — scale to fill 2x target, then zoom or pan across the extra room.
      // pan uses a fixed slight zoom and slides x; zoom uses a gentle centre zoom-in.
      const zExpr = motion === 'zoom' ? `z='min(zoom+0.0004,1.10)'` : `z='1.12'`
      let xExpr = `x='iw/2-(iw/zoom/2)'` // centred (zoom)
      if (motion === 'pan_right') xExpr = `x='(iw-iw/zoom)*on/${df}'`       // camera pans right
      else if (motion === 'pan_left') xExpr = `x='(iw-iw/zoom)*(1-on/${df})'` // camera pans left
      vf =
        `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},` +
        `zoompan=${zExpr}:d=${df}:${xExpr}:y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${FPS},` +
        `trim=duration=${d},setpts=PTS-STARTPTS,format=yuv420p[v]`
    }
    const fc = silent ? vf : `${vf};[1:a]${NARR_FILTER(d)}[a]`
    await runFfmpeg([
      '-y', '-loop', '1', '-i', scene.imagePath, ...(silent ? [] : ['-i', scene.narrationPath!]),
      '-filter_complex', fc,
      ...commonOut,
    ])
    return
  }

  // Veo clip: freeze last frame if shorter than narration, trim if longer.
  const vf =
    `[0:v]tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[v]`
  const fc = silent ? vf : `${vf};[1:a]${NARR_FILTER(d)}[a]`
  await runFfmpeg([
    '-y', '-i', scene.videoPath!, ...(silent ? [] : ['-i', scene.narrationPath!]),
    '-filter_complex', fc,
    ...commonOut,
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
  const w = opts.width ?? 1920
  const h = opts.height ?? 1080

  const workDir = join(dirname(outPath), `assemble_${Date.now()}`)
  await mkdir(workDir, { recursive: true })

  try {
    // Phase A — render each scene to a segment (sequential = flat memory)
    const segPaths: string[] = []
    for (let i = 0; i < scenes.length; i++) {
      const segPath = join(workDir, `seg_${String(i).padStart(4, '0')}.mp4`)
      await renderSegment(scenes[i], segPath, w, h)
      segPaths.push(segPath)
    }

    const listPath = join(workDir, 'segments.txt')
    await writeFile(listPath, segPaths.map((p) => `file '${p}'`).join('\n'))

    const srt = buildSrt(scenes)
    let srtPath: string | undefined
    if (srt.trim()) {
      srtPath = join(workDir, 'captions.srt')
      await writeFile(srtPath, srt)
    }

    // Phase B — single final pass: concat + optional captions + optional music
    //   + optional full narration (one voiceover laid over the silent segments).
    const hasFull = !!opts.fullNarrationPath
    if (!srtPath && !opts.musicPath && !hasFull) {
      // per-scene audio already baked into the segments → straight concat
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outPath])
    } else {
      const inputs = ['-f', 'concat', '-safe', '0', '-i', listPath]
      let idx = 1
      let narrIdx = -1
      let musIdx = -1
      if (hasFull) { inputs.push('-i', opts.fullNarrationPath!); narrIdx = idx++ }
      if (opts.musicPath) { inputs.push('-stream_loop', '-1', '-i', opts.musicPath); musIdx = idx++ }

      const fparts: string[] = []
      const stereo = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'

      // ---- video chain (vIn = bracketed input for the next filter; vmap = -map token) ----
      let vIn = '[0:v]'
      let vmap = '0:v'
      let vcodec = ['-c:v', 'copy']
      const reencodeV = () => { vcodec = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'] }
      if (srtPath) {
        fparts.push(`${vIn}subtitles='${srtPath}'[vsub]`)
        vIn = '[vsub]'; vmap = '[vsub]'
        reencodeV()
      }
      if (hasFull) {
        // Full narration must play to the very end. Frame-rounding makes the stitched
        // video a few seconds shorter than the audio, so hold the last frame (tpad) to
        // cover the gap; -shortest then trims the held tail to the exact audio length.
        fparts.push(`${vIn}tpad=stop_mode=clone:stop_duration=30[vpad]`)
        vIn = '[vpad]'; vmap = '[vpad]'
        reencodeV()
      }
      void vIn

      // ---- audio chain: single full track, or per-scene audio from concat (0:a) ----
      let amap = '0:a'
      let acodec = ['-c:a', 'copy']
      if (hasFull) {
        fparts.push(`[${narrIdx}:a]${stereo}[narr]`)
        if (musIdx >= 0) {
          fparts.push(`[${musIdx}:a]${stereo},volume=0.12[mus]`)
          fparts.push(`[narr][mus]amix=inputs=2:duration=first:dropout_transition=0,dynaudnorm[aout]`)
          amap = '[aout]'
        } else {
          amap = '[narr]'
        }
        acodec = ['-c:a', 'aac', '-b:a', '192k']
      } else if (musIdx >= 0) {
        fparts.push(`[${musIdx}:a]${stereo},volume=0.12[mus]`)
        fparts.push(`[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0,dynaudnorm[aout]`)
        amap = '[aout]'
        acodec = ['-c:a', 'aac', '-b:a', '192k']
      }

      const args = ['-y', ...inputs]
      if (fparts.length) args.push('-filter_complex', fparts.join(';'))
      args.push('-map', vmap, '-map', amap, ...vcodec, ...acodec)
      if (hasFull) args.push('-shortest') // trim the held last frame to the audio length
      args.push('-movflags', '+faststart', outPath)
      await runFfmpeg(args)
    }

    return { path: outPath }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
