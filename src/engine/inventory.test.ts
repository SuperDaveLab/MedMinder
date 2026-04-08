import { describe, expect, it } from 'vitest'
import type { DoseEvent, Medication } from '../domain/types'
import { computeMedicationInventoryStatus } from './inventory'

function buildMedication(overrides?: Partial<Medication>): Medication {
  return {
    id: 'med-1',
    patientId: 'patient-1',
    name: 'Hydroxyzine',
    active: true,
    defaultDoseText: '25 mg',
    schedule: {
      type: 'interval',
      intervalMinutes: 240,
    },
    inventoryEnabled: true,
    initialQuantity: 100,
    doseAmount: 25,
    doseUnit: 'mg',
    lowSupplyThreshold: 25,
    ...overrides,
  }
}

function buildDoseEvent(overrides?: Partial<Extract<DoseEvent, { corrected: false }>>): DoseEvent {
  return {
    id: crypto.randomUUID(),
    medicationId: 'med-1',
    timestampGiven: '2026-04-08T08:00:00.000Z',
    corrected: false,
    ...overrides,
  }
}

function buildCorrectionDoseEvent(
  overrides?: Partial<Extract<DoseEvent, { corrected: true }>>,
): DoseEvent {
  return {
    id: crypto.randomUUID(),
    medicationId: 'med-1',
    timestampGiven: '2026-04-08T09:00:00.000Z',
    corrected: true,
    supersedesDoseEventId: 'dose-original',
    ...overrides,
  }
}

describe('computeMedicationInventoryStatus', () => {
  it('derives remaining quantity from effective (non-superseded) dose history', () => {
    const medication = buildMedication({ initialQuantity: 200, doseAmount: 25 })

    const originalDose = buildDoseEvent({ id: 'dose-original' })
    const correctionDose = buildCorrectionDoseEvent({
      id: 'dose-correction',
      supersedesDoseEventId: 'dose-original',
    })
    const secondDose = buildDoseEvent({ id: 'dose-second', timestampGiven: '2026-04-08T12:00:00.000Z' })

    const result = computeMedicationInventoryStatus({
      medication,
      doseEvents: [originalDose, correctionDose, secondDose],
    })

    expect(result.effectiveDoseCount).toBe(2)
    expect(result.quantityUsed).toBe(50)
    expect(result.remainingQuantity).toBe(150)
    expect(result.statusLabel).toBe('inventory_ok')
  })

  it('reports low_supply when remaining quantity is at or below threshold', () => {
    const medication = buildMedication({
      initialQuantity: 50,
      doseAmount: 10,
      lowSupplyThreshold: 10,
    })

    const result = computeMedicationInventoryStatus({
      medication,
      doseEvents: [
        buildDoseEvent({ id: 'd1' }),
        buildDoseEvent({ id: 'd2' }),
        buildDoseEvent({ id: 'd3' }),
        buildDoseEvent({ id: 'd4' }),
      ],
    })

    expect(result.remainingQuantity).toBe(10)
    expect(result.statusLabel).toBe('low_supply')
  })

  it('reports out_of_stock when remaining quantity is zero or below', () => {
    const medication = buildMedication({
      initialQuantity: 40,
      doseAmount: 20,
      lowSupplyThreshold: 5,
    })

    const result = computeMedicationInventoryStatus({
      medication,
      doseEvents: [
        buildDoseEvent({ id: 'd1' }),
        buildDoseEvent({ id: 'd2' }),
      ],
    })

    expect(result.remainingQuantity).toBe(0)
    expect(result.statusLabel).toBe('out_of_stock')
  })

  it('returns disabled status when inventory tracking is off', () => {
    const medication = buildMedication({ inventoryEnabled: false })

    const result = computeMedicationInventoryStatus({
      medication,
      doseEvents: [buildDoseEvent()],
    })

    expect(result.inventoryEnabled).toBe(false)
    expect(result.statusLabel).toBeNull()
    expect(result.remainingQuantity).toBeNull()
  })
})
