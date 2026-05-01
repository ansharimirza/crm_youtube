import { Elysia, t } from 'elysia'
import { desc, eq, ne, count } from 'drizzle-orm'
import { db, users, videos, youtubeAccounts } from '../db'
import { authMiddleware } from '../middleware/auth'

// Admin-only middleware
const adminOnly = new Elysia({ name: 'admin-only' })
  .use(authMiddleware)
  .onBeforeHandle(({ user, set }) => {
    if (user.role !== 'admin') {
      set.status = 403
      return { error: 'Admin only' }
    }
  })

export const adminRoutes = new Elysia({ prefix: '/api/admin' })
  .use(adminOnly)
  .get('/users', async () => {
    const list = await db.query.users.findMany({
      orderBy: [desc(users.createdAt)],
      columns: {
        id: true, email: true, name: true, role: true,
        isActive: true, createdAt: true, updatedAt: true,
      },
    })

    // Hitung jumlah video & channel per user
    const enriched = await Promise.all(list.map(async (u) => {
      const [videoCount] = await db.select({ count: count() }).from(videos).where(eq(videos.userId, u.id))
      const [channelCount] = await db.select({ count: count() }).from(youtubeAccounts).where(eq(youtubeAccounts.userId, u.id))
      return {
        ...u,
        videoCount: Number(videoCount.count),
        channelCount: Number(channelCount.count),
      }
    }))

    return { users: enriched }
  })
  .post('/users', async ({ body, set }) => {
    const email = body.email.toLowerCase().trim()
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
    if (existing) {
      set.status = 400
      return { error: 'Email sudah dipakai' }
    }

    const passwordHash = await Bun.password.hash(body.password)
    const [created] = await db.insert(users).values({
      email,
      passwordHash,
      name: body.name.trim(),
      role: body.role ?? 'user',
    }).returning({
      id: users.id, email: users.email, name: users.name,
      role: users.role, createdAt: users.createdAt,
    })

    return { user: created }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String({ minLength: 6 }),
      name: t.String({ minLength: 1, maxLength: 100 }),
      role: t.Optional(t.Union([t.Literal('admin'), t.Literal('user')])),
    }),
  })
  .patch('/users/:id', async ({ params, body, set, user }) => {
    const id = Number(params.id)
    if (id === user.id && (body.role === 'user' || body.isActive === false)) {
      set.status = 400
      return { error: 'Tidak bisa demote / disable diri sendiri' }
    }

    const target = await db.query.users.findFirst({ where: eq(users.id, id) })
    if (!target) {
      set.status = 404
      return { error: 'User tidak ditemukan' }
    }

    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
    if (body.name) updates.name = body.name.trim()
    if (body.email) updates.email = body.email.toLowerCase().trim()
    if (body.role) updates.role = body.role
    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive
    if (body.password) updates.passwordHash = await Bun.password.hash(body.password)

    await db.update(users).set(updates).where(eq(users.id, id))
    const updated = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true, email: true, name: true, role: true, isActive: true },
    })
    return { user: updated }
  }, {
    body: t.Partial(t.Object({
      email: t.String({ format: 'email' }),
      name: t.String({ minLength: 1, maxLength: 100 }),
      role: t.Union([t.Literal('admin'), t.Literal('user')]),
      isActive: t.Boolean(),
      password: t.String({ minLength: 6 }),
    })),
  })
  .delete('/users/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    if (id === user.id) {
      set.status = 400
      return { error: 'Tidak bisa hapus diri sendiri' }
    }
    const target = await db.query.users.findFirst({ where: eq(users.id, id) })
    if (!target) {
      set.status = 404
      return { error: 'User tidak ditemukan' }
    }
    await db.delete(users).where(eq(users.id, id))
    return { ok: true }
  })
  .get('/stats', async () => {
    const [userCount] = await db.select({ count: count() }).from(users)
    const [videoCount] = await db.select({ count: count() }).from(videos)
    const [channelCount] = await db.select({ count: count() }).from(youtubeAccounts)
    const [doneCount] = await db.select({ count: count() }).from(videos).where(eq(videos.status, 'done'))
    return {
      users: Number(userCount.count),
      videos: Number(videoCount.count),
      channels: Number(channelCount.count),
      videosUploaded: Number(doneCount.count),
    }
  })
