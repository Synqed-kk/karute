// PKT-SEC-CORES-A: explicit browser-callable surface after closing the two doors.
// Internal debt is an inventory of existing exposure, never permission to add helpers.
// Caller evidence and UNSURE classifications are recorded in the packet report.

export const PUBLIC_ACTIONS: Record<string, string[]> = {
  'src/actions/appointments-window.ts': [
  ],
  'src/actions/appointments.ts': [
    'cancelAppointment',
    'createAppointment',
    'deleteAppointment', // UNSURE: no production caller found through this export.
    'getAppointmentsInRange', // UNSURE: no production caller found through this export.
    'getBurnablePackSummary',
    'getMonthCells',
    'markNoShowAppointment',
    'restoreAppointment',
    'updateAppointment', // UNSURE: no production caller found through this export.
    'validateAppointmentTime', // UNSURE: no production caller found through this export.
  ],
  'src/actions/audit-log.ts': [
    'listAuditLog',
  ],
  'src/actions/customers.ts': [
    'cancelCustomerDeletion',
    'createCustomer',
    'createQuickCustomer',
    'deleteCustomerPhoto',
    'getCustomerConsent',
    'grantCustomerConsent',
    'listCustomerPhotos',
    'revokeCustomerConsent',
    'scheduleCustomerDeletion',
    'searchCustomersCompanyWide',
    'updateCustomer',
    'uploadCustomerPhoto',
  ],
  'src/actions/dev-tools.ts': [
    'canUseDevRegen',
  ],
  'src/actions/entitlements.ts': [
    'getEntitlement',
  ],
  'src/actions/invites.ts': [
    'acceptInvite',
    'createInvite',
    'listInvites',
    'revokeInvite',
  ],
  'src/actions/karute-outcome.ts': [
    'updateKaruteOutcome',
  ],
  'src/actions/karute.ts': [
    'createManualKaruteRecord',
    'deleteKaruteRecord',
    'listEntryEditHistory',
    'listReassignCustomerOptions',
    'loadKaruteWindow',
    'reassignKaruteCustomer',
    'revealNoKaruteCustomer',
    'saveKaruteRecord',
    'saveKaruteRecordInline',
    'updateKaruteDetailEntry',
    'updateKaruteDetailSummary',
  ],
  'src/actions/memory.ts': [
    'addMemoryItemAction',
    'deleteMemoryItemAction',
    'relearnCustomerMemoryAction',
    'toggleMemoryPinAction',
    'updateMemoryItemAction',
    'upsertPassportFieldAction',
  ],
  'src/actions/menus.ts': [
    'createMenu',
    'reactivateMenu',
    'retireMenu',
    'updateMenu',
  ],
  'src/actions/org-settings.ts': [
    'completeOnboarding',
    'upsertOrgSettings',
  ],
  'src/actions/packs.ts': [
    'createPackAction',
    'dismissPackAlertAction',
    'dismissVisitReconcileAction',
    'logCustomerContactAction',
    'redeemSessionAction',
    'setLifecycleAction',
    'setPackStatusAction', // UNSURE: no production caller found through this export.
    'undoRedemptionAction',
  ],
  'src/actions/permissions.ts': [
    'getStaffPermissions',
    'setStaffPermissions',
  ],
  'src/actions/recording-autostart.ts': [
    'setRecordingAutostart',
  ],
  'src/actions/recording-discard-transcript.ts': [
    'persistDiscardTranscript',
    'transcribeAndPersistDiscard',
  ],
  'src/actions/recording-discard.ts': [
    'discardRecordingReceipt', // UNSURE: no production caller found through this export.
    'discardRecordingWithReason',
  ],
  'src/actions/recording-discards.ts': [
    'getDiscardTranscript',
    'listDiscardReasons',
    'myDiscardCountThisMonth',
  ],
  'src/actions/recording-jobs.ts': [
    'enqueueRecordingJob',
    'enqueueRecordingJobFromSession',
    'getRecordingJobStatus',
  ],
  'src/actions/recording-playback.ts': [
    'mintRecordingPlaybackUrl',
  ],
  'src/actions/recording-share.ts': [
    'setRecordingShared',
  ],
  'src/actions/recording-upload.ts': [
    'mintRecordingReadUrl',
    'mintRecordingSegmentUrls',
    'mintRecordingUploadUrl',
    'recordingFinalizedKey',
  ],
  'src/actions/recordings-inbox.ts': [
    'listRecordingsInbox',
  ],
  'src/actions/recordings.ts': [
    'deleteRecordingSession', // UNSURE: no production caller found through this export.
    'finalizeTake',
    'startRecordingSession',
  ],
  'src/actions/recovery.ts': [
    'getRecoveryDayFacts',
  ],
  'src/actions/regenerate-karute.ts': [
    'listCustomerKaruteForRegen',
    'regenerateKarute',
    'regenerateKaruteEntries',
    'updateKaruteSummary',
  ],
  'src/actions/staff-pin.ts': [
    'hasStaffPin', // UNSURE: no production caller found through this export.
    'removeStaffPin',
    'setStaffPin',
    'verifyStaffPin', // UNSURE: no production caller found through this export.
  ],
  'src/actions/staff.ts': [
    'createStaff',
    'deleteStaff',
    'updateStaff',
    'uploadStaffAvatar',
  ],
  'src/actions/stores.ts': [
    'clearActiveStore', // UNSURE: no production caller found through this export.
    'createStore',
    'getActiveStoreId',
    'getDefaultStoreId', // UNSURE: no production caller found through this export.
    'getStaffStores',
    'listStores',
    'listStoresWithHours',
    'setActiveStore',
    'setStaffStores',
    'setStoreHours',
    'updateStore',
  ],
  'src/actions/voice.ts': [
    'enrollVoiceAction',
    'revokeVoiceAction',
  ],
}

export const INTERNAL_DEBT: Record<string, string[]> = {
  'src/actions/appointments-window.ts': [
    'getAppointmentWindow',
  ],
  'src/actions/appointments.ts': [
    'getAppointmentById',
    'getAppointmentsByDate',
  ],
  'src/actions/audit-log.ts': [
    'listAuditLogWithClient',
  ],
  'src/actions/customers.ts': [
    'cancelCustomerDeletionWithClient',
    'createCustomerWithClient',
    'createQuickCustomerWithClient',
    'grantCustomerConsentWithClient',
    'revokeCustomerConsentWithClient',
    'scheduleCustomerDeletionWithClient',
    'updateCustomerWithClient',
    'uploadCustomerPhotoWithClient',
  ],
  'src/actions/dev-tools.ts': [
  ],
  'src/actions/entitlements.ts': [
  ],
  'src/actions/invites.ts': [
    'createInviteCore',
    'getInviteByToken',
    'listInvitesWithClient',
    'reinviteTargetStaffIdWithClient',
    'revokeInviteCore',
  ],
  'src/actions/karute-outcome.ts': [
  ],
  'src/actions/karute.ts': [
    'createManualKaruteRecordWithClient',
    'createOrUpdateKaruteRecord',
    'getCustomerKaruteRecords',
    'getCustomerKaruteRecordsWithClient',
    'listEntryEditHistoryWithClient',
    'reassignKaruteCustomerWithClient',
    'updateKaruteDetailEntryWithClient',
    'updateKaruteDetailSummaryWithClient',
  ],
  'src/actions/memory.ts': [
    'addMemoryItemWithClient',
    'deleteMemoryItemWithClient',
    'relearnCustomerMemoryWithClient',
    'toggleMemoryPinWithClient',
    'updateMemoryItemWithClient',
    'upsertPassportFieldWithClient',
  ],
  'src/actions/menus.ts': [
    'listMenus',
  ],
  'src/actions/org-settings.ts': [
    'getOrgSettings',
    'orgSettingsWithClient',
    'writeOrgSettingsBlobWithClient',
  ],
  'src/actions/packs.ts': [
    'createPackActionWithClient',
    'dismissPackAlertActionWithClient',
    'dismissVisitReconcileActionWithClient',
    'logCustomerContactActionWithClient',
    'redeemSessionActionWithClient',
    'setLifecycleActionWithClient',
  ],
  'src/actions/permissions.ts': [
    'getStaffPermissionsCore',
    'setStaffPermissionsCore',
  ],
  'src/actions/recording-autostart.ts': [
  ],
  'src/actions/recording-discard-transcript.ts': [
    'persistDiscardTranscriptWithClient',
    'transcribeAndPersistDiscardWithClient',
  ],
  'src/actions/recording-discard.ts': [
  ],
  'src/actions/recording-discards.ts': [
    'getDiscardTranscriptWithClient',
    'listDiscardReasonsWithClient',
  ],
  'src/actions/recording-jobs.ts': [
  ],
  'src/actions/recording-playback.ts': [
  ],
  'src/actions/recording-share.ts': [
  ],
  'src/actions/recording-upload.ts': [
  ],
  'src/actions/recordings-inbox.ts': [
  ],
  'src/actions/recordings.ts': [
  ],
  'src/actions/recovery.ts': [
  ],
  'src/actions/regenerate-karute.ts': [
    'regenerateKaruteEntriesWithClient',
    'regenerateKaruteWithClient',
    'updateKaruteSummaryWithClient',
  ],
  'src/actions/staff-pin.ts': [
    'removeStaffPinCore',
    'setStaffPinCore',
  ],
  'src/actions/staff.ts': [
    'createStaffCore',
    'deleteStaffCore',
    'updateStaffCore',
    'uploadStaffAvatarCore',
  ],
  'src/actions/stores.ts': [
    'createStoreCore',
    'updateStoreCore',
    // 2026-09-20: arrived with #938 before this ratchet was on main; leaves with the stores cores in repair B
    'setStoreHoursCore',
    'getPrimaryStoreId',
    'getStaffStoresStrict',
    'getStaffStoresWithClient',
    'listStoresWithClient',
    'setStaffStoresAtCreationCore',
    'setStaffStoresCore',
  ],
  'src/actions/voice.ts': [
    'enrollVoiceActionCore',
    'revokeVoiceActionCore',
  ],
}
