import { describe, expect, it } from 'vitest'
import { buildDoseHistoryCsv, buildDoseHistoryRows } from './doseHistoryCsv'
import type { DoseEvent, Medication, Patient } from '../domain/types'

const patient: Patient = { id: 'p1', displayName: 'Alice' }

const medication: Medication = {
  id: 'm1',
  patientId: 'p1',
  name: 'Ibuprofen',
  active: true,
  defaultDoseText: '400mg',
  schedule: { type: 'interval', intervalMinutes: 360 },
}

const baseEvent: DoseEvent = {
  id: 'e1',
  medicationId: 'm1',
  timestampGiven: '2026-04-09T10:00:00.000Z',
  doseText: '400mg',
  givenBy: 'Dave',
  notes: '',
  corrected: false,
}

describe('buildDoseHistoryRows', () => {
  it('maps dose events to rows with patient and medication names', () => {
    const rows = buildDoseHistoryRows([patient], [medication], [baseEvent])
    expect(rows).toHaveLength(1)
    expect(rows[0].patientName).toBe('Alice')
    expect(rows[0].medicationName).toBe('Ibuprofen')
    expect(rows[0].doseText).toBe('400mg')
    expect(rows[0].givenBy).toBe('Dave')
    expect(rows[0].corrected).toBe(false)
    expect(rows[0].supersedesDoseEventId).toBe('')
  })

  it('sorts rows newest first', () => {
    const older: DoseEvent = { ...baseEvent, id: 'e2', timestampGiven: '2026-04-08T08:00:00.000Z' }
    const rows = buildDoseHistoryRows([patient], [medication], [older, baseEvent])
    expect(rows[0].doseEventId).toBe('e1')
    expect(rows[1].doseEventId).toBe('e2')
  })

  it('handles corrected events', () => {
    const corrected: DoseEvent = {
      ...baseEvent,
      id: 'e3',
      corrected: true,
      supersedesDoseEventId: 'e1',
    }
    const rows = buildDoseHistoryRows([patient], [medication], [corrected])
    expect(rows[0].corrected).toBe(true)
    expect(rows[0].supersedesDoseEventId).toBe('e1')
  })

  it('uses fallback labels for unknown medication/patient', () => {
    const orphan: DoseEvent = { ...baseEvent, id: 'e4', medicationId: 'unknown' }
    const rows = buildDoseHistoryRows([patient], [medication], [orphan])
    expect(rows[0].medicationName).toBe('Unknown medication')
    expect(rows[0].patientName).toBe('Unknown patient')
  })

  it('handles empty inputs', () => {
    const rows = buildDoseHistoryRows([], [], [])
    expect(rows).toHaveLength(0)
  })
})

describe('buildDoseHistoryCsv', () => {
  it('produces a header row and data rows', () => {
    const rows = buildDoseHistoryRows([patient], [medication], [baseEvent])
    const csv = buildDoseHistoryCsv(rows)
    const lines = csv.split('\r\n')
    expect(lines[0]).toContain('Timestamp Given')
    expect(lines[0]).toContain('Patient')
    expect(lines[0]).toContain('Medication')
    expect(lines[1]).toContain('Alice')
    expect(lines[1]).toContain('Ibuprofen')
  })

  it('escapes values containing commas', () => {
    const medWithComma: Medication = { ...medication, name: 'Acetaminophen, Extra Strength' }
    const rows = buildDoseHistoryRows([patient], [medWithComma], [baseEvent])
    const csv = buildDoseHistoryCsv(rows)
    expect(csv).toContain('"Acetaminophen, Extra Strength"')
  })

  it('escapes values containing double quotes', () => {
    const event: DoseEvent = { ...baseEvent, notes: 'He said "take it with food"' }
    const rows = buildDoseHistoryRows([patient], [medication], [event])
    const csv = buildDoseHistoryCsv(rows)
    expect(csv).toContain('"He said ""take it with food"""')
  })

  it('returns just the header row when there are no events', () => {
    const csv = buildDoseHistoryCsv([])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Timestamp Given')
  })
})
