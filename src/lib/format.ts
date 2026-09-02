const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

export function formatKoreanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(year!, month! - 1, day!))
  const weekday = WEEKDAYS[utc.getUTCDay()]
  return `${year}년 ${month}월 ${day}일 ${weekday}`
}

export function formatTitleDate(isoDate: string): string {
  return isoDate.replaceAll('-', '.')
}

export function papersHeading(count: number): string {
  if (count <= 0) return '논문'
  if (count === 1) return '논문 한 편'
  if (count === 2) return '논문 두 편'
  return '논문 세 편'
}

export const kindLabel: Record<string, string> = {
  announcement: '발표',
  paper: '논문',
  release: '출시',
  repo: '저장소',
  analysis: '해석',
  rumor: '루머',
}

function kstParts(iso: string): { y: number; m: number; d: number; hh: string; mm: string } {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    y: Number(pick('year')),
    m: Number(pick('month')),
    d: Number(pick('day')),
    hh: pick('hour').padStart(2, '0'),
    mm: pick('minute').padStart(2, '0'),
  }
}

export function formatPublished(iso: string, editionDate: string): string {
  const published = kstParts(iso)
  const [ey, em, ed] = editionDate.split('-').map(Number)
  const pubValue = published.y * 10_000 + published.m * 100 + published.d
  const editionValue = ey! * 10_000 + em! * 100 + ed!
  const clock = `${published.hh}:${published.mm}`

  if (pubValue === editionValue) return `오늘 ${clock}`
  if (pubValue === editionValue - 1) return `어제 ${clock}`
  return `${published.m}월 ${published.d}일 ${clock}`
}

export function withBase(path: string, base: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = path.replace(/^\//, '')
  return `${normalizedBase}${normalizedPath}`
}
