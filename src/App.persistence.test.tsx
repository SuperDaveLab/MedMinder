// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

describe('App persistence flow', () => {
  beforeEach(async () => {
    await clearDatabase()

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

    const updatedHistory = within(medicationCard).getByTestId('med-history-med-interval-1')
    expect(within(updatedHistory).getAllByRole('listitem').length).toBe(2)

    cleanup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Alex Rivera' })
    const reloadedCard = await screen.findByTestId('med-card-med-interval-1')
    const reloadedHistory = within(reloadedCard).getByTestId('med-history-med-interval-1')

    expect(within(reloadedHistory).getAllByRole('listitem').length).toBe(2)
  })
})
