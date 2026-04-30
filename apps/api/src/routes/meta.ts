import { Elysia } from 'elysia'
import { YOUTUBE_CATEGORIES } from '../lib/categories'

export const metaRoutes = new Elysia({ prefix: '/api/meta' })
  .get('/categories', () => ({ categories: YOUTUBE_CATEGORIES }))
