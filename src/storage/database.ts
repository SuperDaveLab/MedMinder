import Dexie, { type Table } from 'dexie'
import type { DoseEvent, Medication, Patient } from '../domain/types'

export interface AppSetting {
  key: string
  value: string
}

export class MedMinderDatabase extends Dexie {
  patients!: Table<Patient, string>
  medications!: Table<Medication, string>
  doseEvents!: Table<DoseEvent, string>
  appSettings!: Table<AppSetting, string>

  constructor() {
    super('med-minder-db')

    this.version(1).stores({
      patients: 'id',
      medications: 'id, patientId',
      doseEvents: 'id, medicationId, timestampGiven, [medicationId+timestampGiven]',
      appSettings: 'key',
    })
  }
}

export const medMinderDb = new MedMinderDatabase()
