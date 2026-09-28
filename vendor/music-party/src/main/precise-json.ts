export function preciseMediaEndpoint(value: unknown): boolean {
  return typeof value === 'string' && /\/(?:eapi|api)\/(?:social\/emoji\/|nos\/token\/)/.test(value)
}
// These resource IDs exceed JS's integer range. Preserve the original JSON token, not a rounded Number.
export function parsePreciseJson(value: string): any {
  return JSON.parse(value, (_key, item, context?: { source?: string }) => {
    if (typeof item === 'number' && Number.isInteger(item) && !Number.isSafeInteger(item)) {
      if (!context?.source || !/^-?\d+$/.test(context.source))
        throw new Error('资源 ID 无法精确解析')
      return context.source
    }
    return item
  })
}
