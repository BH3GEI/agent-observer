// Assemble the public starter-kit downloads from ../starter_kit.
//   public/downloads/agent-observer-starter-kit.zip  (folder agent-observer-starter-kit/, no decisions.csv)
//   public/downloads/scorer.py, protocol.py, score_config.json
//   public/skill.md
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const kitDir = process.env.STARTER_KIT_DIR || resolve(root, '..', 'starter_kit')
const outDir = resolve(root, 'public', 'downloads')
const files = [
  'agent.py', 'local_runner.py', 'protocol.py', 'scorer.py', 'score_config.json',
  'generate_example_data.py', 'sac_submit.py', 'README.md', 'SKILL.md',
  'example/weather.csv', 'example/tiles.csv', 'example/score_config.json',
]

if (!existsSync(kitDir)) {
  console.warn(`[build-kit] starter kit not found at ${kitDir}; skipping download bundle.`)
  process.exit(0)
}
mkdirSync(outDir, { recursive: true })

const entries = {}
const mtime = new Date('2026-09-09T00:00:00Z')
for (const rel of files) {
  const abs = resolve(kitDir, rel)
  if (!existsSync(abs)) { console.warn(`[build-kit] missing ${rel}`); continue }
  entries[`agent-observer-starter-kit/${rel}`] = [readFileSync(abs), { mtime, level: 9 }]
}
const zip = zipSync(entries, { level: 9, mtime })
writeFileSync(resolve(outDir, 'agent-observer-starter-kit.zip'), zip)
for (const name of ['scorer.py', 'protocol.py', 'score_config.json']) copyFileSync(resolve(kitDir, name), resolve(outDir, name))
copyFileSync(resolve(kitDir, 'SKILL.md'), resolve(root, 'public', 'skill.md'))
console.log(`[build-kit] wrote ${Object.keys(entries).length} files into public/downloads/agent-observer-starter-kit.zip (${zip.length} bytes)`)
