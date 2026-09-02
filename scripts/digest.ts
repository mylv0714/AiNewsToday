import 'dotenv/config'
import { isCli } from './is-cli'
import { kstToday } from '../src/lib/editions'
import { collectCandidates, writeCandidatesCache } from './collect'
import { editEdition, editionPath, writeEdition } from './edit'
import { existsSync } from 'node:fs'

async function main() {
  const force = process.argv.includes('--force')
  const date = kstToday()
  const file = editionPath(date)

  if (existsSync(file) && !force) {
    console.log(`[digest] ${file} already exists. skip (pass --force to rebuild)`)
    return
  }

  const candidates = await collectCandidates()
  writeCandidatesCache(date, candidates)
  console.log(`[digest] ${candidates.length} candidates`)

  const edition = await editEdition(date, candidates)
  const result = writeEdition(edition, force)
  console.log(`[digest] ${result.wrote ? 'wrote' : 'kept'} ${result.path}`)
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

export { main as digest }
