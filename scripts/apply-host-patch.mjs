import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/apply-host-patch.mjs
const target = process.argv[2]
if (!target) throw new Error('用法: node scripts/apply-host-patch.mjs /path/to/folia-major')
const cwd = resolve(target)
const version = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')).version
if (version !== '0.7.9') throw new Error(`仅适配 Folia 0.7.9，当前为 ${version}`)
const patch = resolve(dirname(fileURLToPath(import.meta.url)), '../host-patch/folia-0.7.9.patch')
try {
  execFileSync('git', ['apply', '--check', patch], { cwd, stdio: 'pipe' })
} catch {
  throw new Error(
    '补丁无法干净应用：可能已经安装、源码有改动或版本不匹配。请检查 git diff；脚本未修改任何文件。',
  )
}
execFileSync('git', ['apply', patch], { cwd, stdio: 'inherit' })
console.log('已应用 playback.sessions 接口重构。请在 Folia 目录安装依赖并运行/构建桌面版。')
