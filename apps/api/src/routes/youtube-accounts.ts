import { Elysia, t } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { db, youtubeAccounts } from '../db'
import { authMiddleware } from '../middleware/auth'
import { buildAuthUrl, exchangeCodeForTokens, getUserInfo, getChannelInfo } from '../lib/google'

export const youtubeAccountRoutes = new Elysia({ prefix: '/api/youtube-accounts' })
  .use(authMiddleware)
  .get('/', async ({ user }) => {
    const accounts = await db.query.youtubeAccounts.findMany({
      where: eq(youtubeAccounts.userId, user.id),
      columns: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        channelTitle: true,
        channelId: true,
        createdAt: true,
      },
    })
    return { accounts }
  })
  .get(
    '/connect-url',
    async ({ user, query }) => {
      // State berisi userId untuk verifikasi setelah callback
      const state = JSON.stringify({ userId: user.id, ts: Date.now() })
      const url = buildAuthUrl(Buffer.from(state).toString('base64url'), query.redirect_uri)
      return { url }
    },
    {
      query: t.Object({ redirect_uri: t.Optional(t.String()) }),
    }
  )
  .post(
    '/connect',
    async ({ body, user, set }) => {
      try {
        const tokens = await exchangeCodeForTokens(body.code, body.redirect_uri)
        if (!tokens.access_token) {
          set.status = 400
          return { error: 'No access token received' }
        }

        const userInfo = await getUserInfo(tokens.access_token)
        if (!userInfo.id || !userInfo.email) {
          set.status = 400
          return { error: 'Failed to fetch Google user info' }
        }

        const channel = await getChannelInfo(tokens.access_token)

        // Cek kalau google account ini sudah terhubung ke user yang sama
        const existing = await db.query.youtubeAccounts.findFirst({
          where: and(
            eq(youtubeAccounts.userId, user.id),
            eq(youtubeAccounts.googleId, userInfo.id)
          ),
        })

        if (existing) {
          // Update tokens
          await db.update(youtubeAccounts).set({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? existing.refreshToken,
            tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            email: userInfo.email,
            name: userInfo.name ?? null,
            avatarUrl: userInfo.picture ?? null,
            channelId: channel.id,
            channelTitle: channel.title,
          }).where(eq(youtubeAccounts.id, existing.id))
          return { account: { ...existing, channelTitle: channel.title }, updated: true }
        }

        const [account] = await db.insert(youtubeAccounts).values({
          userId: user.id,
          googleId: userInfo.id,
          email: userInfo.email,
          name: userInfo.name ?? null,
          avatarUrl: userInfo.picture ?? null,
          channelId: channel.id,
          channelTitle: channel.title,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        }).returning()

        return {
          account: {
            id: account.id,
            email: account.email,
            name: account.name,
            avatarUrl: account.avatarUrl,
            channelTitle: account.channelTitle,
            channelId: account.channelId,
            createdAt: account.createdAt,
          },
          updated: false,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Connect failed'
        set.status = 400
        return { error: msg }
      }
    },
    {
      body: t.Object({
        code: t.String(),
        redirect_uri: t.Optional(t.String()),
      }),
    }
  )
  .delete('/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const account = await db.query.youtubeAccounts.findFirst({
      where: and(eq(youtubeAccounts.id, id), eq(youtubeAccounts.userId, user.id)),
    })
    if (!account) {
      set.status = 404
      return { error: 'YouTube account not found' }
    }
    await db.delete(youtubeAccounts).where(eq(youtubeAccounts.id, id))
    return { ok: true }
  })
