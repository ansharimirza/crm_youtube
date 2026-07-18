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
  .derive({ as: 'global' }, async ({ headers, query, jwt, set }) => {
    // Token from the Authorization header, or a ?token= query param (needed for media
    // streaming via <video src>/<img src>, which can't set custom headers).
    const auth = headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : (query as { token?: string })?.token
    if (!token) {
      set.status = 401
      throw new Error('Unauthorized')
    }
    const payload = await jwt.verify(token)
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
