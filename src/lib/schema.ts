import { z } from 'zod'

export const kinds = [
  'announcement',
  'paper',
  'release',
  'repo',
  'analysis',
  'rumor',
] as const

export type Kind = (typeof kinds)[number]

export const alsoSeeSchema = z.object({
  title: z.string(),
  url: z.string().url(),
})

export const briefItemSchema = z.object({
  headline: z.string().min(1),
  lede: z.string().min(1),
  why_now: z.string().min(1),
  kind: z.enum(kinds),
  source_name: z.string().min(1),
  canonical_url: z.string().url(),
  published_at: z.string().min(1),
})

export const heroSchema = briefItemSchema.extend({
  body: z.string().min(1),
  also_see: z.array(alsoSeeSchema).optional().default([]),
})

export const editionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.literal('Asia/Seoul'),
  reading_minutes: z.number().int().min(1).max(15),
  one_liner: z.string().min(1),
  quiet_night: z.boolean(),
  hero: heroSchema.nullable(),
  overnight: z.array(briefItemSchema).max(7),
  tools: z.array(briefItemSchema).max(5),
  papers: z.array(briefItemSchema).max(3),
  github: z.array(briefItemSchema).max(3),
  if_time: briefItemSchema.nullable(),
})

export type AlsoSee = z.infer<typeof alsoSeeSchema>
export type BriefItem = z.infer<typeof briefItemSchema>
export type HeroItem = z.infer<typeof heroSchema>
export type Edition = z.infer<typeof editionSchema>

export type Candidate = {
  id: string
  title: string
  url: string
  source: string
  published_at: string
  snippet: string
  extra?: Record<string, string | number>
}
