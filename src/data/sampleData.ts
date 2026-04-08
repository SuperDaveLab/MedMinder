import type { MedMinderState } from '../domain/types'

export const initialSampleState: MedMinderState = {
  patients: [
    {
      id: 'patient-1',
      displayName: 'Alex Rivera',
    },
  ],
  medications: [
    {
      id: 'med-interval-1',
      patientId: 'patient-1',
      name: 'Amoxicillin',
      active: true,
      defaultDoseText: '500 mg',
      schedule: {
        type: 'interval',
        intervalMinutes: 8 * 60,
      },
      inventoryEnabled: false,
      instructions: 'Take every 8 hours with water.',
    },
    {
      id: 'med-prn-1',
      patientId: 'patient-1',
      name: 'Ibuprofen (PRN)',
      active: true,
      defaultDoseText: '200 mg',
      schedule: {
        type: 'prn',
        minimumIntervalMinutes: 6 * 60,
      },
      inventoryEnabled: false,
      instructions: 'As needed for pain, minimum 6 hours between doses.',
    },
    {
      id: 'med-taper-1',
      patientId: 'patient-1',
      name: 'Prednisone taper',
      active: true,
      defaultDoseText: '10 mg',
      schedule: {
        type: 'taper',
        rules: [
          {
            startDate: '2026-03-25',
            endDate: '2026-03-30',
            intervalMinutes: 8 * 60,
          },
          {
            startDate: '2026-03-30',
            intervalMinutes: 12 * 60,
          },
        ],
      },
      inventoryEnabled: false,
      instructions: 'Follow taper schedule exactly as prescribed.',
    },
  ],
  doseEvents: [
    {
      id: 'dose-seed-1',
      medicationId: 'med-interval-1',
      timestampGiven: '2026-03-28T06:00:00.000Z',
      corrected: false,
    },
    {
      id: 'dose-seed-2',
      medicationId: 'med-prn-1',
      timestampGiven: '2026-03-28T04:30:00.000Z',
      notes: 'Headache',
      corrected: false,
    },
    {
      id: 'dose-seed-3',
      medicationId: 'med-taper-1',
      timestampGiven: '2026-03-28T08:00:00.000Z',
      corrected: false,
    },
  ],
}
