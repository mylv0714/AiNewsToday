import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

export function isCli(metaUrl: string): boolean {
  const self = basename(fileURLToPath(metaUrl))
  const argv = process.argv[1] ? basename(process.argv[1]) : ''
  return Boolean(argv) && self === argv
}
