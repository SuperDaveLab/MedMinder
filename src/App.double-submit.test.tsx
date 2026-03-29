// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { medMinderDb } from './storage/database'
import { loadPatientMedicationView } from './storage/repository'

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

describe('double-submit protection', () => {
  beforeEach(async () => {
    await clearDatabase()

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    vi.stubGlobal(
      'Notification',
      class MockNotification {
        static permission: NotificationPermission = 'denied'
        static requestPermission = vi
          .fn<() => Promise<NotificationPermission>>()
          .mockResolvedValue('denied')

        constructor(_title: string, _options?: NotificationOptions) {}
      } as unknown as typeof Notification,
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('double-clicking Give Dose persists only one new dose event', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const card = await screen.findByTestId('med-card-med-interval-1')
    const giveButton = within(card).getByRole('button', { name: 'Give Dose' })

    // Fire two clicks synchronously before React can process the first handler's
    // state update. This exercises the in-flight guard: if the guard uses only
    // React state, both calls will see isDoseActionInProgress===false and both
    // will proceed — writing two events instead of one.
    fireEvent.click(giveButton)
    fireEvent.click(giveButton)

    await waitFor(async () => {
      const { doseEvents } = await loadPatientMedicationView('patient-1')
      const events = doseEvents.filter((e) => e.medicationId === 'med-interval-1')
      // 1 seeded + exactly 1 new — not 1 seeded + 2 new
      expect(events.length).toBe(2)
    })
  })

  it('double-clicking Save correction persists only one correction event', async () => {
    const user = userEvent.setup()

    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const card = await screen.findByTestId('med-card-med-interval-1')

    // Open the correction form for the seeded dose event.
    await user.click(within(card).getByTestId('correct-dose-dose-seed-1'))
    await user.clear(within(card).getByLabelText('Replacement timestamp (local time)'))
    await user.type(
      within(card).getByLabelText('Replacement timestamp (local time)'),
      '2099-01-01T00:00',
    )

    const saveButton = within(card).getByRole('button', { name: 'Save correction' })

    // Fire two save clicks synchronously before the first handler's state update
    // disables the button — same race window as the Give Dose case above.
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    await waitFor(async () => {
      const { doseEvents } = await loadPatientMedicationView('patient-1')
      const corrections = doseEvents.filter((e) => e.corrected)
      // Exactly one correction — not two
      expect(corrections.length).toBe(1)
    })

    // Confirm dialog must have appeared exactly once: if the second click fires
    // saveCorrection before the disabled state reaches the DOM, confirm would be
    // called a second time without any data benefit (the guard in handleCorrectDose
    // would still block the write, but the user would see a spurious dialog).
    expect(window.confirm).toHaveBeenCalledTimes(1)
  })
})
