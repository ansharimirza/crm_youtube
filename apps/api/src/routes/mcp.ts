// MCP server (Model Context Protocol) over Streamable HTTP / JSON-RPC.
// Lets Claude (Desktop/connector) drive the faceless-video factory:
//   list_youtube_accounts -> create_project -> get_status -> assemble_project -> upload_to_youtube
//
// Auth: a per-user MCP API key sent as `Authorization: Bearer <key>` on every call
// (generated via POST /api/mcp/key). The JSON-RPC endpoint is mounted at /mcp.

import { Elysia, t } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { db, users, veoProjects, youtubeAccounts, type User } from '../db'
import { authMiddleware } from '../middleware/auth'
import { assembleProject } from '../lib/veo-assemble-worker'
import { createFacelessProject, uploadProjectFinal } from '../lib/faceless-orchestrator'

// ===== Key management (uses normal JWT auth) =====
export const mcpKeyRoutes = new Elysia({ prefix: '/api/mcp' })
  .use(authMiddleware)
  .get('/key', async ({ user }) => ({ key: user.mcpApiKey ?? null }))
  .post('/key', async ({ user }) => {
    const key = `mcp_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
    await db.update(users).set({ mcpApiKey: key, updatedAt: new Date() }).where(eq(users.id, user.id))
    return { key }
  })

// ===== MCP tools =====
const TOOLS = [
  {
    name: 'list_youtube_accounts',
    description: 'List the connected YouTube channels (id + title) so you know which to upload to.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_project',
    description:
      'Create a faceless narration video project. Provide each scene as a paired image_prompt (the visual) and narration_text (the voiceover for that beat; keep each ~<=18 words so it fits an 8s clip). The backend then auto-generates, per scene: a Nano Banana image, a Veo clip animating it, and a TTS narration. Returns project_id; poll get_status.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              image_prompt: { type: 'string', description: 'Visual for this scene (any style)' },
              narration_text: { type: 'string', description: 'Voiceover line for this scene' },
            },
            required: ['image_prompt', 'narration_text'],
          },
        },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16'] },
        model: { type: 'string', description: 'Veo model, default veo-3.1-fast' },
      },
      required: ['title', 'scenes'],
    },
  },
  {
    name: 'get_status',
    description: 'Get generation + assembly status for a project (per-scene image/video/narration, assemble status, final video URL).',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'number' } },
      required: ['project_id'],
    },
  },
  {
    name: 'assemble_project',
    description: 'Assemble all done scenes (clip + narration + captions + music) into one final MP4. Run after scenes are done. Poll get_status for assemble_status.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'number' } },
      required: ['project_id'],
    },
  },
  {
    name: 'upload_to_youtube',
    description: 'Upload the assembled final video to YouTube. scheduled_at (ISO 8601) is optional — if in the future the video is scheduled.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'number' },
        youtube_account_id: { type: 'number' },
        title: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'string', description: 'comma-separated' },
        privacy: { type: 'string', enum: ['public', 'private', 'unlisted'] },
        scheduled_at: { type: 'string', description: 'ISO 8601, optional' },
      },
      required: ['project_id', 'youtube_account_id', 'title'],
    },
  },
] as const

async function runTool(user: User, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_youtube_accounts': {
      const accs = await db.query.youtubeAccounts.findMany({ where: eq(youtubeAccounts.userId, user.id) })
      return { accounts: accs.map((a) => ({ id: a.id, channel: a.channelTitle, email: a.email })) }
    }
    case 'create_project': {
      const { projectId, sceneIds } = await createFacelessProject(user.id, {
        title: String(args.title),
        scenes: (args.scenes as { image_prompt: string; narration_text: string }[]) ?? [],
        aspectRatio: args.aspect_ratio as '16:9' | '9:16' | undefined,
        model: args.model as string | undefined,
      })
      return { project_id: projectId, scene_count: sceneIds.length, note: 'Generating images+video+narration. Poll get_status.' }
    }
    case 'get_status': {
      const project = await db.query.veoProjects.findFirst({
        where: and(eq(veoProjects.id, Number(args.project_id)), eq(veoProjects.userId, user.id)),
        with: { scenes: { orderBy: (s, { asc }) => [asc(s.sceneNumber)] } },
      })
      if (!project) throw new Error('Project tidak ditemukan')
      return {
        title: project.title,
        assemble_status: project.assembleStatus,
        assemble_error: project.assembleError,
        final_video_url: project.finalVideoUrl,
        scenes: project.scenes.map((s) => ({
          scene_number: s.sceneNumber,
          status: s.status,
          progress: s.progress,
          has_image: !!s.firstImagePath,
          has_video: !!s.videoUrl,
          narration_dur: s.narrationDuration,
          error: s.errorMsg,
        })),
      }
    }
    case 'assemble_project': {
      const project = await db.query.veoProjects.findFirst({
        where: and(eq(veoProjects.id, Number(args.project_id)), eq(veoProjects.userId, user.id)),
      })
      if (!project) throw new Error('Project tidak ditemukan')
      await db.update(veoProjects).set({ assembleStatus: 'queued', assembleError: null, updatedAt: new Date() }).where(eq(veoProjects.id, project.id))
      queueMicrotask(() => assembleProject(project.id))
      return { ok: true, note: 'Assembling. Poll get_status for assemble_status=done + final_video_url.' }
    }
    case 'upload_to_youtube': {
      const { videoId } = await uploadProjectFinal(user.id, {
        projectId: Number(args.project_id),
        youtubeAccountId: Number(args.youtube_account_id),
        title: String(args.title),
        description: args.description as string | undefined,
        tags: args.tags as string | undefined,
        privacy: args.privacy as 'public' | 'private' | 'unlisted' | undefined,
        scheduledAt: (args.scheduled_at as string | undefined) ?? null,
      })
      return { ok: true, video_id: videoId }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

async function resolveMcpUser(authHeader?: string): Promise<User | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const key = authHeader.slice(7).trim()
  if (!key) return null
  const user = await db.query.users.findFirst({ where: eq(users.mcpApiKey, key) })
  return (user as User) ?? null
}

// ===== JSON-RPC endpoint (no JWT middleware; auth via MCP key) =====
// Path lives under /api so the existing nginx (proxies ^/(api|auth)) reaches it.
// MCP server URL for Claude = https://<domain>/api/mcp-rpc
export const mcpRoutes = new Elysia({ prefix: '/api/mcp-rpc' })
  .post('/', async ({ body, headers, set }) => {
    const req = body as { jsonrpc?: string; id?: number | string | null; method?: string; params?: any }
    const id = req?.id ?? null
    const method = req?.method ?? ''

    // Notifications (no id / notifications/*) need no response
    if (method.startsWith('notifications/')) {
      set.status = 202
      return ''
    }

    const user = await resolveMcpUser(headers.authorization)
    if (!user) {
      set.status = 401
      return { jsonrpc: '2.0', id, error: { code: -32001, message: 'Unauthorized: invalid MCP key' } }
    }

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: req.params?.protocolVersion ?? '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'ytcrm-faceless', version: '1.0.0' },
          },
        }
      }
      if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
      if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
      if (method === 'tools/call') {
        const name = req.params?.name as string
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>
        try {
          const result = await runTool(user, name, args)
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true } }
        }
      }
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set.status = 500
      return { jsonrpc: '2.0', id, error: { code: -32603, message: msg } }
    }
  }, {
    body: t.Any(),
  })
