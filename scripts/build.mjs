import { build } from 'esbuild'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { zipSync } from 'fflate'
import { createHash } from 'node:crypto'

// scripts/build.mjs
const target = new URL('../dist/music-party/', import.meta.url)
await mkdir(target, { recursive: true })
await Promise.all([
  build({
    entryPoints: ['src/main/index.cts'],
    outfile: 'dist/music-party/index.cjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    tsconfig: 'tsconfig.json',
  }),
  build({
    entryPoints: ['src/client/index.ts'],
    outfile: 'dist/music-party/client.mjs',
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    tsconfig: 'tsconfig.json',
    loader: { '.css': 'text' },
  }),
])
const manifest = JSON.parse(await readFile('mod.json', 'utf8'))
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
if (manifest.version !== pkg.version) throw new Error('package.json and mod.json versions differ')
const resources = [
  'mod.json',
  'README.md',
  'LICENSE',
  'NOTICES.md',
  'host-patch/folia-0.7.10.patch',
  'scripts/apply-host-patch.mjs',
]
for (const name of resources) {
  const destination = new URL(name, target)
  await mkdir(new URL('.', destination), { recursive: true })
  await copyFile(name, destination)
}
const files = {}
for (const name of [...resources, 'index.cjs', 'client.mjs']) {
  files[`music-party/${name}`] = new Uint8Array(await readFile(new URL(name, target)))
}
const archive = zipSync(files)
const filename = `folium-mod-music-party-${manifest.version}.zip`
await writeFile(`dist/${filename}`, archive)
await writeFile(
  'dist/SHA256SUMS',
  `${createHash('sha256').update(archive).digest('hex')}  ${filename}\n`,
)
console.log(`Built dist/folium-mod-music-party-${manifest.version}.zip`)
