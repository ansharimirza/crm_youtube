// TikTok Shop URL scraper — Opsi A (free, may fail for anti-bot pages)
// Fallback: pass raw HTML to Claude for extraction

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface ScrapedProduct {
  name: string
  description: string
  image_url: string | null
  price: string | null
  source: 'meta_tags' | 'json_ld' | 'html' | 'tiktok_redirect'
  raw_html?: string  // sent to Claude for refinement
}

export class ScrapeError extends Error {
  constructor(message: string) { super(message); this.name = 'ScrapeError' }
}

export async function scrapeProductUrl(url: string): Promise<ScrapedProduct> {
  if (!/^https?:\/\//.test(url)) throw new ScrapeError('URL harus diawali http:// atau https://')

  // STEP 1 — Follow redirects MANUALLY to extract product info from intermediate
  // Location headers (TikTok Shop encodes og_info there as of 2024+ after TT-Tokopedia merger)
  const ogFromRedirect = await chaseRedirectsForOgInfo(url)
  if (ogFromRedirect) {
    return {
      name: ogFromRedirect.title,
      description: ogFromRedirect.title,  // TT redirect only has title; description = title fallback
      image_url: ogFromRedirect.image,
      price: null,
      source: 'tiktok_redirect',
    }
  }

  // STEP 2 — Regular fetch with auto-redirect for non-TikTok sites
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5,id;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw new ScrapeError(`Fetch failed: ${err instanceof Error ? err.message : err}`)
  }

  if (!res.ok) {
    throw new ScrapeError(`HTTP ${res.status} — Site mungkin block. Coba upload gambar produk manual.`)
  }

  const html = await res.text()
  if (html.length < 100) throw new ScrapeError('Response kosong / terlalu pendek')

  // STEP 3 — OpenGraph meta tags
  const og = parseOpenGraph(html)
  if (og.name && og.description) {
    return { ...og, source: 'meta_tags' }
  }

  // STEP 4 — JSON-LD structured data
  const jsonLd = parseJsonLd(html)
  if (jsonLd) {
    return { ...jsonLd, source: 'json_ld' }
  }

  // STEP 5 — Fallback: return raw HTML for Claude
  return {
    name: og.name || '',
    description: og.description || '',
    image_url: og.image_url,
    price: null,
    source: 'html',
    raw_html: html,
  }
}

/**
 * Manually follow up to N redirects, returning the FIRST redirect URL that contains
 * og_info query parameter (which TikTok Shop links carry after the TT-Tokopedia merger).
 *
 * Flow for a TikTok Shop link:
 *   vt.tokopedia.com/t/XYZ  →  302  Location: tiktok.com/view/product/...?og_info={...}&...
 * The body of tiktok.com/view/product is a Security Check page (captcha) and is unscrapeable,
 * but the redirect URL itself contains the title + image we need.
 */
async function chaseRedirectsForOgInfo(
  startUrl: string,
  maxHops = 5,
): Promise<{ title: string; image: string | null } | null> {
  let current = startUrl
  for (let i = 0; i < maxHops; i++) {
    let res: Response
    try {
      res = await fetch(current, {
        method: 'HEAD',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5,id;q=0.5',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      return null
    }

    // Try to parse og_info from current URL first
    const parsed = parseOgInfoFromUrl(current)
    if (parsed) return parsed

    // Then check for redirect
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return null
      // Resolve relative locations
      current = new URL(loc, current).toString()
      // Parse from the new (redirect target) URL
      const parsedNext = parseOgInfoFromUrl(current)
      if (parsedNext) return parsedNext
      continue
    }
    // Non-redirect terminal — no og_info found
    return null
  }
  return null
}

function parseOgInfoFromUrl(url: string): { title: string; image: string | null } | null {
  try {
    const u = new URL(url)
    const raw = u.searchParams.get('og_info')
    if (!raw) return null
    const decoded = decodeURIComponent(raw)
    const obj = JSON.parse(decoded) as { title?: string; image?: string }
    if (!obj.title?.trim()) return null
    return {
      title: obj.title.trim(),
      image: obj.image?.trim() || null,
    }
  } catch {
    return null
  }
}

function parseOpenGraph(html: string): Omit<ScrapedProduct, 'source'> {
  const metaRegex = /<meta\s+[^>]*property=["']([^"']+)["'][^>]*content=["']([^"']+)["']/gi
  const metaRegexAlt = /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']([^"']+)["']/gi

  const tags: Record<string, string> = {}
  let m: RegExpExecArray | null
  while ((m = metaRegex.exec(html)) !== null) tags[m[1].toLowerCase()] = m[2]
  while ((m = metaRegexAlt.exec(html)) !== null) tags[m[2].toLowerCase()] = m[1]

  // Also try name="..." attribute style
  const nameMeta = /<meta\s+[^>]*name=["']([^"']+)["'][^>]*content=["']([^"']+)["']/gi
  while ((m = nameMeta.exec(html)) !== null) {
    const key = m[1].toLowerCase()
    if (!tags[key]) tags[key] = m[2]
  }

  return {
    name: decodeEntities(tags['og:title'] || tags['twitter:title'] || extractTitle(html) || ''),
    description: decodeEntities(tags['og:description'] || tags['twitter:description'] || tags['description'] || ''),
    image_url: tags['og:image'] || tags['twitter:image'] || null,
    price: tags['product:price:amount'] || tags['og:price:amount'] || null,
  }
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return m ? decodeEntities(m[1].trim()) : null
}

function parseJsonLd(html: string): Omit<ScrapedProduct, 'source'> | null {
  const regex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim())
      const product = findProduct(data)
      if (product) {
        return {
          name: typeof product.name === 'string' ? product.name : '',
          description: typeof product.description === 'string' ? product.description : '',
          image_url: typeof product.image === 'string' ? product.image
            : Array.isArray(product.image) && typeof product.image[0] === 'string' ? product.image[0]
            : null,
          price: product.offers?.price ?? product.offers?.lowPrice ?? null,
        }
      }
    } catch { /* skip invalid JSON */ }
  }
  return null
}

function findProduct(data: unknown): Record<string, any> | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, any>
  if (obj['@type'] === 'Product') return obj
  if (Array.isArray(data)) {
    for (const item of data) {
      const p = findProduct(item)
      if (p) return p
    }
  }
  if (obj['@graph']) {
    return findProduct(obj['@graph'])
  }
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}
