// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { medMinderDb } from './storage/database'
import { exportFullBackup } from './storage/repository'

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

describe('App administration flow', () => {
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

        constructor() {}
      } as unknown as typeof Notification,
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('adds a patient', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-admin'))

    await user.type(screen.getByTestId('patient-display-name-input'), 'Jamie Carter')
    await user.type(screen.getByTestId('patient-notes-input'), 'Caregiver note')
    await user.click(screen.getByTestId('save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Jamie Carter' })).toBeTruthy()
    })
  })

  it('edits an existing patient', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-admin'))

    await user.click(screen.getByTestId('edit-patient-patient-1'))
    await user.clear(screen.getByTestId('patient-display-name-input'))
    await user.type(screen.getByTestId('patient-display-name-input'), 'Alex Rivera Updated')
    await user.click(screen.getByTestId('save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alex Rivera Updated' })).toBeTruthy()
    })
  })

  it('deletes a patient with confirmation', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-admin'))

    await user.click(screen.getByTestId('delete-patient-patient-1'))

    await waitFor(() => {
      expect(screen.getByText('No patients found in local database.')).toBeTruthy()
    })
  })

  it('adds a medication for the selected patient', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-admin'))

    await user.type(screen.getByTestId('medication-name-input'), 'Vitamin D')
    await user.type(screen.getByTestId('medication-default-dose-input'), '1 tablet')
    await user.clear(screen.getByTestId('interval-minutes-input'))
    await user.type(screen.getByTestId('interval-minutes-input'), '1440')
    await user.click(screen.getByTestId('save-medication-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Vitamin D').length).toBeGreaterThan(0)
    })
  })

  it('edits an existing medication', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-admin'))

    await user.click(screen.getByTestId('edit-medication-med-interval-1'))
    await user.clear(screen.getByTestId('medication-name-input'))
    await user.type(screen.getByTestId('medication-name-input'), 'Amoxicillin Updated')
    await user.click(screen.getByTestId('save-medication-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Amoxicillin Updated').length).toBeGreaterThan(0)
    })
  })

  it('deactivates and deletes a medication', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-admin'))

    const medicationItem = await screen.findByTestId('medication-item-med-interval-1')

    await user.click(screen.getByTestId('deactivate-medication-med-interval-1'))

    await waitFor(() => {
      expect(within(medicationItem).getByText('Inactive')).toBeTruthy()
    })

    await user.click(screen.getByTestId('delete-medication-med-interval-1'))

    await waitFor(() => {
      expect(screen.queryByTestId('medication-item-med-interval-1')).toBeNull()
    })
  })

  it('rejects malformed backup imports with a validation message', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-admin'))

    const input = screen.getByTestId('backup-file-input') as HTMLInputElement
    const badFile = new File([JSON.stringify({ nope: true })], 'bad-backup.json', {
      type: 'application/json',
    })

    await user.upload(input, badFile)

    await waitFor(() => {
      expect(screen.getByText(/Invalid backup:/)).toBeTruthy()
    })
  })

  it('restores data from backup and replaces current records', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })

    const originalBackup = await exportFullBackup()

    await user.click(screen.getByTestId('tab-admin'))
    await user.type(screen.getByTestId('patient-display-name-input'), 'Temporary Patient')
    await user.click(screen.getByTestId('save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Temporary Patient' })).toBeTruthy()
    })

    const input = screen.getByTestId('backup-file-input') as HTMLInputElement
    const backupFile = new File([JSON.stringify(originalBackup)], 'backup.json', {
      type: 'application/json',
    })

    await user.upload(input, backupFile)

    await waitFor(() => {
      expect(screen.getByText('Backup restored successfully.')).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Temporary Patient' })).toBeNull()
      expect(screen.getByRole('option', { name: 'Alex Rivera' })).toBeTruthy()
    })
  })
})
