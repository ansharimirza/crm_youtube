import { Elysia, t } from 'elysia'
import jwt from '@elysiajs/jwt'
import { eq } from 'drizzle-orm'
import { db, users } from '../db'

export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET!,
      exp: '30d',
    })
  )
  .post(
    '/register',
    async ({ body, jwt, set }) => {
      const email = body.email.toLowerCase().trim()

      const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
      if (existing) {
        set.status = 400
        return { error: 'Email sudah terdaftar' }
      }

      const passwordHash = await Bun.password.hash(body.password)
      const isFirstUser = (await db.query.users.findFirst()) === undefined

      const [user] = await db.insert(users).values({
        email,
        passwordHash,
        name: body.name.trim(),
        role: isFirstUser ? 'admin' : 'user',
      }).returning()

      const token = await jwt.sign({ userId: user.id })
      return {
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 6, maxLength: 200 }),
        name: t.String({ minLength: 1, maxLength: 100 }),
      }),
    }
  )
  .post(
    '/login',
    async ({ body, jwt, set }) => {
      const email = body.email.toLowerCase().trim()
      const user = await db.query.users.findFirst({ where: eq(users.email, email) })

      if (!user) {
        set.status = 401
        return { error: 'Email atau password salah' }
      }

      const valid = await Bun.password.verify(body.password, user.passwordHash)
      if (!valid) {
        set.status = 401
        return { error: 'Email atau password salah' }
      }

      const token = await jwt.sign({ userId: user.id })
      return {
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 1, maxLength: 200 }),
      }),
    }
  )
  .get('/me', async ({ headers, jwt, set }) => {
    const auth = headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
    const payload = await jwt.verify(auth.slice(7))
    if (!payload || typeof payload === 'boolean') {
      set.status = 401
      return { error: 'Invalid token' }
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, Number(payload.userId)),
      columns: { id: true, email: true, name: true, role: true, geminigenApiKey: true, geminiApiKey: true, createdAt: true },
    })

    if (!user) {
      set.status = 401
      return { error: 'User not found' }
    }

    return {
      user: {
        ...user,
        hasGeminigenKey: !!user.geminigenApiKey,
        hasGeminiKey: !!user.geminiApiKey,
        geminigenApiKey: undefined,
        geminiApiKey: undefined,
      },
    }
  })
  .patch('/me/settings', async ({ headers, jwt, body, set }) => {
    const auth = headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      set.status = 401
      return { error: 'Unauthorized' }
    }
    const payload = await jwt.verify(auth.slice(7))
    if (!payload || typeof payload === 'boolean') {
      set.status = 401
      return { error: 'Invalid token' }
    }

    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
    if (body.geminigenApiKey !== undefined) {
      updates.geminigenApiKey = body.geminigenApiKey.trim() || null
    }
    if (body.geminiApiKey !== undefined) {
      updates.geminiApiKey = body.geminiApiKey.trim() || null
    }

    await db.update(users).set(updates).where(eq(users.id, Number(payload.userId)))
    return { ok: true }
  }, {
    body: t.Object({
      geminigenApiKey: t.Optional(t.String({ maxLength: 500 })),
      geminiApiKey: t.Optional(t.String({ maxLength: 500 })),
    }),
  })
