import { expect, type Page } from '@playwright/test'

// tests/browser/folia-recording.ts
// Verify the real remote window's recording commands without opening a desktop capture dialog.
export async function verifyRemoteRecording(remote: Page) {
  await remote.evaluate(() => {
    const w = window as any,
      original = w.electron.sendRemoteControlCommand
    w.partyRecordingCommands = []
    w.partyRecordingOriginalCommand = original
    w.electron.sendRemoteControlCommand = (command: any) => {
      if (['start-export', 'cancel-export'].includes(command.type)) {
        w.partyRecordingCommands.push(command)
        return Promise.resolve()
      }
      return original(command)
    }
  })
  try {
    await remote.getByTitle('视频导出', { exact: true }).click()
    await expect(remote.getByRole('button', { name: '整首歌', exact: true })).toHaveCount(0)
    await expect(remote.getByRole('button', { name: '下一首', exact: true })).toBeEnabled()
    await remote.getByRole('button', { name: '下一首', exact: true }).click()
    await remote.getByRole('button', { name: '等待下一首并录制', exact: true }).click()
    await expect
      .poll(() => remote.evaluate(() => (window as any).partyRecordingCommands.at(-1)?.startMode))
      .toBe('next')
    await remote.getByRole('button', { name: '从此', exact: true }).click()
    await remote.getByRole('button', { name: '开始录制', exact: true }).click()
    await expect
      .poll(() => remote.evaluate(() => (window as any).partyRecordingCommands.at(-1)?.startMode))
      .toBe('current')
    await remote.getByRole('button', { name: '下一首', exact: true }).click()
    await remote.evaluate(() => {
      ;(window as any).partyRecordingOverride = {
        status: 'waiting',
        presetId: 'landscape-preset-2',
        progress: 0,
        elapsed: 0,
        duration: 0,
        countdown: null,
        filePath: null,
        error: null,
      }
    })
    await expect(
      remote.getByText('正在等待房间下一首，开始后自动录制…', { exact: true }),
    ).toBeVisible()
    await expect(remote.getByRole('button', { name: '下一首', exact: true })).toBeDisabled()
    await expect(remote.getByRole('button', { name: '从此', exact: true })).toBeDisabled()
    await expect(remote.getByRole('button', { name: '停止并保存', exact: true })).toHaveCount(0)
    await expect(remote.getByText(/即将开始录制/)).toHaveCount(0)
    await remote.screenshot({ path: 'test-results/folia-remote-record-next.png' })
    await remote.getByRole('button', { name: '取消', exact: true }).click()
    await expect
      .poll(() => remote.evaluate(() => (window as any).partyRecordingCommands.at(-1)?.type))
      .toBe('cancel-export')
  } finally {
    await remote.evaluate(() => {
      const w = window as any
      delete w.partyRecordingOverride
      w.electron.sendRemoteControlCommand = w.partyRecordingOriginalCommand
      delete w.partyRecordingOriginalCommand
    })
    // Leaving the export page restores the existing playback/audition checks.
    await remote.locator('button:has(svg.lucide-chevron-left)').last().click()
  }
}
