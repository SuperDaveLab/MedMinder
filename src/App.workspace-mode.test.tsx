// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { CreateAccountResponse } from './domain/auth'
import type { CloudSyncRequest } from './domain/cloudSync'
import type { DoseEvent, MedMinderState, Medication, Patient } from './domain/types'
import { initialSampleState } from './data/sampleData'
import { medMinderDb } from './storage/database'
import { getLocalMedMinderState } from './storage/repository'

function cloneState(state: MedMinderState): MedMinderState {
  return JSON.parse(JSON.stringify(state)) as MedMinderState
}

function buildAuthResponse(email = 'caregiver@example.com'): CreateAccountResponse {
  return {
    account: {
      accountId: 'account-1',
      userId: 'user-1',
      email,
      createdAt: '2026-04-06T10:00:00.000Z',
    },
    session: {
      sessionId: 'session-1',
      accountId: 'account-1',
      userId: 'user-1',
      issuedAt: '2026-04-06T10:00:00.000Z',
      expiresAt: '2026-04-07T10:00:00.000Z',
      provider: 'password',
    },
    tokens: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: '2026-04-06T11:00:00.000Z',
    },
  }
}

function buildStateFromSyncRequest(request: CloudSyncRequest): MedMinderState {
  const nextState: MedMinderState = {
    patients: [],
    medications: [],
    doseEvents: [],
  }

  for (const mutation of request.mutations) {
    if (mutation.kind !== 'upsert') {
      continue
    }

    if (mutation.entityType === 'patient') {
      nextState.patients.push(mutation.payload as Patient)
      continue
    }

    if (mutation.entityType === 'medication') {
      nextState.medications.push(mutation.payload as Medication)
      continue
    }

    nextState.doseEvents.push(mutation.payload as DoseEvent)
  }

  return nextState
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function installFetchMock(initialCloudState: MedMinderState, email = 'caregiver@example.com') {
  let cloudState = cloneState(initialCloudState)

  const controller = {
    syncRequests: [] as CloudSyncRequest[],
    registerCalls: 0,
    loginCalls: 0,
    logoutCalls: 0,
    getCloudState: () => cloneState(cloudState),
  }

  const authResponse = buildAuthResponse(email)

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url.endsWith('/api/auth/register')) {
        controller.registerCalls += 1
        return jsonResponse(authResponse)
      }

      if (url.endsWith('/api/auth/login')) {
        controller.loginCalls += 1
        return jsonResponse(authResponse)
      }

      if (url.endsWith('/api/auth/logout')) {
        controller.logoutCalls += 1
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/api/auth/account')) {
        if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { phoneE164?: string | null }
          authResponse.account.phoneE164 = body.phoneE164 ?? undefined
          return jsonResponse(authResponse.account)
        }

        return jsonResponse(authResponse.account)
      }

      if (url.endsWith('/api/cloud/state')) {
        return jsonResponse(cloudState)
      }

      if (url.endsWith('/api/cloud/sync')) {
        const request = JSON.parse(String(init?.body)) as CloudSyncRequest
        controller.syncRequests.push(request)
        cloudState = buildStateFromSyncRequest(request)

        return jsonResponse({
          schemaVersion: 1,
          accountId: authResponse.account.accountId,
          receivedAt: '2026-04-06T10:00:01.000Z',
          nextCursor: {
            serverVersion: controller.syncRequests.length,
            generatedAt: '2026-04-06T10:00:01.000Z',
          },
          mutationResults: request.mutations.map((mutation, index) => ({
            mutationId: index + 1,
            outcome: 'accepted',
            recordId: mutation.recordId,
            entityType: mutation.entityType,
            serverVersion: controller.syncRequests.length,
          })),
          remoteChanges: [],
        })
      }

      throw new Error(`Unhandled fetch request in test: ${url}`)
    }) as typeof fetch,
  )

  return controller
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

describe('App workspace mode flow', () => {
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

  it('seeds the local sample workspace when anonymous local storage is empty', async () => {
    render(<App />)

    await screen.findByRole('option', { name: 'Alex Rivera' })

    await waitFor(async () => {
      const localState = await getLocalMedMinderState()

      expect(localState.patients).toHaveLength(initialSampleState.patients.length)
      expect(localState.medications).toHaveLength(initialSampleState.medications.length)
      expect(localState.doseEvents).toHaveLength(initialSampleState.doseEvents.length)
    })
  })

  it('creates an account by uploading current local clinical data to cloud and clearing local storage', async () => {
    installFetchMock({ patients: [], medications: [], doseEvents: [] })

    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })

    await user.click(screen.getByTestId('tab-more'))
    await user.type(screen.getByTestId('patient-display-name-input'), 'Jamie Carter')
    await user.click(screen.getByTestId('save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Jamie Carter' })).toBeTruthy()
    })

    await user.type(screen.getByTestId('auth-email-input'), 'caregiver@example.com')
    await user.type(screen.getByTestId('auth-password-input'), 'password123')
    await user.click(screen.getByTestId('create-account-button'))

    await waitFor(() => {
      expect(screen.getByText('Signed in as caregiver@example.com')).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Jamie Carter' })).toBeTruthy()
    })

    const localState = await getLocalMedMinderState()
    expect(localState).toEqual({ patients: [], medications: [], doseEvents: [] })

    const fetchMock = vi.mocked(fetch)
    const syncCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/cloud/sync'))
    expect(syncCall).toBeTruthy()

    const syncRequest = JSON.parse(String(syncCall?.[1]?.body)) as CloudSyncRequest
    const migratedState = buildStateFromSyncRequest(syncRequest)

    expect(migratedState.patients.map((patient) => patient.displayName)).toContain('Alex Rivera')
    expect(migratedState.patients.map((patient) => patient.displayName)).toContain('Jamie Carter')
    expect(migratedState.medications).toHaveLength(initialSampleState.medications.length)
    expect(migratedState.doseEvents).toHaveLength(initialSampleState.doseEvents.length)
  })

  it('reads and writes clinical data from cloud while signed in, then returns to seeded local mode after sign-out', async () => {
    const controller = installFetchMock({
      patients: [
        {
          id: 'cloud-patient-1',
          displayName: 'Cloud Riley',
        },
      ],
      medications: [],
      doseEvents: [],
    })

    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })

    await user.click(screen.getByTestId('tab-more'))
    await user.type(screen.getByTestId('auth-email-input'), 'caregiver@example.com')
    await user.type(screen.getByTestId('auth-password-input'), 'password123')
    await user.click(screen.getByTestId('sign-in-button'))

    await waitFor(() => {
      expect(screen.getByText('Signed in as caregiver@example.com')).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Cloud Riley' })).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Alex Rivera' })).toBeNull()
    })

    let localState = await getLocalMedMinderState()
    expect(localState).toEqual({ patients: [], medications: [], doseEvents: [] })

    await user.clear(screen.getByTestId('patient-display-name-input'))
    await user.type(screen.getByTestId('patient-display-name-input'), 'Cloud Added')
    await user.click(screen.getByTestId('save-patient-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Cloud Added' })).toBeTruthy()
    })

    expect(controller.syncRequests).toHaveLength(1)
    expect(controller.getCloudState().patients.map((patient) => patient.displayName)).toEqual([
      'Cloud Riley',
      'Cloud Added',
    ])

    localState = await getLocalMedMinderState()
    expect(localState).toEqual({ patients: [], medications: [], doseEvents: [] })

    await user.click(screen.getByTestId('sign-out-button'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Alex Rivera' })).toBeTruthy()
      expect(screen.queryByRole('option', { name: 'Cloud Riley' })).toBeNull()
      expect(screen.queryByRole('option', { name: 'Cloud Added' })).toBeNull()
    })

    localState = await getLocalMedMinderState()
    expect(localState.patients.map((patient) => patient.displayName)).toEqual(['Alex Rivera'])
    expect(localState.medications).toHaveLength(initialSampleState.medications.length)
    expect(localState.doseEvents).toHaveLength(initialSampleState.doseEvents.length)
    expect(controller.logoutCalls).toBe(1)
  })

  it('cloud-mode medication CRUD (create, deactivate, delete) writes to cloud and never touches local DB', async () => {
    const controller = installFetchMock({
      patients: [{ id: 'cloud-patient-1', displayName: 'Cloud Riley' }],
      medications: [
        {
          id: 'cloud-med-1',
          patientId: 'cloud-patient-1',
          name: 'Cloud Aspirin',
          active: true,
          defaultDoseText: '100 mg',
          schedule: { type: 'interval', intervalMinutes: 240 },
        },
      ],
      doseEvents: [],
    })

    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })

    await user.click(screen.getByTestId('tab-more'))
    await user.type(screen.getByTestId('auth-email-input'), 'caregiver@example.com')
    await user.type(screen.getByTestId('auth-password-input'), 'password123')
    await user.click(screen.getByTestId('sign-in-button'))

    await waitFor(() => {
      expect(screen.getByText('Signed in as caregiver@example.com')).toBeTruthy()
    })

    // Verify medication is visible in cloud-sourced Meds view
    await user.click(screen.getByTestId('tab-meds'))
    await screen.findByTestId('medication-item-cloud-med-1')

    // Create a new medication in cloud mode
    await user.type(screen.getByTestId('medication-name-input'), 'Cloud Vitamin D')
    await user.type(screen.getByTestId('medication-default-dose-input'), '1 tablet')
    await user.clear(screen.getByTestId('interval-value-input'))
    await user.type(screen.getByTestId('interval-value-input'), '24')
    await user.click(screen.getByTestId('save-medication-button'))

    await waitFor(() => {
      expect(screen.getAllByText('Cloud Vitamin D').length).toBeGreaterThan(0)
    })

    let cloudState = controller.getCloudState()
    expect(cloudState.medications.map((medication) => medication.name)).toContain('Cloud Vitamin D')

    let localState = await getLocalMedMinderState()
    expect(localState.medications).toHaveLength(0)

    // Deactivate the original cloud medication
    await user.click(screen.getByTestId('deactivate-medication-cloud-med-1'))

    await waitFor(() => {
      expect(screen.getByTestId('medication-item-cloud-med-1')).toBeTruthy()
    })

    cloudState = controller.getCloudState()
    const deactivated = cloudState.medications.find(
      (medication) => medication.id === 'cloud-med-1',
    )
    expect(deactivated?.active).toBe(false)

    localState = await getLocalMedMinderState()
    expect(localState.medications).toHaveLength(0)

    // Delete the original cloud medication
    await user.click(screen.getByTestId('delete-medication-cloud-med-1'))

    await waitFor(() => {
      expect(screen.queryByTestId('medication-item-cloud-med-1')).toBeNull()
    })

    cloudState = controller.getCloudState()
    expect(
      cloudState.medications.find((medication) => medication.id === 'cloud-med-1'),
    ).toBeUndefined()
    expect(cloudState.medications.map((medication) => medication.name)).toContain('Cloud Vitamin D')

    localState = await getLocalMedMinderState()
    expect(localState.medications).toHaveLength(0)
  })

  it('cloud-mode dose logging writes to cloud and never touches local DB', async () => {
    const controller = installFetchMock({
      patients: [{ id: 'cloud-patient-1', displayName: 'Cloud Riley' }],
      medications: [
        {
          id: 'cloud-med-1',
          patientId: 'cloud-patient-1',
          name: 'Cloud Aspirin',
          active: true,
          defaultDoseText: '100 mg',
          schedule: { type: 'interval', intervalMinutes: 240 },
        },
      ],
      doseEvents: [],
    })

    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('option', { name: 'Alex Rivera' })

    await user.click(screen.getByTestId('tab-more'))
    await user.type(screen.getByTestId('auth-email-input'), 'caregiver@example.com')
    await user.type(screen.getByTestId('auth-password-input'), 'password123')
    await user.click(screen.getByTestId('sign-in-button'))

    await waitFor(() => {
      expect(screen.getByText('Signed in as caregiver@example.com')).toBeTruthy()
    })

    // Care view should show the cloud-sourced medication
    await user.click(screen.getByTestId('tab-care'))
    await screen.findByTestId('med-card-cloud-med-1')
    await user.click(screen.getByRole('button', { name: 'Give Dose' }))

    await waitFor(() => {
      const cloudState = controller.getCloudState()
      expect(cloudState.doseEvents).toHaveLength(1)
      expect(cloudState.doseEvents[0].medicationId).toBe('cloud-med-1')
    })

    const localState = await getLocalMedMinderState()
    expect(localState.doseEvents).toHaveLength(0)
  })
})