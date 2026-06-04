// TikTok Shop URL scraper — Opsi A (free, may fail for anti-bot pages)
// Fallback: pass raw HTML to Claude for extraction

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface ScrapedProduct {
  name: string
  description: string
  image_url: string | null
  price: string | null
  source: 'meta_tags' | 'json_ld' | 'html'
  raw_html?: string  // sent to Claude for refinement
}

export class ScrapeError extends Error {
  constructor(message: string) { super(message); this.name = 'ScrapeError' }
}

export async function scrapeProductUrl(url: string): Promise<ScrapedProduct> {
  if (!/^https?:\/\//.test(url)) throw new ScrapeError('URL harus diawali http:// atau https://')

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
    throw new ScrapeError(`HTTP ${res.status} — TikTok Shop mungkin block. Coba upload gambar produk manual.`)
  }

  const html = await res.text()
  if (html.length < 100) throw new ScrapeError('Response kosong / terlalu pendek')

  // Try OpenGraph meta tags first
  const og = parseOpenGraph(html)
  if (og.name && og.description) {
    return { ...og, source: 'meta_tags' }
  }

  // Try JSON-LD structured data
  const jsonLd = parseJsonLd(html)
  if (jsonLd) {
    return { ...jsonLd, source: 'json_ld' }
  }

  // Fallback: return raw HTML for Claude to extract
  return {
    name: og.name || '',
    description: og.description || '',
    image_url: og.image_url,
    price: null,
    source: 'html',
    raw_html: html,
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
