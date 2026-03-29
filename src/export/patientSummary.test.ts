import { describe, expect, it } from 'vitest'
import type { DoseEvent, Medication, Patient } from '../domain/types'
import {
  buildPatientMedicationSummaryRows,
  buildPatientSummaryText,
} from './patientSummary'

const patient: Patient = {
  id: 'patient-1',
  displayName: 'Alex Rivera',
}

const medications: Medication[] = [
  {
    id: 'med-1',
    patientId: 'patient-1',
    name: 'Amoxicillin',
    strengthText: '500 mg',
    active: true,
    defaultDoseText: '1 capsule',
    schedule: {
      type: 'interval',
      intervalMinutes: 480,
    },
    reminderSettings: {
      enabled: true,
      earlyReminderMinutes: 10,
    },
  },
]

const doseEvents: DoseEvent[] = [
  {
    id: 'dose-1',
    medicationId: 'med-1',
    timestampGiven: '2026-03-28T06:00:00.000Z',
    corrected: false,
  },
]

describe('patient summary export helpers', () => {
  it('builds summary rows using scheduling engine output', () => {
    const rows = buildPatientMedicationSummaryRows(
      medications,
      doseEvents,
      new Date('2026-03-28T10:00:00.000Z'),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Amoxicillin')
    expect(rows[0].scheduleType).toBe('interval')
    expect(rows[0].currentStatus).toContain('Too early by')
    expect(rows[0].reminderSetting).toContain('Enabled')
  })

  it('generates readable plain text summary output', () => {
    const rows = buildPatientMedicationSummaryRows(
      medications,
      doseEvents,
      new Date('2026-03-28T10:00:00.000Z'),
    )
    const summaryText = buildPatientSummaryText(
      patient,
      new Date('2026-03-29T09:00:00.000Z'),
      rows,
    )

    expect(summaryText).toContain('Med-Minder Patient Medication Summary')
    expect(summaryText).toContain('Patient: Alex Rivera')
    expect(summaryText).toContain('Amoxicillin')
    expect(summaryText).toContain('Schedule details: Every 480 minutes')
    expect(summaryText).toContain('Reminder: Enabled (10 min early)')
  })
})
