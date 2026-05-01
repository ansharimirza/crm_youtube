import { db, notifications } from '../db'

export async function notify(params: {
  userId: number
  videoId?: number
  type: string
  title: string
  message: string
}) {
  await db.insert(notifications).values({
    userId: params.userId,
    videoId: params.videoId ?? null,
    type: params.type,
    title: params.title,
    message: params.message,
  })
}
