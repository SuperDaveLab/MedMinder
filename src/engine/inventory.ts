import type { DoseEvent, Medication, MedicationInventoryStatus } from '../domain/types'

export interface ComputeMedicationInventoryInput {
  medication: Medication
  doseEvents: DoseEvent[]
}

/**
 * Inventory strategy (authoritative source):
 *
 * Remaining quantity is derived from persisted medication settings + effective
 * dose history, never from an incrementally decremented counter:
 *
 *   remaining = initialQuantity - (effectiveDoseCount * doseAmount)
 *
 * Effective dose count excludes superseded events, so corrections do not
 * double-count and do not corrupt inventory across devices.
 */
export function computeMedicationInventoryStatus(
  input: ComputeMedicationInventoryInput,
): MedicationInventoryStatus {
  const inventoryEnabled = input.medication.inventoryEnabled === true

  if (!inventoryEnabled) {
    return {
      inventoryEnabled: false,
      configured: false,
      statusLabel: null,
      remainingQuantity: null,
      quantityUsed: 0,
      effectiveDoseCount: 0,
      lowSupplyThreshold: null,
    }
  }

  const initialQuantity = input.medication.initialQuantity
  const doseAmount = input.medication.doseAmount
  const lowSupplyThreshold = input.medication.lowSupplyThreshold ?? 0

  const configured =
    Number.isFinite(initialQuantity) &&
    Number.isFinite(doseAmount) &&
    (initialQuantity ?? 0) >= 0 &&
    (doseAmount ?? 0) > 0

  if (!configured) {
    return {
      inventoryEnabled: true,
      configured: false,
      statusLabel: null,
      remainingQuantity: null,
      quantityUsed: 0,
      effectiveDoseCount: 0,
      lowSupplyThreshold: Number.isFinite(lowSupplyThreshold) ? lowSupplyThreshold : null,
    }
  }

  const medicationDoseEvents = input.doseEvents.filter(
    (doseEvent) => doseEvent.medicationId === input.medication.id,
  )

  const supersededDoseEventIds = new Set(
    medicationDoseEvents
      .filter((doseEvent) => doseEvent.corrected)
      .map((doseEvent) => doseEvent.supersedesDoseEventId),
  )

  const effectiveDoseCount = medicationDoseEvents.filter(
    (doseEvent) => !supersededDoseEventIds.has(doseEvent.id),
  ).length

  const quantityUsed = effectiveDoseCount * (doseAmount as number)
  const remainingQuantity = (initialQuantity as number) - quantityUsed

  let statusLabel: MedicationInventoryStatus['statusLabel']
  if (remainingQuantity <= 0) {
    statusLabel = 'out_of_stock'
  } else if (remainingQuantity <= lowSupplyThreshold) {
    statusLabel = 'low_supply'
  } else {
    statusLabel = 'inventory_ok'
  }

  return {
    inventoryEnabled: true,
    configured: true,
    statusLabel,
    remainingQuantity,
    quantityUsed,
    effectiveDoseCount,
    lowSupplyThreshold,
  }
}
