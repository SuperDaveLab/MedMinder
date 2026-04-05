import { describe, expect, it } from 'vitest'
import type { DoseEvent, Medication } from '../domain/types'
import { computeMedicationStatus } from './contract'

function buildIntervalMedication(intervalMinutes: number): Medication {
  return {
    id: 'med-1',
    patientId: 'patient-1',
    name: 'Amoxicillin',
    active: true,
    defaultDoseText: '500 mg',
    schedule: {
      type: 'interval',
      intervalMinutes,
    },
  }
}

function buildDoseEvent(timestampGiven: string): DoseEvent {
  return {
    id: 'dose-1',
    medicationId: 'med-1',
    timestampGiven,
    corrected: false,
  }
}

describe('computeMedicationStatus', () => {
  it('marks interval medication as missed after 1.5x interval threshold', () => {
    const medication = buildIntervalMedication(480)
    const doseEvents = [buildDoseEvent('2026-03-28T06:00:00.000Z')]

    const overdueStatus = computeMedicationStatus({
      medication,
      doseEvents,
      now: new Date('2026-03-28T14:10:00.000Z'),
    })

    expect(overdueStatus.statusLabel).toBe('overdue')

    const missedStatus = computeMedicationStatus({
      medication,
      doseEvents,
      now: new Date('2026-03-28T18:01:00.000Z'),
    })

    expect(missedStatus.statusLabel).toBe('missed')
  })
})
