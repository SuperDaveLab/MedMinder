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
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-patients'))
    await user.click(screen.getByTestId('start-add-patient-button'))

    await user.type(screen.getByTestId('patient-display-name-input'), 'Jamie Carter')
    await user.type(screen.getByTestId('patient-notes-input'), 'Caregiver note')
    await user.click(screen.getByTestId('save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Jamie Carter' })).toBeTruthy()
    })
  })

  it('shows optional account controls in More view', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-more'))

    expect(screen.getByTestId('account-section')).toBeTruthy()
    expect(screen.getByTestId('auth-email-input')).toBeTruthy()
    expect(screen.getByTestId('auth-password-input')).toBeTruthy()
    expect(screen.getByTestId('create-account-button')).toBeTruthy()
    expect(screen.getByTestId('sign-in-button')).toBeTruthy()
  })

  it('shows friendly schedule type labels in the medication form', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-meds'))
    await user.click(screen.getByTestId('start-add-medication-button'))

    const scheduleTypeSelect = screen.getByTestId('medication-schedule-type-select')

    expect(within(scheduleTypeSelect).getByRole('option', { name: 'Every X hours' })).toBeTruthy()
    expect(within(scheduleTypeSelect).getByRole('option', { name: 'Specific times of day' })).toBeTruthy()
    expect(within(scheduleTypeSelect).getByRole('option', { name: 'As needed (PRN)' })).toBeTruthy()
    expect(within(scheduleTypeSelect).getByRole('option', { name: 'Taper schedule' })).toBeTruthy()
  })

  it('uses a friendlier fixed-times editor for specific times of day', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-meds'))
    await user.click(screen.getByTestId('start-add-medication-button'))

    await user.selectOptions(
      screen.getByTestId('medication-schedule-type-select'),
      'fixed_times',
    )

    expect(screen.getByTestId('fixed-times-editor')).toBeTruthy()
    expect((screen.getByTestId('fixed-time-input-0') as HTMLInputElement).value).toBe('08:00')
    expect((screen.getByTestId('fixed-time-input-1') as HTMLInputElement).value).toBe('20:00')

    await user.click(screen.getByTestId('add-fixed-time-button'))
    expect((screen.getByTestId('fixed-time-input-2') as HTMLInputElement).value).toBe('12:00')

    await user.clear(screen.getByTestId('fixed-time-input-1'))
    await user.type(screen.getByTestId('fixed-time-input-1'), '14:30')
    await user.click(screen.getByTestId('remove-fixed-time-button-0'))

    await user.type(screen.getByTestId('medication-name-input'), 'Midday antibiotic')
    await user.type(screen.getByTestId('medication-default-dose-input'), '1 tablet')
    await user.click(screen.getByTestId('save-medication-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Midday antibiotic').length).toBeGreaterThan(0)
    })
  })

  it('adds a patient from the header picker and selects them', async () => {
    const user = userEvent.setup()

    render(<App />)

    await screen.findByRole('option', { name: 'Alex Rivera' })

    await user.click(screen.getByTestId('open-add-patient-button'))
    await user.type(screen.getByTestId('header-patient-display-name-input'), 'Jordan Lee')
    await user.click(screen.getByTestId('header-save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Jordan Lee' })).toBeTruthy()
    })

    const patientSelect = screen.getByRole('combobox', { name: 'Selected patient' })
    const selectedOption = within(patientSelect).getByRole('option', { name: 'Jordan Lee' }) as HTMLOptionElement

    expect(selectedOption.selected).toBe(true)
    expect(screen.queryByTestId('header-patient-display-name-input')).toBeNull()

    await user.click(screen.getByTestId('tab-care'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jordan Lee' })).toBeTruthy()
    })
  })

  it('opens the medication form from the patient medications view', async () => {
    const user = userEvent.setup()

    render(<App />)

    await screen.findByRole('option', { name: 'Alex Rivera' })

    await user.click(screen.getByTestId('open-add-patient-button'))
    await user.type(screen.getByTestId('header-patient-display-name-input'), 'Taylor Brooks')
    await user.click(screen.getByTestId('header-save-patient-button'))

    await user.click(screen.getByTestId('tab-care'))
    await screen.findByRole('heading', { name: 'Taylor Brooks' })

    await user.click(screen.getByTestId('care-add-medication-button'))

    await waitFor(() => {
      expect(screen.getByTestId('meds-view')).toBeTruthy()
    })

    await user.click(screen.getByTestId('start-add-medication-button'))

    expect((screen.getByTestId('interval-unit-select') as HTMLSelectElement).value).toBe('hours')
    expect((screen.getByTestId('interval-value-input') as HTMLInputElement).step).toBe('0.25')
    expect(screen.queryByRole('option', { name: 'days' })).toBeNull()

    await user.type(screen.getByTestId('medication-name-input'), 'Vitamin D')
    await user.type(screen.getByTestId('medication-default-dose-input'), '1 tablet')
    await user.clear(screen.getByTestId('interval-value-input'))
    await user.type(screen.getByTestId('interval-value-input'), '24')
    await user.click(screen.getByTestId('save-medication-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Vitamin D').length).toBeGreaterThan(0)
    })

    await user.click(screen.getByTestId('tab-care'))

    await waitFor(() => {
      expect(screen.getAllByText('Vitamin D').length).toBeGreaterThan(0)
    })
  })

  it('edits an existing patient', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-patients'))

    await user.click(screen.getByTestId('edit-patient-patient-1'))
    await user.clear(screen.getByTestId('patient-display-name-input'))
    await user.type(screen.getByTestId('patient-display-name-input'), 'Alex Rivera Updated')
    await user.click(screen.getByTestId('save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Alex Rivera Updated' })).toBeTruthy()
    })
  })

  it('deletes a patient with confirmation', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-patients'))

    await user.click(screen.getByTestId('delete-patient-patient-1'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Alex Rivera' })).toBeTruthy()
    })
  })

  it('adds a medication for the selected patient', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-meds'))
    await user.click(screen.getByTestId('start-add-medication-button'))

    expect((screen.getByTestId('interval-unit-select') as HTMLSelectElement).value).toBe('hours')
    expect((screen.getByTestId('interval-value-input') as HTMLInputElement).step).toBe('0.25')

    await user.type(screen.getByTestId('medication-name-input'), 'Vitamin D')
    await user.type(screen.getByTestId('medication-default-dose-input'), '1 tablet')
    await user.clear(screen.getByTestId('interval-value-input'))
    await user.type(screen.getByTestId('interval-value-input'), '24')
    await user.click(screen.getByTestId('save-medication-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Vitamin D').length).toBeGreaterThan(0)
    })
  })

  it('edits an existing medication', async () => {
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-meds'))

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
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-meds'))

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
    await screen.findByRole('option', { name: 'Alex Rivera' })
    await user.click(screen.getByTestId('tab-more'))

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
    await screen.findByRole('option', { name: 'Alex Rivera' })

    const originalBackup = await exportFullBackup()

    await user.click(screen.getByTestId('tab-patients'))
    await user.click(screen.getByTestId('start-add-patient-button'))
    await user.type(screen.getByTestId('patient-display-name-input'), 'Temporary Patient')
    await user.click(screen.getByTestId('save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Temporary Patient' })).toBeTruthy()
    })

    await user.click(screen.getByTestId('tab-more'))

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
