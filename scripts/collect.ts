import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCli } from './is-cli'
import Parser from 'rss-parser'
import { feeds } from '../src/data/feeds'
import { kstToday } from '../src/lib/editions'
import type { Candidate } from '../src/lib/schema'

const UA = 'MorningBrief/1.0 (personal digest; +https://github.com)'
const parser = new Parser({ timeout: 12_000 })

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

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json',
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return response.text()
}

async function collectRss(): Promise<Candidate[]> {
  const items: Candidate[] = []
  for (const feed of feeds) {
    try {
      const xml = await fetchText(feed.url)
      const parsed = await parser.parseString(xml)
      for (const entry of parsed.items.slice(0, 12)) {
        const url = entry.link
        const title = entry.title?.trim()
        if (!url || !title) continue
        items.push({
          id: idFor(url, title),
          title,
          url: normalizeUrl(url),
          source: feed.name,
          published_at: toIso(entry.isoDate ?? entry.pubDate),
          snippet: snippetOf(entry.contentSnippet ?? entry.content),
        })
      }
    } catch (error) {
      console.warn(`[rss] ${feed.name}:`, error instanceof Error ? error.message : error)
    }
  }
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

async function collectHn(): Promise<Candidate[]> {
  const url =
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=80` +
    `&numericFilters=created_at_i>${hoursAgoUnix(24)}`
  const raw = await fetchText(url)
  const data = JSON.parse(raw) as { hits?: AlgoliaHit[] }
  const keyword =
    /\b(ai|llm|llms|gpt|claude|gemini|openai|anthropic|deepmind|huggingface|hugging face|machine learning|open source|opensource|neural|transformer)s?\b/i
  return (data.hits ?? [])
    .filter((hit) => {
      const title = hit.title ?? ''
      return title.length > 0 && (hit.points ?? 0) >= 2 && keyword.test(title)
    })
    .map((hit) => {
      const link = hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`
      const title = hit.title ?? 'Untitled'
      return {
        id: idFor(link, title),
        title,
        url: normalizeUrl(link),
        source: 'Hacker News',
        published_at: toIso(hit.created_at),
        snippet: `HN ${hit.points} points, ${hit.num_comments} comments`,
        extra: { points: hit.points, comments: hit.num_comments },
      }
    })
}

async function collectArxiv(): Promise<Candidate[]> {
  const url =
    'https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL' +
    '&start=0&max_results=25&sortBy=submittedDate&sortOrder=descending'
  const xml = await fetchText(url)
  const parsed = await parser.parseString(xml)
  return parsed.items
    .map((entry) => {
      const link = entry.link ?? ''
      const title = (entry.title ?? '').replace(/\s+/g, ' ').trim()
      const authors = Array.isArray(entry.creator) ? entry.creator.join(', ') : (entry.creator ?? '')
      return {
        id: idFor(link, title),
        title,
        url: normalizeUrl(link),
        source: 'arXiv',
        published_at: toIso(entry.isoDate ?? entry.pubDate),
        snippet: snippetOf(entry.contentSnippet ?? entry.content, 360),
        extra: authors ? { authors } : undefined,
      }
    })
    .filter((item) => item.title && item.url)
}

type GithubRepo = {
  html_url: string
  full_name: string
  description: string | null
  created_at: string
  pushed_at: string
  stargazers_count: number
}

async function collectGithub(): Promise<Candidate[]> {
  const since = daysAgoYmd(7)
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:llm created:>${since}`)}&sort=stars&order=desc&per_page=15`
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
  return (data.items ?? []).map((repo) => ({
    id: idFor(repo.html_url, repo.full_name),
    title: repo.full_name,
    url: normalizeUrl(repo.html_url),
    source: 'GitHub',
    published_at: toIso(repo.created_at),
    snippet: repo.description ?? '',
    extra: { stars: repo.stargazers_count, pushed_at: repo.pushed_at },
  }))
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
  const settled = await Promise.allSettled([collectRss(), collectHn(), collectArxiv(), collectGithub()])
  const labels = ['rss', 'hn', 'arxiv', 'github'] as const
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

  return dedupe(merged)
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
