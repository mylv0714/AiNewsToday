import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCli } from './is-cli'
import { z } from 'zod'
import { kstToday } from '../src/lib/editions'
import { clampReadingMinutes } from '../src/lib/reading'
import {
  briefItemSchema,
  editionSchema,
  kinds,
  type BriefItem,
  type Candidate,
  type Edition,
  type HeroItem,
  type Kind,
} from '../src/lib/schema'

const llmItemSchema = briefItemSchema.extend({
  canonical_url: z.string().url(),
})

const llmEditionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().optional(),
  reading_minutes: z.number().int().min(1).max(30).optional(),
  one_liner: z.string().min(1),
  quiet_night: z.boolean().optional(),
  hero: llmItemSchema
    .extend({
      body: z.string().min(1),
      also_see: z
        .array(z.object({ title: z.string(), url: z.string().url() }))
        .optional()
        .default([]),
    })
    .nullable(),
  overnight: z.array(llmItemSchema).default([]),
  tools: z.array(llmItemSchema).default([]),
  papers: z.array(llmItemSchema).default([]),
  github: z.array(llmItemSchema).default([]),
  if_time: llmItemSchema.nullable().optional().default(null),
})

function loadSystemPrompt(): string {
  const md = readFileSync(join(process.cwd(), 'prompts', 'MORNING_EDITOR.md'), 'utf8')
  const start = md.indexOf('## System')
  const end = md.indexOf('## User message 템플릿')
  if (start < 0 || end < 0) throw new Error('MORNING_EDITOR.md is missing System/User sections')
  return md.slice(start, end).trim()
}

function buildUserMessage(date: string, items: Candidate[]): string {
  return [
    `오늘 날짜: ${date} (KST)`,
    `생성 시각: ${new Date().toISOString()}`,
    '',
    '후보 목록 (JSON):',
    JSON.stringify(items, null, 2),
    '',
    '각 후보 필드:',
    '- id, title, url, source, published_at, snippet, extra (score, tier, stars, points, upvotes, authors 등)',
    '',
    '후보는 이미 품질 점수 순이다. 위쪽을 우선하되, 같은 사건은 하나로 묶고 아래쪽 노이즈는 버려라.',
    '규칙: 후보에 없는 사실을 창작하지 말 것. 필요 없으면 버려도 된다.',
    '출력: 스키마를 만족하는 JSON 객체 하나.',
  ].join('\n')
}

function parseJsonObject(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(stripped)
  } catch {
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1))
    throw new Error('model did not return JSON')
  }
}

function isPaperSource(source: string): boolean {
  const lower = source.toLowerCase()
  return lower.includes('arxiv') || lower.includes('papers')
}

function guessKind(candidate: Candidate): Kind {
  const source = candidate.source.toLowerCase()
  if (isPaperSource(source)) return 'paper'
  if (source === 'github') return 'repo'
  const blob = `${candidate.title} ${candidate.snippet}`.toLowerCase()
  if (blob.includes('release') || blob.includes('릴리스')) return 'release'
  return 'announcement'
}

function asItem(candidate: Candidate, kind: Kind): BriefItem | null {
  try {
    return briefItemSchema.parse({
      headline: candidate.title.slice(0, 40),
      lede: (candidate.snippet || candidate.title).slice(0, 180),
      why_now: '요약 모델 없이 원문을 그대로 올렸다.',
      kind,
      source_name: candidate.source,
      canonical_url: candidate.url,
      published_at: candidate.published_at,
    })
  } catch {
    return null
  }
}

export const FALLBACK_ONE_LINER = '요약 모델에 실패해 원문 제목만 모았습니다.'

export function isFallbackEdition(edition: Pick<Edition, 'one_liner'>): boolean {
  return edition.one_liner === FALLBACK_ONE_LINER
}

export function fallbackEdition(date: string, candidates: Candidate[]): Edition {
  const papers = candidates.filter((c) => isPaperSource(c.source))
  const repos = candidates.filter((c) => c.source.toLowerCase() === 'github')
  const rest = candidates.filter((c) => !isPaperSource(c.source) && c.source.toLowerCase() !== 'github')

  const overnight = rest
    .slice(0, 8)
    .map((c) => asItem(c, guessKind(c)))
    .filter((item): item is BriefItem => item !== null)
    .slice(0, 7)

  const first = overnight.shift() ?? null
  const hero: HeroItem | null = first
    ? {
        ...first,
        body: first.lede,
        also_see: [],
      }
    : null

  const draft: Edition = {
    date,
    timezone: 'Asia/Seoul',
    reading_minutes: 8,
    one_liner: FALLBACK_ONE_LINER,
    quiet_night: hero == null,
    hero,
    overnight,
    tools: rest
      .slice(8, 13)
      .map((c) => asItem(c, 'release'))
      .filter((item): item is BriefItem => item !== null)
      .slice(0, 5),
    papers: papers
      .map((c) => asItem(c, 'paper'))
      .filter((item): item is BriefItem => item !== null)
      .slice(0, 3),
    github: repos
      .map((c) => asItem(c, 'repo'))
      .filter((item): item is BriefItem => item !== null)
      .slice(0, 3),
    if_time: null,
  }

  return editionSchema.parse({
    ...draft,
    reading_minutes: clampReadingMinutes(undefined, draft),
  })
}

function finalizeEdition(date: string, parsed: z.infer<typeof llmEditionSchema>): Edition {
  const draft: Edition = {
    date,
    timezone: 'Asia/Seoul',
    reading_minutes: parsed.reading_minutes ?? 8,
    one_liner: parsed.one_liner,
    quiet_night: parsed.quiet_night ?? parsed.hero == null,
    hero: parsed.hero
      ? {
          ...parsed.hero,
          also_see: parsed.hero.also_see ?? [],
        }
      : null,
    overnight: parsed.overnight.slice(0, 7),
    tools: parsed.tools.slice(0, 5),
    papers: parsed.papers.slice(0, 3),
    github: parsed.github.slice(0, 3),
    if_time: parsed.if_time ?? null,
  }

  return editionSchema.parse({
    ...draft,
    reading_minutes: clampReadingMinutes(parsed.reading_minutes, draft),
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function completeChat(system: string, user: string, deadline: number): Promise<string> {
  const key = process.env.LLM_API_KEY
  if (!key) throw new Error('LLM_API_KEY missing')

  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')

  let lastError = 'LLM request failed'
  for (const model of llmModels()) {
    const payload = JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })

    for (let i = 0; i < TRIES_PER_MODEL; i++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new LlmUnavailableError(`budget exhausted, last: ${lastError}`)

      let response: Response
      try {
        response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: payload,
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
        })
      } catch (error) {
        // 네트워크 오류·타임아웃은 503과 같이 취급한다.
        lastError = `${model}: ${error instanceof Error ? error.message : String(error)}`
        await backoff(model, i, null, deadline, lastError)
        continue
      }

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: { message?: { content?: string }; finish_reason?: string }[]
        }
        const choice = data.choices?.[0]
        if (choice?.message?.content) return choice.message.content
        lastError = `${model}: empty content (finish_reason=${choice?.finish_reason ?? 'none'})`
        await backoff(model, i, null, deadline, lastError)
        continue
      }

      const body = await response.text()
      lastError = `${model} ${response.status}: ${body.slice(0, 400)}`
      if (response.status === 401 || response.status === 403) throw new LlmUnavailableError(lastError)
      if (!RETRYABLE_STATUS.has(response.status)) {
        // 400/404 등은 모델 이름 문제일 수 있으니 다음 모델로 넘어간다.
        console.warn(`[edit] ${lastError}`)
        break
      }
      await backoff(model, i, response.headers.get('retry-after'), deadline, lastError)
    }
    console.warn(`[edit] giving up on ${model}`)
  }

  throw new LlmUnavailableError(lastError)
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const REQUEST_TIMEOUT_MS = 180_000
const TRIES_PER_MODEL = 5
const DEFAULT_BUDGET_MS = 12 * 60_000

class LlmUnavailableError extends Error {}

function llmModels(): string[] {
  const primary = process.env.LLM_MODEL || 'gpt-4o-mini'
  const extra = (process.env.LLM_FALLBACK_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  return [...new Set([primary, ...extra])]
}

async function backoff(
  model: string,
  attempt: number,
  retryAfter: string | null,
  deadline: number,
  reason: string,
): Promise<void> {
  if (attempt >= TRIES_PER_MODEL - 1) return
  const header = Number(retryAfter)
  const wait =
    Number.isFinite(header) && header > 0
      ? Math.min(header * 1000, 120_000)
      : Math.min(10_000 * 2 ** attempt, 90_000) + Math.floor(Math.random() * 5_000)
  if (Date.now() + wait >= deadline) throw new LlmUnavailableError(`budget exhausted, last: ${reason}`)
  console.warn(`[edit] ${reason.slice(0, 120).replace(/\s+/g, ' ')} — retry ${model} in ${wait}ms`)
  await sleep(wait)
}

const sectionKinds = {
  hero: 'announcement',
  overnight: 'announcement',
  tools: 'release',
  papers: 'paper',
  github: 'repo',
  if_time: 'analysis',
} as const satisfies Record<string, Kind>

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function hostname(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

// 모델이 papers/github에서 title·url 같은 다른 필드명을 쓰거나 kind를 빼먹는 일이 잦다.
// 판 전체를 버리지 않도록 흔한 이탈은 고치고, 고칠 수 없는 항목만 떨군다.
function normalizeItem(
  raw: unknown,
  fallbackKind: Kind,
  byUrl: Map<string, Candidate>,
  date: string,
): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const item = raw as Record<string, unknown>
  const url = firstString(item.canonical_url, item.url, item.link)
  const candidate = url ? byUrl.get(url) : undefined
  return {
    ...item,
    headline: firstString(item.headline, item.title, candidate?.title),
    lede: firstString(item.lede, item.summary, item.description),
    why_now: firstString(item.why_now, item.why),
    kind: kinds.includes(item.kind as Kind) ? item.kind : fallbackKind,
    source_name: firstString(item.source_name, item.source, candidate?.source, hostname(url)),
    canonical_url: url,
    published_at: firstString(item.published_at, candidate?.published_at, date),
  }
}

function normalizeLlmEdition(json: unknown, candidates: Candidate[], date: string): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json
  const raw = json as Record<string, unknown>
  const byUrl = new Map(candidates.map((c) => [c.url, c]))
  const out: Record<string, unknown> = { ...raw }
  if (out.overnight == null && Array.isArray(raw.briefing)) out.overnight = raw.briefing

  for (const section of ['overnight', 'tools', 'papers', 'github'] as const) {
    if (!Array.isArray(out[section])) continue
    out[section] = (out[section] as unknown[]).flatMap((value, index) => {
      const result = llmItemSchema.safeParse(normalizeItem(value, sectionKinds[section], byUrl, date))
      if (result.success) return [result.data]
      const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ')
      console.warn(`[edit] drop ${section}[${index}]: ${fields}`)
      return []
    })
  }

  if (raw.hero && typeof raw.hero === 'object') {
    const hero = normalizeItem(raw.hero, sectionKinds.hero, byUrl, date) as Record<string, unknown>
    out.hero = { ...hero, body: firstString(hero.body, hero.lede) }
  }

  if (raw.if_time && typeof raw.if_time === 'object') {
    const result = llmItemSchema.safeParse(normalizeItem(raw.if_time, sectionKinds.if_time, byUrl, date))
    if (!result.success) console.warn('[edit] drop if_time')
    out.if_time = result.success ? result.data : null
  }

  return out
}

function llmBudgetMs(): number {
  const value = Number(process.env.LLM_BUDGET_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BUDGET_MS
}

export async function editEdition(date: string, candidates: Candidate[]): Promise<Edition> {
  const system = loadSystemPrompt()
  let user = buildUserMessage(date, candidates)
  const key = process.env.LLM_API_KEY

  if (!key) {
    console.warn('[edit] no LLM_API_KEY, using fallback')
    return fallbackEdition(date, candidates)
  }

  const deadline = Date.now() + llmBudgetMs()
  for (let attempt = 0; attempt < 3; attempt++) {
    let content: string
    try {
      content = await completeChat(system, user, deadline)
    } catch (error) {
      // completeChat이 이미 재시도·모델 전환을 다 했다. 같은 걸 또 부르지 않는다.
      console.warn('[edit] LLM unavailable:', error instanceof Error ? error.message : String(error))
      break
    }

    try {
      const parsed = llmEditionSchema.parse(normalizeLlmEdition(parseJsonObject(content), candidates, date))
      return finalizeEdition(date, parsed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[edit] attempt ${attempt + 1} failed schema:`, message.slice(0, 1500))
      user += `\n\n이전 출력이 스키마 검증에 실패했다. JSON 객체만, 스키마를 지켜서 다시 출력하라. 오류: ${message.slice(0, 1500)}`
    }
  }

  console.warn('[edit] falling back to raw titles')
  return fallbackEdition(date, candidates)
}

export function editionPath(date: string): string {
  return join(process.cwd(), 'editions', `${date}.json`)
}

export function writeEdition(edition: Edition, force: boolean): { path: string; wrote: boolean } {
  const file = editionPath(edition.date)
  if (existsSync(file) && !force) {
    console.log(`[edit] ${file} exists, skip (pass --force to overwrite)`)
    return { path: file, wrote: false }
  }
  mkdirSync(join(process.cwd(), 'editions'), { recursive: true })
  writeFileSync(file, `${JSON.stringify(edition, null, 2)}\n`)
  return { path: file, wrote: true }
}

async function main() {
  const force = process.argv.includes('--force')
  const date = kstToday()
  const cache = join(process.cwd(), 'cache', `candidates-${date}.json`)
  if (!existsSync(cache)) {
    throw new Error(`missing ${cache}. run npm run collect first`)
  }
  const candidates = JSON.parse(readFileSync(cache, 'utf8')) as Candidate[]
  if (existsSync(editionPath(date)) && !force) {
    console.log(`[edit] today's edition already frozen`)
    return
  }
  const edition = await editEdition(date, candidates)
  const result = writeEdition(edition, force)
  console.log(`${result.wrote ? 'wrote' : 'kept'} ${result.path}`)
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
