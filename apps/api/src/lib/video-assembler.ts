// Auto-edit: assemble per-scene Veo clips + TTS narration into one MP4.
// v1 (minimal): fit each clip to its narration duration, concat, overlay narration.
// Captions + background music come next. Runs ffmpeg (must be installed in the
// container — see API Dockerfile). Designed to run on the Indonesia VPS, not the
// tiny upload worker.
//
// Sync guarantee: each scene's visual is forced to exactly its narration duration,
// so concatenated visuals and concatenated narration are equal length and aligned
// by construction. `tpad` freezes the last frame if the clip is shorter than the
// narration; `trim` cuts it if longer — so we don't need to know the clip length.

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
}

// All clips must share resolution/SAR (true for clips from one project). Build the
// filter_complex that fits each clip to its narration length and concatenates.
function buildFilterComplex(scenes: AssembleScene[]): string {
  const n = scenes.length
  const parts: string[] = []
  const vLabels: string[] = []
  const aLabels: string[] = []

  scenes.forEach((s, i) => {
    const d = Math.max(0.1, s.narrationDur).toFixed(3)
    // video input index = i; audio (narration) input index = n + i
    parts.push(
      `[${i}:v]tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[v${i}]`,
    )
    vLabels.push(`[v${i}]`)
    parts.push(
      `[${n + i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`,
    )
    aLabels.push(`[a${i}]`)
  })

  parts.push(`${vLabels.join('')}concat=n=${n}:v=1:a=0[vout]`)
  parts.push(`${aLabels.join('')}concat=n=${n}:v=0:a=1[aout]`)
  return parts.join(';')
}

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new AssembleError(`ffmpeg exited ${code}: ${stderr.slice(-800)}`)
  }
}

export async function assembleVideo(scenes: AssembleScene[], outPath: string): Promise<{ path: string }> {
  if (scenes.length === 0) throw new AssembleError('No scenes to assemble')

  const inputs: string[] = []
  for (const s of scenes) inputs.push('-i', s.videoPath) // 0 .. n-1
  for (const s of scenes) inputs.push('-i', s.narrationPath) // n .. 2n-1

  const args = [
    '-y',
    ...inputs,
    '-filter_complex',
    buildFilterComplex(scenes),
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
