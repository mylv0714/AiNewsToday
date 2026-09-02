import type { Edition } from './schema'

function collectText(edition: Edition): string {
  const itemText = (item: {
    headline: string
    lede: string
    why_now: string
    body?: string
  }) => [item.headline, item.lede, item.why_now, item.body ?? ''].join('')

  return [
    edition.one_liner,
    edition.hero ? itemText(edition.hero) : '',
    ...edition.overnight.map(itemText),
    ...edition.tools.map(itemText),
    ...edition.papers.map(itemText),
    ...edition.github.map(itemText),
    edition.if_time ? itemText(edition.if_time) : '',
  ].join('')
}

export function estimateReadingMinutes(edition: Edition): number {
  const chars = collectText(edition).length
  const minutes = Math.round(chars / 380)
  return Math.min(15, Math.max(8, minutes || 8))
}

export function clampReadingMinutes(value: number | undefined, edition: Edition): number {
  if (value == null || value < 8 || value > 15) return estimateReadingMinutes(edition)
  return value
}
