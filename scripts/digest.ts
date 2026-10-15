import 'dotenv/config'
import { isCli } from './is-cli'
import { kstToday } from '../src/lib/editions'
import { collectCandidates, writeCandidatesCache } from './collect'
import { editEdition, editionPath, isFallbackEdition, writeEdition } from './edit'
import { existsSync, readFileSync } from 'node:fs'

async function main() {
  const force = process.argv.includes('--force')
  const date = kstToday()
  const file = editionPath(date)
  let retrying = false

  if (existsSync(file) && !force) {
    // 폴백 판은 확정된 판이 아니다. 다음 실행에서 요약을 다시 시도한다.
    if (!isFallbackEdition(JSON.parse(readFileSync(file, 'utf8')))) {
      console.log(`[digest] ${file} already exists. skip (pass --force to rebuild)`)
      return
    }
    console.log(`[digest] ${file} is a fallback edition. retrying summarization`)
    retrying = true
  }

  const candidates = await collectCandidates()
  writeCandidatesCache(date, candidates)
  console.log(`[digest] ${candidates.length} candidates`)

  const edition = await editEdition(date, candidates)
  if (retrying && isFallbackEdition(edition)) {
    console.log(`[digest] summarization failed again. keep ${file}`)
    return
  }
  const result = writeEdition(edition, force || retrying)
  console.log(`[digest] ${result.wrote ? 'wrote' : 'kept'} ${result.path}`)
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

export { main as digest }
