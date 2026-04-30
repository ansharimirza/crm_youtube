import { Elysia } from 'elysia'
import jwt from '@elysiajs/jwt'
import { eq } from 'drizzle-orm'
import { db, users, type User } from '../db'

export const authMiddleware = new Elysia({ name: 'auth-middleware' })
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET!,
    })
  )
  .derive({ as: 'scoped' }, async ({ headers, jwt, set }) => {
    const auth = headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      set.status = 401
      throw new Error('Unauthorized')
    }
    const payload = await jwt.verify(auth.slice(7))
    if (!payload || typeof payload === 'boolean') {
      set.status = 401
      throw new Error('Invalid token')
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, Number(payload.userId)),
    })
    if (!user) {
      set.status = 401
      throw new Error('User not found')
    }

    return { user: user as User }
  })
