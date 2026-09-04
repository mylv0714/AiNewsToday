import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCli } from './is-cli'
import Parser from 'rss-parser'
import { feeds, type Feed } from '../src/data/feeds'
import { kstToday } from '../src/lib/editions'
import type { Candidate } from '../src/lib/schema'

const UA = 'MorningBrief/1.0 (personal digest; +https://github.com)'
const parser = new Parser({ timeout: 12_000 })

const AI_KEYWORD =
  /\b(ai|a\.i\.|llm|llms|gpt-?\d*|chatgpt|claude|gemini|openai|anthropic|deepmind|huggingface|hugging face|machine learning|neural|transformer|diffusion|agentic|inference|vllm|ollama|langchain|mcp|foundation model|large language)\b/i

const HYPE =
  /\b(game-?changing|groundbreaking|shocking|must-read|revolutionary|finally|unbelievable|혁신적|충격|마침내|판을 갈)\b/i

const SKIP_TITLE =
  /\b(webinar|we're hiring|is hiring|prompt(?:s)? I (?:used|tried)|funding round|token price|airdrop|giveaway)\b/i

const NAV_TITLE = /^(alignment|research|news|newsroom|product|announcements|company|careers|blog|papers|overview)$/i

const NEWS_HOURS = 48
const PAPER_HOURS = 48
const MAX_CANDIDATES = 72

function hoursAgoUnix(hours: number): number {
  return Math.floor(Date.now() / 1000) - hours * 3600
}

function daysAgoYmd(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function ageHours(iso: string): number {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY
  return (Date.now() - then) / 3_600_000
}

function isFresh(iso: string, hours: number): boolean {
  return ageHours(iso) <= hours
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if (parsed.pathname.endsWith('/') && parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.slice(0, -1)
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'fbclid') {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString()
  } catch {
    return url.trim()
  }
}

function idFor(url: string, title: string): string {
  return createHash('sha1').update(`${normalizeUrl(url)}|${title}`).digest('hex').slice(0, 12)
}

function toIso(value: string | undefined): string {
  if (!value) return new Date().toISOString()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function snippetOf(text: string | undefined, max = 280): string {
  if (!text) return ''
  const flat = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function withExtra(item: Candidate, extra: Record<string, string | number>): Candidate {
  return { ...item, extra: { ...item.extra, ...extra } }
}

async function fetchText(url: string, accept?: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: accept ?? 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html',
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return response.text()
}

function defaultHours(feed: Feed): number {
  return feed.hours ?? (feed.tier === 1 ? NEWS_HOURS : 72)
}

async function collectOneFeed(feed: Feed): Promise<Candidate[]> {
  const xml = await fetchText(feed.url)
  const parsed = await parser.parseString(xml)
  const windowHours = defaultHours(feed)
  const cap = feed.maxItems ?? (feed.tier === 1 ? 8 : 4)
  const out: Candidate[] = []

  for (const entry of parsed.items) {
    const url = entry.link
    const title = entry.title?.trim()
    if (!url || !title || SKIP_TITLE.test(title)) continue
    const published = toIso(entry.isoDate ?? entry.pubDate)
    if (!isFresh(published, windowHours)) continue
    const snippet = snippetOf(entry.contentSnippet ?? entry.content)
    if (feed.requireAiKeyword && !AI_KEYWORD.test(`${title} ${snippet}`)) continue
    out.push(
      withExtra(
        {
          id: idFor(url, title),
          title,
          url: normalizeUrl(url),
          source: feed.name,
          published_at: published,
          snippet,
        },
        { tier: feed.tier },
      ),
    )
  }

  return out
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, cap)
}

async function collectRss(): Promise<Candidate[]> {
  const settled = await Promise.allSettled(feeds.map((feed) => collectOneFeed(feed)))
  const items: Candidate[] = []
  settled.forEach((result, index) => {
    const name = feeds[index]?.name ?? 'rss'
    if (result.status === 'fulfilled') {
      items.push(...result.value)
      console.log(`[rss] ${name}: ${result.value.length}`)
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : result.reason
      console.warn(`[rss] ${name}:`, reason)
    }
  })
  return items
}

type OfficialPage = {
  name: string
  url: string
  pathPrefix: string
}

const officialPages: OfficialPage[] = [
  { name: 'Anthropic', url: 'https://www.anthropic.com/news', pathPrefix: '/news/' },
  { name: 'Anthropic', url: 'https://www.anthropic.com/research', pathPrefix: '/research/' },
]

function cardTitle(chunk: string): string | undefined {
  return (
    chunk.match(/<(?:h[1-6]|span|div)[^>]*title[^>]*>([^<]+)</i)?.[1] ??
    chunk.match(/<h[1-6][^>]*>([^<]+)</i)?.[1]
  )?.replace(/\s+/g, ' ').trim()
}

function collectOfficialCards(html: string, page: OfficialPage): Candidate[] {
  const origin = new URL(page.url).origin
  const escaped = page.pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hrefRe = new RegExp(`href="(${escaped}[^"#?]+)"`, 'gi')
  const seen = new Set<string>()
  const items: Candidate[] = []

  for (const match of html.matchAll(hrefRe)) {
    const path = match[1]
    if (!path || path === page.pathPrefix || seen.has(path)) continue
    const start = match.index ?? 0
    const chunk = html.slice(start, start + 1200)
    const title = cardTitle(chunk)
    if (!title || title.length < 18 || NAV_TITLE.test(title) || SKIP_TITLE.test(title)) continue
    const dateText = chunk.match(/<time[^>]*>([^<]+)<\/time>/i)?.[1]?.trim()
    if (!dateText) continue
    const published = toIso(dateText)
    if (!isFresh(published, 120)) continue
    seen.add(path)
    const snippet = snippetOf(chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1], 240)
    const url = normalizeUrl(new URL(path, origin).toString())
    items.push(
      withExtra(
        {
          id: idFor(url, title),
          title,
          url,
          source: page.name,
          published_at: published,
          snippet,
        },
        { tier: 1 },
      ),
    )
  }
  return items.slice(0, 8)
}

async function collectOfficialPages(): Promise<Candidate[]> {
  const settled = await Promise.allSettled(
    officialPages.map(async (page) => {
      const html = await fetchText(page.url, 'text/html')
      return collectOfficialCards(html, page)
    }),
  )
  const items: Candidate[] = []
  settled.forEach((result, index) => {
    const name = officialPages[index]?.url ?? 'official'
    if (result.status === 'fulfilled') {
      items.push(...result.value)
      console.log(`[official] ${name}: ${result.value.length}`)
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : result.reason
      console.warn(`[official] ${name}:`, reason)
    }
  })
  return items
}

type AlgoliaHit = {
  objectID: string
  title: string | null
  url: string | null
  story_url?: string | null
  created_at: string
  points: number
  num_comments: number
}

async function searchHn(url: string): Promise<AlgoliaHit[]> {
  const raw = await fetchText(url)
  const data = JSON.parse(raw) as { hits?: AlgoliaHit[] }
  return data.hits ?? []
}

function hnCandidate(hit: AlgoliaHit): Candidate | null {
  const title = hit.title?.trim() ?? ''
  if (!title || SKIP_TITLE.test(title) || !AI_KEYWORD.test(title)) return null
  if ((hit.points ?? 0) < 8) return null
  const link = hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`
  return withExtra(
    {
      id: idFor(link, title),
      title,
      url: normalizeUrl(link),
      source: 'Hacker News',
      published_at: toIso(hit.created_at),
      snippet: `HN ${hit.points} points, ${hit.num_comments} comments`,
    },
    { tier: 2, points: hit.points, comments: hit.num_comments },
  )
}

async function collectHn(): Promise<Candidate[]> {
  const since = hoursAgoUnix(36)
  const [popular, recent] = await Promise.all([
    searchHn(
      `https://hn.algolia.com/api/v1/search?query=AI&tags=story&hitsPerPage=40` +
        `&numericFilters=created_at_i>${since},points>=10`,
    ),
    searchHn(
      `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=80` +
        `&numericFilters=created_at_i>${since},points>=10`,
    ),
  ])

  const items: Candidate[] = []
  for (const hit of [...popular, ...recent]) {
    const item = hnCandidate(hit)
    if (item) items.push(item)
  }
  return items
}

type HfDailyPaper = {
  publishedAt?: string
  title?: string
  summary?: string
  paper?: {
    id?: string
    title?: string
    summary?: string
    publishedAt?: string
    submittedOnDailyAt?: string
    upvotes?: number
    authors?: { name?: string }[]
  }
}

async function collectPapers(): Promise<Candidate[]> {
  const raw = await fetchText('https://huggingface.co/api/daily_papers')
  const rows = JSON.parse(raw) as HfDailyPaper[]
  const scored = rows
    .map((row) => {
      const paper = row.paper ?? {}
      const id = paper.id
      const title = (paper.title || row.title || '').replace(/\s+/g, ' ').trim()
      if (!id || !title) return null
      const submitted = toIso(paper.submittedOnDailyAt ?? row.publishedAt ?? paper.publishedAt)
      const upvotes = paper.upvotes ?? 0
      if (!isFresh(submitted, 72) && upvotes < 8) return null
      if (!isFresh(submitted, PAPER_HOURS + 24) && upvotes < 20) return null
      const authors = (paper.authors ?? [])
        .map((author) => author.name)
        .filter((name): name is string => Boolean(name))
        .slice(0, 4)
        .join(', ')
      const url = `https://arxiv.org/abs/${id}`
      return withExtra(
        {
          id: idFor(url, title),
          title,
          url: normalizeUrl(url),
          source: 'Hugging Face Papers',
          published_at: submitted,
          snippet: snippetOf(paper.summary || row.summary, 360),
        },
        {
          tier: 1,
          upvotes,
          ...(authors ? { authors } : {}),
        },
      )
    })
    .filter((item): item is Candidate => item !== null)
    .sort((a, b) => Number(b.extra?.upvotes ?? 0) - Number(a.extra?.upvotes ?? 0))

  const recent = scored.filter((item) => isFresh(item.published_at, PAPER_HOURS))
  const pool = recent.length >= 5 ? recent : scored
  return pool.slice(0, 10)
}

type GithubRepo = {
  html_url: string
  full_name: string
  description: string | null
  created_at: string
  pushed_at: string
  stargazers_count: number
  fork?: boolean
}

async function searchGithub(query: string): Promise<GithubRepo[]> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=12`
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const data = (await response.json()) as { items?: GithubRepo[] }
  return data.items ?? []
}

function repoCandidate(repo: GithubRepo): Candidate | null {
  if (repo.fork) return null
  const title = repo.full_name
  const desc = repo.description ?? ''
  if (!AI_KEYWORD.test(`${title} ${desc}`) && !/llm|agent|inference|transformer/i.test(title)) return null
  return withExtra(
    {
      id: idFor(repo.html_url, title),
      title,
      url: normalizeUrl(repo.html_url),
      source: 'GitHub',
      published_at: toIso(repo.pushed_at || repo.created_at),
      snippet: desc,
    },
    { tier: 2, stars: repo.stargazers_count, pushed_at: repo.pushed_at },
  )
}

async function collectGithub(): Promise<Candidate[]> {
  const created = daysAgoYmd(7)
  const pushed = daysAgoYmd(3)
  const queries = [
    `topic:llm stars:>5 created:>${created}`,
    `topic:llm stars:15..2500 pushed:>${pushed} created:>${daysAgoYmd(60)}`,
    `topic:ai-agents stars:15..2500 pushed:>${daysAgoYmd(7)} created:>${daysAgoYmd(90)}`,
  ]

  const settled = await Promise.allSettled(queries.map((query) => searchGithub(query)))
  const items: Candidate[] = []
  for (const result of settled) {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : result.reason
      console.warn('[github]', reason)
      continue
    }
    for (const repo of result.value) {
      const item = repoCandidate(repo)
      if (item) items.push(item)
    }
  }
  return items
}

function sourceTier(item: Candidate): number {
  const extra = Number(item.extra?.tier ?? 0)
  if (extra === 1 || extra === 2) return extra
  const source = item.source.toLowerCase()
  if (source.includes('huggingface papers') || source.includes('arxiv')) return 1
  if (source === 'github' || source === 'hacker news') return 2
  return 2
}

function scoreCandidate(item: Candidate): number {
  const points = Number(item.extra?.points ?? 0)
  const upvotes = Number(item.extra?.upvotes ?? 0)
  const stars = Number(item.extra?.stars ?? 0)
  const age = ageHours(item.published_at)
  const blob = `${item.title} ${item.snippet}`
  const bucket = bucketOf(item)
  const tier = sourceTier(item)

  let score = tier === 1 ? 2 : 1
  if (tier === 1 && bucket === 'news') score += 4
  if (age <= 18) score += 4
  else if (age <= 36) score += 2
  else if (age <= 72) score += 1

  if (points >= 200) score += 3
  else if (points >= 50) score += 2
  else if (points >= 20) score += 1

  if (upvotes >= 40) score += 3
  else if (upvotes >= 12) score += 2
  else if (upvotes >= 4) score += 1

  if (stars >= 200 && stars < 8000) score += 2
  else if (stars >= 40) score += 1

  if (HYPE.test(blob)) score -= 2
  if (SKIP_TITLE.test(item.title)) score -= 4
  return score
}

function bucketOf(item: Candidate): 'paper' | 'repo' | 'hn' | 'news' {
  const source = item.source.toLowerCase()
  if (source.includes('arxiv') || source.includes('papers')) return 'paper'
  if (source === 'github') return 'repo'
  if (source === 'hacker news') return 'hn'
  return 'news'
}

function rankCandidates(items: Candidate[]): Candidate[] {
  const scored = items.map((item) => {
    const score = scoreCandidate(item)
    return withExtra(item, { score, tier: sourceTier(item) })
  })
  scored.sort((a, b) => {
    const diff = Number(b.extra?.score ?? 0) - Number(a.extra?.score ?? 0)
    if (diff !== 0) return diff
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  })

  const take = (bucket: ReturnType<typeof bucketOf>, n: number) =>
    scored.filter((item) => bucketOf(item) === bucket).slice(0, n)

  const picked = [...take('news', 28), ...take('hn', 14), ...take('paper', 10), ...take('repo', 8)]
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const item of picked.sort((a, b) => Number(b.extra?.score ?? 0) - Number(a.extra?.score ?? 0))) {
    const key = normalizeUrl(item.url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= MAX_CANDIDATES) break
  }
  return out
}

function dedupe(items: Candidate[]): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const item of items) {
    const key = normalizeUrl(item.url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ ...item, url: key })
  }
  return out
}

export async function collectCandidates(): Promise<Candidate[]> {
  const settled = await Promise.allSettled([
    collectRss(),
    collectOfficialPages(),
    collectHn(),
    collectPapers(),
    collectGithub(),
  ])
  const labels = ['rss', 'official', 'hn', 'papers', 'github'] as const
  const merged: Candidate[] = []

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      merged.push(...result.value)
      console.log(`[collect] ${labels[index]}: ${result.value.length}`)
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : result.reason
      console.warn(`[collect] ${labels[index]} failed:`, reason)
    }
  })

  const ranked = rankCandidates(dedupe(merged))
  console.log(`[collect] ranked ${ranked.length} / ${merged.length}`)
  return ranked
}

export function writeCandidatesCache(date: string, items: Candidate[]): string {
  const dir = join(process.cwd(), 'cache')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `candidates-${date}.json`)
  writeFileSync(file, `${JSON.stringify(items, null, 2)}\n`)
  return file
}

async function main() {
  const date = kstToday()
  const items = await collectCandidates()
  const file = writeCandidatesCache(date, items)
  console.log(`wrote ${items.length} candidates → ${file}`)
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
