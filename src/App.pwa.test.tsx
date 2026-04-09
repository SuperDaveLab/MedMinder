// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { medMinderDb } from './storage/database'

interface BeforeInstallPromptLike extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

async function clearDatabase(): Promise<void> {
  await medMinderDb.transaction(
    'rw',
    medMinderDb.patients,
    medMinderDb.medications,
    medMinderDb.doseEvents,
    medMinderDb.appSettings,
    async () => {
      await medMinderDb.patients.clear()
      await medMinderDb.medications.clear()
      await medMinderDb.doseEvents.clear()
      await medMinderDb.appSettings.clear()
    },
  )
}

describe('App PWA polish behavior', () => {
  beforeEach(async () => {
    await clearDatabase()
    window.history.replaceState({}, '', '/')

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    vi.stubGlobal(
      'Notification',
      class MockNotification {
        static permission: NotificationPermission = 'denied'
        static requestPermission = vi
          .fn<() => Promise<NotificationPermission>>()
          .mockResolvedValue('denied')

        constructor() {}
      } as unknown as typeof Notification,
    )

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)' ? false : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('handles install prompt availability and installed state updates', async () => {
    const user = userEvent.setup()

    const promptSpy = vi.fn<() => Promise<void>>().mockResolvedValue()
    const installEvent = new Event('beforeinstallprompt') as BeforeInstallPromptLike
    installEvent.prompt = promptSpy
    installEvent.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-more'))

    window.dispatchEvent(installEvent)

    const installButton = await screen.findByTestId('install-app-button')
    expect(installButton).toBeTruthy()
    expect(screen.getByText('Install is available for quick launch.')).toBeTruthy()

    await user.click(installButton)

    await waitFor(() => {
      expect(promptSpy).toHaveBeenCalledTimes(1)
    })

    window.dispatchEvent(new Event('appinstalled'))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Install app' })).toBeNull()
      expect(screen.queryByTestId('install-app-button')).toBeNull()
    })
  })

  it('hides due alerts and install cards when actions are unavailable', async () => {
    const user = userEvent.setup()

    ;(Notification as unknown as { permission: NotificationPermission }).permission = 'granted'

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-more'))

    expect(screen.queryByRole('heading', { name: 'Due alerts' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Notifications enabled' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Install app' })).toBeNull()
    expect(screen.queryByTestId('install-app-button')).toBeNull()
  })

  it('handles wake lock supported and unsupported states', async () => {
    const user = userEvent.setup()
    const requestSpy = vi.fn().mockResolvedValue({
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    })

    Object.defineProperty(window.navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: requestSpy,
      },
    })

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-more'))

    await user.click(screen.getByTestId('wake-lock-button'))

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalledWith('screen')
      expect(screen.getByText('Screen wake lock is on.')).toBeTruthy()
    })
  })

  it('falls back to download when sharing summary is not supported', async () => {
    const user = userEvent.setup()

    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: undefined,
    })

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:summary')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })

    await user.click(screen.getByTestId('tab-meds'))
    await user.click(screen.getByTestId('share-summary-button'))

    await waitFor(() => {
      expect(createObjectURLSpy).toHaveBeenCalled()
      expect(revokeObjectURLSpy).toHaveBeenCalled()
    })
  })
})
