import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCli } from './is-cli'
import { z } from 'zod'
import { kstToday } from '../src/lib/editions'
import { clampReadingMinutes } from '../src/lib/reading'
import {
  briefItemSchema,
  editionSchema,
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
    '- id, title, url, source, published_at, snippet, extra (stars, points, authors 등)',
    '',
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

function guessKind(candidate: Candidate): Kind {
  const source = candidate.source.toLowerCase()
  if (source.includes('arxiv')) return 'paper'
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

export function fallbackEdition(date: string, candidates: Candidate[]): Edition {
  const papers = candidates.filter((c) => c.source.toLowerCase().includes('arxiv'))
  const repos = candidates.filter((c) => c.source.toLowerCase() === 'github')
  const rest = candidates.filter(
    (c) => !c.source.toLowerCase().includes('arxiv') && c.source.toLowerCase() !== 'github',
  )

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
    one_liner: '요약 모델에 실패해 원문 제목만 모았습니다.',
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

async function completeChat(system: string, user: string): Promise<string> {
  const key = process.env.LLM_API_KEY
  if (!key) throw new Error('LLM_API_KEY missing')

  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.LLM_MODEL || 'gpt-4o-mini'
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`LLM ${response.status}: ${body.slice(0, 400)}`)
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM returned empty content')
  return content
}

export async function editEdition(date: string, candidates: Candidate[]): Promise<Edition> {
  const system = loadSystemPrompt()
  let user = buildUserMessage(date, candidates)
  const key = process.env.LLM_API_KEY

  if (!key) {
    console.warn('[edit] no LLM_API_KEY, using fallback')
    return fallbackEdition(date, candidates)
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await completeChat(system, user)
      const json = parseJsonObject(content)
      const parsed = llmEditionSchema.parse(json)
      return finalizeEdition(date, parsed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[edit] attempt ${attempt + 1} failed:`, message)
      user += `\n\n이전 출력이 스키마 검증에 실패했다. JSON 객체만, 스키마를 지켜서 다시 출력하라. 오류: ${message}`
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
