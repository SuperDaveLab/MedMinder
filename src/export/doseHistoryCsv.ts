import type { DoseEvent, Medication, Patient } from '../domain/types'

export interface DoseHistoryRow {
  timestampGiven: string
  patientName: string
  medicationName: string
  doseText: string
  givenBy: string
  notes: string
  corrected: boolean
  supersedesDoseEventId: string
  doseEventId: string
}

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function buildDoseHistoryRows(
  patients: Patient[],
  medications: Medication[],
  doseEvents: DoseEvent[],
): DoseHistoryRow[] {
  const patientMap = new Map(patients.map((p) => [p.id, p]))
  const medicationMap = new Map(medications.map((m) => [m.id, m]))

  const sorted = [...doseEvents].sort(
    (a, b) => Date.parse(b.timestampGiven) - Date.parse(a.timestampGiven),
  )

  return sorted.map((event) => {
    const medication = medicationMap.get(event.medicationId)
    const patient = medication ? patientMap.get(medication.patientId) : undefined

    return {
      timestampGiven: event.timestampGiven,
      patientName: patient?.displayName ?? 'Unknown patient',
      medicationName: medication?.name ?? 'Unknown medication',
      doseText: event.doseText ?? '',
      givenBy: event.givenBy ?? '',
      notes: event.notes ?? '',
      corrected: event.corrected,
      supersedesDoseEventId: event.corrected ? event.supersedesDoseEventId : '',
      doseEventId: event.id,
    }
  })
}

const CSV_HEADERS: (keyof DoseHistoryRow)[] = [
  'timestampGiven',
  'patientName',
  'medicationName',
  'doseText',
  'givenBy',
  'notes',
  'corrected',
  'supersedesDoseEventId',
  'doseEventId',
]

const CSV_HEADER_LABELS: Record<keyof DoseHistoryRow, string> = {
  timestampGiven: 'Timestamp Given',
  patientName: 'Patient',
  medicationName: 'Medication',
  doseText: 'Dose',
  givenBy: 'Given By',
  notes: 'Notes',
  corrected: 'Corrected',
  supersedesDoseEventId: 'Supersedes Event ID',
  doseEventId: 'Event ID',
}

export function buildDoseHistoryCsv(rows: DoseHistoryRow[]): string {
  const header = CSV_HEADERS.map((key) => csvEscape(CSV_HEADER_LABELS[key])).join(',')
  const dataRows = rows.map((row) =>
    CSV_HEADERS.map((key) => csvEscape(String(row[key]))).join(','),
  )
  return [header, ...dataRows].join('\r\n')
}
