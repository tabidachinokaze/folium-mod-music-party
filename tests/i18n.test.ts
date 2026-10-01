import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocale, setLocale, t } from '../src/client/i18n'
import { enPickers } from '../src/client/locales/en-pickers'
import { enPrivate } from '../src/client/locales/en-private'
import { enRoom } from '../src/client/locales/en-room'
import { enRuntime } from '../src/client/locales/en-runtime'
import { enErrors } from '../src/client/locales/en-errors'

// tests/i18n.test.ts
const english = { ...enErrors, ...enRuntime, ...enRoom, ...enPrivate, ...enPickers }
afterEach(() => {
  vi.unstubAllGlobals()
  setLocale('zh-CN')
})

describe('host locale translation', () => {
  it.each([
    ['zh', 'zh-CN', '切换歌曲'],
    ['zh-CN', 'zh-CN', '切换歌曲'],
    ['zh-TW', 'zh-CN', '切换歌曲'],
    ['en', 'en', 'Change song'],
    ['en-US', 'en', 'Change song'],
  ])('normalizes %s without changing source labels in Chinese', (locale, expected, label) => {
    setLocale(locale)
    expect(getLocale()).toBe(expected)
    expect(t('切换歌曲')).toBe(label)
  })

  it('follows a live host document language before the saved mount fallback', () => {
    const doc = { documentElement: { lang: 'en-US' } }
    vi.stubGlobal('document', doc)
    setLocale('zh-CN')
    expect(t('表情包')).toBe('Stickers')
    doc.documentElement.lang = 'zh-TW'
    expect(t('表情包')).toBe('表情包')
    doc.documentElement.lang = ''
    setLocale('en')
    expect(t('表情包')).toBe('Stickers')
  })

  it('fills translated parameters while preserving song and member content literally', () => {
    setLocale('en-US')
    expect(t('选择 {title} · {artist}', { title: '黄金数 {count}', artist: '<b>用户</b>' })).toBe(
      'Choose 黄金数 {count} · <b>用户</b>',
    )
    expect(t('删除 ({count})', { count: 0 })).toBe('Delete (0)')
    setLocale('zh-CN')
    expect(t('删除 ({count})', { count: 3 })).toBe('删除 (3)')
  })

  it('leaves unknown user strings and unspecified parameters intact', () => {
    setLocale('en')
    for (const content of [
      'tabidachinokaze',
      '世萌沾坏',
      '黄金数',
      '@晚风 😀',
      'custom {name}',
      'constructor',
      '__proto__',
      'toString',
    ])
      expect(t(content)).toBe(content)
    expect(t('选择 {title}')).toBe('Choose {title}')
    expect(t('unrecognized {constructor}')).toBe('unrecognized {constructor}')
  })
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('English dictionary coverage', () => {
  it('covers literal calls to the imported translator, without treating protocol text as UI', () => {
    const directory = fileURLToPath(new URL('../src/client/', import.meta.url))
    const missing: string[] = []
    let translatedFiles = 0
    for (const path of sourceFiles(directory)) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      const names = new Set<string>()
      for (const node of source.statements) {
        if (
          !ts.isImportDeclaration(node) ||
          !ts.isStringLiteral(node.moduleSpecifier) ||
          !/\/i18n(?:\.ts)?$/.test(node.moduleSpecifier.text)
        )
          continue
        const imports = node.importClause?.namedBindings
        if (imports && ts.isNamedImports(imports))
          for (const item of imports.elements)
            if ((item.propertyName ?? item.name).text === 't') names.add(item.name.text)
      }
      if (!names.size) continue
      translatedFiles++
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          names.has(node.expression.text)
        ) {
          const key = node.arguments[0]
          if (
            key &&
            (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
            !Object.hasOwn(english, key.text)
          ) {
            const { line } = source.getLineAndCharacterOfPosition(key.getStart(source))
            missing.push(`${path.slice(directory.length)}:${line + 1}: ${key.text}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(translatedFiles).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it('preserves all parameter names in every nonempty English translation', () => {
    const keys = (value: string) =>
      [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort()
    const broken = Object.entries(english).filter(
      ([source, target]) =>
        !target.trim() || JSON.stringify(keys(source)) !== JSON.stringify(keys(target)),
    )
    expect(broken).toEqual([])
  })
})
