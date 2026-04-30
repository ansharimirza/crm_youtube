import { google } from 'googleapis'

export const YOUTUBE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
]

export function buildOAuthClient(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const defaultRedirect = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !(redirectUri || defaultRedirect)) {
    throw new Error('Google OAuth credentials not configured')
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri || defaultRedirect)
}

export function buildAuthUrl(state: string, redirectUri?: string) {
  const oauth = buildOAuthClient(redirectUri)
  return oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: YOUTUBE_SCOPES,
    state,
    include_granted_scopes: true,
  })
}

export async function exchangeCodeForTokens(code: string, redirectUri?: string) {
  const oauth = buildOAuthClient(redirectUri)
  const { tokens } = await oauth.getToken(code)
  return tokens
}

export async function getUserInfo(accessToken: string) {
  const oauth = buildOAuthClient()
  oauth.setCredentials({ access_token: accessToken })

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth })
  const { data } = await oauth2.userinfo.get()
  return data
}

export async function getChannelInfo(accessToken: string) {
  const oauth = buildOAuthClient()
  oauth.setCredentials({ access_token: accessToken })

  const youtube = google.youtube({ version: 'v3', auth: oauth })
  try {
    const { data } = await youtube.channels.list({
      part: ['snippet'],
      mine: true,
    })
    const channel = data.items?.[0]
    return channel
      ? { id: channel.id ?? null, title: channel.snippet?.title ?? null }
      : { id: null, title: null }
  } catch {
    return { id: null, title: null }
  }
}
