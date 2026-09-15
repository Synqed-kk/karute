# CORE-6 family pack balances

Paired with the Synqed Core CORE-6 branch, built on CORE-12. Core adds eligible customer IDs on active packs and a full usage snapshot on individual pack-list rows. The existing SDK transports those additive fields; this patch validates optional bulk IDs and extends the local pack DTO, retaining the old-response fallback.

Every family member sees the shared remaining/size badge and usable pack ID. Individual pack pickers use all visitors’ usage, while visit/reassignment reads remain visitor-only. Bulk unconsumed value and holder counts remain with the actual holder so household size cannot inflate financial totals.

Deploy Core’s migration/API first, then this consumer. Existing Core responses continue working. No real family identities are guessed or merged by this change. Group configuration and production seeding are separate operator steps through Core’s HQ-authorized endpoint.
