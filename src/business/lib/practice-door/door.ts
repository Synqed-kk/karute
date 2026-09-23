// THE practice door — the ON side of data.ts's switch (DESIGN-PRACTICE-DOOR.md §8).
// PR-2 fills these; until then the switch ON fails loud, never a lie (§8).
// Same names and parameter types as data.ts's readers. Zero imports: data.ts is
// this file's only importer, so importing it back would be a cycle; the lens type
// is restated locally. Every function throws, so each returns Promise<never>,
// which data.ts's own return types absorb unchanged.

/* eslint-disable @typescript-eslint/no-unused-vars -- the parameters are the contract PR-2 fills */

export class PracticeDoorNotBuilt extends Error {
  constructor(reader: string) {
    super(`practice door not built yet: ${reader} (PR-2)`)
    this.name = 'PracticeDoorNotBuilt'
  }
}

type StoreLens = string | { viewAll: true }
type DayRange = { from: number; to: number }

export async function listStoreOptions(): Promise<never> {
  throw new PracticeDoorNotBuilt('listStoreOptions')
}
export async function listCustomers(lens: StoreLens): Promise<never> {
  throw new PracticeDoorNotBuilt('listCustomers')
}
export async function listAppointments(lens: StoreLens, range?: { from?: string; to?: string }): Promise<never> {
  throw new PracticeDoorNotBuilt('listAppointments')
}
export async function listVisits(lens: StoreLens, opts?: { customerId?: string }): Promise<never> {
  throw new PracticeDoorNotBuilt('listVisits')
}
export async function readShellIdentity(): Promise<never> {
  throw new PracticeDoorNotBuilt('readShellIdentity')
}
export async function listMenus(lens: StoreLens): Promise<never> {
  throw new PracticeDoorNotBuilt('listMenus')
}
export async function readUnresolvedCounts(): Promise<never> {
  throw new PracticeDoorNotBuilt('readUnresolvedCounts')
}
export async function listResources(lens: StoreLens): Promise<never> {
  throw new PracticeDoorNotBuilt('listResources')
}
export async function listShiftsByDay(lens: StoreLens, range: DayRange): Promise<never> {
  throw new PracticeDoorNotBuilt('listShiftsByDay')
}
export async function listAbsenceByDay(lens: StoreLens, range: DayRange): Promise<never> {
  throw new PracticeDoorNotBuilt('listAbsenceByDay')
}
export async function listBlocksByDay(lens: StoreLens, range: DayRange): Promise<never> {
  throw new PracticeDoorNotBuilt('listBlocksByDay')
}
export async function readDayPlanes(lens: StoreLens, dayKey: number): Promise<never> {
  throw new PracticeDoorNotBuilt('readDayPlanes')
}
export async function readReservationPlanes(lens: StoreLens): Promise<never> {
  throw new PracticeDoorNotBuilt('readReservationPlanes')
}
export async function readAnalyticsPlanes(lens: StoreLens): Promise<never> {
  throw new PracticeDoorNotBuilt('readAnalyticsPlanes')
}
export async function listStaff(lens: StoreLens): Promise<never> {
  throw new PracticeDoorNotBuilt('listStaff')
}
export async function readStaffStores(lens: StoreLens): Promise<never> {
  throw new PracticeDoorNotBuilt('readStaffStores')
}
