import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editionSchema, type Edition } from './schema'

export function editionsDir(): string {
  return join(process.cwd(), 'editions')
}

export function listEditionDates(): string[] {
  const dir = editionsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
    .reverse()
}

export function loadEdition(date: string): Edition {
  const raw = readFileSync(join(editionsDir(), `${date}.json`), 'utf8')
  return editionSchema.parse(JSON.parse(raw))
}

export function loadLatestEdition(): Edition | null {
  const dates = listEditionDates()
  if (dates.length === 0) return null
  return loadEdition(dates[0]!)
}

export function kstToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function loadTodayOrLatest(): Edition | null {
  const today = kstToday()
  const dates = listEditionDates()
  if (dates.includes(today)) return loadEdition(today)
  if (dates.length === 0) return null
  return loadEdition(dates[0]!)
}
