export { SynqedClient, SynqedError } from './client'
export { CustomerClient } from './customers'
export { StaffClient } from './staff'
export { AppointmentClient } from './appointments'
export { SyncClient } from './sync'

export type {
  // Shared
  SynqedClientConfig,

  // Customers
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersOptions,
  ListCustomersResponse,
  CheckDuplicateResponse,

  // Staff
  Staff,
  StaffRole,
  CreateStaffInput,
  UpdateStaffInput,
  ListStaffOptions,
  ListStaffResponse,

  // Appointments
  Appointment,
  AppointmentStatus,
  AppointmentSource,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  ListAppointmentsOptions,
  ListAppointmentsResponse,

  // Sync
  SyncConfig,
  SyncProvider,
  SyncStatus,
  UpsertSyncConfigInput,
  SyncRunResult,
} from './types'
