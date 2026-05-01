import { Elysia, t } from 'elysia'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, notifications } from '../db'
import { authMiddleware } from '../middleware/auth'

export const notificationRoutes = new Elysia({ prefix: '/api/notifications' })
  .use(authMiddleware)
  .get('/', async ({ user, query }) => {
    const limit = Math.min(Number(query.limit ?? 50), 100)
    const list = await db.query.notifications.findMany({
      where: eq(notifications.userId, user.id),
      orderBy: [desc(notifications.createdAt)],
      limit,
    })
    const unreadCount = list.filter(n => !n.isRead).length
    return { notifications: list, unreadCount }
  }, {
    query: t.Object({
      limit: t.Optional(t.String()),
    }),
  })
  .post('/mark-read', async ({ body, user }) => {
    if (body.ids && body.ids.length > 0) {
      await db.update(notifications)
        .set({ isRead: true })
        .where(and(
          eq(notifications.userId, user.id),
          inArray(notifications.id, body.ids),
        ))
    } else {
      await db.update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, user.id))
    }
    return { ok: true }
  }, {
    body: t.Object({
      ids: t.Optional(t.Array(t.Number())),
    }),
  })
  .delete('/:id', async ({ params, user, set }) => {
    const id = Number(params.id)
    const n = await db.query.notifications.findFirst({
      where: and(eq(notifications.id, id), eq(notifications.userId, user.id)),
    })
    if (!n) {
      set.status = 404
      return { error: 'Not found' }
    }
    await db.delete(notifications).where(eq(notifications.id, id))
    return { ok: true }
  })
