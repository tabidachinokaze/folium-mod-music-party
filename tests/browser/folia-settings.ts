import { expect, type Page } from '@playwright/test'

// tests/browser/folia-settings.ts
// Mount the real settings renderer with Music Party's registered schema and param store.
export async function verifyNativeSettings(page: Page) {
  await page.evaluate(async () => {
    const load = (url: string) => import(/* @vite-ignore */ url)
    const [
      { default: React },
      { default: ReactDOM },
      { FoliumSettingsSections, settingsSectionsRegistry },
      { DEFAULT_THEME },
    ] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'),
      load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/mods/folium/registries/settingsSections.tsx'),
      load('/src/services/baseThemes.ts'),
    ])
    const entry = settingsSectionsRegistry.list().find((item: any) => item.modId === 'music-party')
    if (!entry) throw new Error('Missing Music Party settings registration')
    const container = document.createElement('div')
    container.dataset.testid = 'party-settings-probe'
    container.style.cssText =
      'position:fixed;inset:30px auto 30px 30px;width:min(680px,calc(100vw - 60px));overflow:auto;padding:24px;background:#171717;color:#eee;z-index:150;--text-primary:#eee;--text-secondary:#aaa;--overlay-medium:#ffffff0a;--border-color:#ffffff20'
    document.body.append(container)
    const root = ReactDOM.createRoot(container),
      original = entry.def.access.get()
    root.render(
      React.createElement(FoliumSettingsSections, {
        modId: 'music-party',
        theme: DEFAULT_THEME,
        isDaylight: false,
        language: 'zh-CN',
      }),
    )
    ;(window as any).partySettingsProbe = { root, container, access: entry.def.access, original }
  })
  const settings = page.getByTestId('party-settings-probe')
  try {
    await expect(settings.getByRole('heading', { name: '聊天设置', exact: true })).toBeVisible()
    await expect(settings.locator('select')).toHaveCount(0)
    await settings.getByRole('button', { name: '聊天位置', exact: true }).click()
    await expect(page.getByRole('option', { name: '左下角', exact: true })).toBeVisible()
    await page.getByRole('option', { name: '左下角', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => (window as any).partySettingsProbe.access.get().position))
      .toBe('bottom-left')
    const toggle = settings.getByRole('button', { name: '启用弹幕', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const duration = settings.getByRole('slider', { name: '新消息显示时长', exact: true })
    await duration.focus()
    await duration.press('Home')
    await duration.press('ArrowRight')
    await expect
      .poll(() => page.evaluate(() => (window as any).partySettingsProbe.access.get().peekSeconds))
      .toBe(2)
    await settings.screenshot({ path: 'test-results/folia-native-chat-settings.png' })
  } finally {
    await page.evaluate(() => {
      const probe = (window as any).partySettingsProbe
      probe.root.unmount()
      probe.access.set(probe.original)
      probe.container.remove()
      delete (window as any).partySettingsProbe
    })
  }
}
