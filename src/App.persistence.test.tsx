// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockClock = vi.hoisted(() => ({
  now: '2026-04-06T09:59:00.000Z',
}))

vi.mock('./ui/clock', () => ({
  getCurrentTime: () => new Date(mockClock.now),
}))

import App from './App'
import { nexpillDb } from './storage/database'
import {
  loadPatientMedicationView,
  saveReminderNotificationLog,
} from './storage/repository'

async function clearDatabase(): Promise<void> {
  await nexpillDb.transaction(
    'rw',
    nexpillDb.patients,
    nexpillDb.medications,
    nexpillDb.doseEvents,
    nexpillDb.appSettings,
    async () => {
      await nexpillDb.patients.clear()
      await nexpillDb.medications.clear()
      await nexpillDb.doseEvents.clear()
      await nexpillDb.appSettings.clear()
    },
  )
}

describe('App persistence flow', () => {
  beforeEach(async () => {
    mockClock.now = '2026-04-06T09:59:00.000Z'

    await clearDatabase()

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    if (!globalThis.crypto.randomUUID) {
      vi.stubGlobal('crypto', {
        ...globalThis.crypto,
        randomUUID: () => '00000000-0000-4000-8000-000000000001',
      })
    } else {
      vi
        .spyOn(globalThis.crypto, 'randomUUID')
        .mockReturnValue('00000000-0000-4000-8000-000000000001')
    }

    vi.stubGlobal(
      'Notification',
      class MockNotification {
        static permission: NotificationPermission = 'granted'
        static requestPermission = vi
          .fn<() => Promise<NotificationPermission>>()
          .mockResolvedValue('granted')
        static instances: Array<{ title: string; options?: NotificationOptions }> = []

        constructor(title: string, options?: NotificationOptions) {
          MockNotification.instances.push({ title, options })
        }
      } as unknown as typeof Notification,
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('logs a dose, persists it, and renders per-medication recent history after reload', async () => {
    const user = userEvent.setup()

    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const medicationCard = await screen.findByTestId('med-card-med-interval-1')

    const initialHistory = within(medicationCard).getByTestId('med-history-med-interval-1')
    expect(within(initialHistory).getAllByRole('listitem').length).toBe(1)

    await user.click(within(medicationCard).getByRole('button', { name: 'Give Dose' }))

    await waitFor(async () => {
      const { doseEvents } = await loadPatientMedicationView('patient-1')
      const matchingDoseEvents = doseEvents.filter(
        (doseEvent) => doseEvent.medicationId === 'med-interval-1',
      )
      expect(matchingDoseEvents.length).toBe(2)
    })

    await waitFor(() => {
      const refreshedCard = screen.getByTestId('med-card-med-interval-1')
      const updatedHistory = within(refreshedCard).getByTestId('med-history-med-interval-1')
      expect(within(updatedHistory).getAllByRole('listitem').length).toBe(2)
    })

    cleanup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const reloadedCard = await screen.findByTestId('med-card-med-interval-1')
    const reloadedHistory = within(reloadedCard).getByTestId('med-history-med-interval-1')

    expect(within(reloadedHistory).getAllByRole('listitem').length).toBe(2)
  })

  it('creates a correction event, supersedes original dose, and updates medication status', async () => {
    const user = userEvent.setup()

    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const medicationCard = await screen.findByTestId('med-card-med-interval-1')

    expect(within(medicationCard).getByText(/Overdue by|Missed by/)).toBeTruthy()

    await user.click(within(medicationCard).getByTestId('correct-dose-dose-seed-1'))
    await user.clear(within(medicationCard).getByLabelText('Replacement timestamp (local time)'))
    await user.type(
      within(medicationCard).getByLabelText('Replacement timestamp (local time)'),
      '2099-01-01T00:00',
    )
    await user.type(
      within(medicationCard).getByLabelText('Notes (optional)'),
      'Correction test note',
    )
    await user.click(within(medicationCard).getByRole('button', { name: 'Save correction' }))

    expect(window.confirm).toHaveBeenCalledTimes(1)

    await waitFor(async () => {
      const { doseEvents } = await loadPatientMedicationView('patient-1')
      const originalDoseEvent = doseEvents.find((doseEvent) => doseEvent.id === 'dose-seed-1')
      const correctionDoseEvent = doseEvents.find((doseEvent) => doseEvent.corrected)

      expect(originalDoseEvent).toBeTruthy()
      expect(originalDoseEvent?.corrected).toBe(false)
      expect(correctionDoseEvent?.supersedesDoseEventId).toBe('dose-seed-1')
      expect(correctionDoseEvent?.notes).toBe('Correction test note')
    })

    await waitFor(() => {
      // The correction entry is visible in the Care card with its tag
      expect(screen.getByTestId('entry-tag-corrected-00000000-0000-4000-8000-000000000001')).toBeTruthy()
      // The superseded original is hidden from the Care card (only shown in History)
      expect(screen.queryByTestId('entry-tag-superseded-dose-seed-1')).toBeNull()
    })

    await waitFor(() => {
      expect(within(medicationCard).getByText(/Too early by|Next due/)).toBeTruthy()
    })
  })

  it('deletes a dose entry from care history when clicked by mistake', async () => {
    const user = userEvent.setup()
    let newlyLoggedDoseEventId: string | null = null

    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const medicationCard = await screen.findByTestId('med-card-med-interval-1')

    await user.click(within(medicationCard).getByRole('button', { name: 'Give Dose' }))

    await waitFor(async () => {
      const { doseEvents } = await loadPatientMedicationView('patient-1')
      const matchingDoseEvents = doseEvents.filter(
        (doseEvent) => doseEvent.medicationId === 'med-interval-1',
      )
      expect(matchingDoseEvents.length).toBe(2)
      newlyLoggedDoseEventId = matchingDoseEvents.find((doseEvent) => doseEvent.id !== 'dose-seed-1')?.id ?? null
      expect(newlyLoggedDoseEventId).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.getByTestId(`dose-entry-${newlyLoggedDoseEventId}`)).toBeTruthy()
    })

    const loggedDoseEntry = screen.getByTestId(`dose-entry-${newlyLoggedDoseEventId}`)
    await user.click(within(loggedDoseEntry).getByRole('button', { name: 'Delete dose entry' }))

    expect(window.confirm).toHaveBeenCalledWith('Delete this dose entry? This cannot be undone.')

    await waitFor(async () => {
      const { doseEvents } = await loadPatientMedicationView('patient-1')
      const matchingDoseEvents = doseEvents.filter(
        (doseEvent) => doseEvent.medicationId === 'med-interval-1',
      )
      expect(matchingDoseEvents.length).toBe(1)
    })

    await waitFor(() => {
      expect(screen.queryByTestId(`dose-entry-${newlyLoggedDoseEventId}`)).toBeNull()
    })
  })

  it('does not save correction when confirmation is canceled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const user = userEvent.setup()

    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const medicationCard = await screen.findByTestId('med-card-med-interval-1')

    await user.click(within(medicationCard).getByTestId('correct-dose-dose-seed-1'))
    await user.type(
      within(medicationCard).getByLabelText('Replacement timestamp (local time)'),
      '2099-01-01T00:00',
    )
    await user.click(within(medicationCard).getByRole('button', { name: 'Save correction' }))

    await waitFor(async () => {
      const { doseEvents } = await loadPatientMedicationView('patient-1')
      expect(doseEvents.some((doseEvent) => doseEvent.corrected)).toBe(false)
    })
  })

  it('shows validation error when correction timestamp is missing', async () => {
    const user = userEvent.setup()

    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const medicationCard = await screen.findByTestId('med-card-med-interval-1')

    await user.click(within(medicationCard).getByTestId('correct-dose-dose-seed-1'))
    await user.clear(within(medicationCard).getByLabelText('Replacement timestamp (local time)'))
    await user.click(within(medicationCard).getByRole('button', { name: 'Save correction' }))

    expect(within(medicationCard).getByText('Replacement timestamp (local time) is required.')).toBeTruthy()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('triggers due-now reminder once and avoids duplicates using local dedupe log', async () => {
    mockClock.now = '2026-03-28T14:01:00.000Z'
    const user = userEvent.setup()

    const NotificationMock = Notification as unknown as {
      instances: Array<{ title: string; options?: NotificationOptions }>
    }

    await saveReminderNotificationLog({
      'med-prn-1:due-now:2026-03-28T10:30:00.000Z': '2026-03-28T10:31:00.000Z',
      'med-taper-1:due-now:2026-03-28T20:00:00.000Z': '2026-03-28T20:01:00.000Z',
    })

    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByRole('checkbox', { name: 'Patient notifications' }))

    await waitFor(() => {
      expect(NotificationMock.instances.some((entry) => entry.title.includes('Amoxicillin: due now'))).toBe(true)
    })

    const firstCount = NotificationMock.instances.length
    expect(firstCount).toBeGreaterThanOrEqual(1)
    const firstAmoxicillinCount = NotificationMock.instances.filter(
      (entry) => entry.title === 'Amoxicillin: due now',
    ).length
    expect(firstAmoxicillinCount).toBe(1)

    cleanup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })

    await waitFor(() => {
      expect(NotificationMock.instances.length).toBe(firstCount)
    })

    const secondAmoxicillinCount = NotificationMock.instances.filter(
      (entry) => entry.title === 'Amoxicillin: due now',
    ).length
    expect(secondAmoxicillinCount).toBe(1)
  })

  it('refreshes medication timing on page show so overdue state catches up after resume', async () => {
    mockClock.now = '2026-03-28T13:50:00.000Z'

    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const medicationCard = await screen.findByTestId('med-card-med-interval-1')

    expect(within(medicationCard).getByText(/Too early by|Next due/)).toBeTruthy()

    mockClock.now = '2026-03-28T14:01:00.000Z'
    window.dispatchEvent(new Event('pageshow'))

    await waitFor(() => {
      expect(within(screen.getByTestId('med-card-med-interval-1')).getByText(/Overdue by|Eligible now/)).toBeTruthy()
    })
  })
})
