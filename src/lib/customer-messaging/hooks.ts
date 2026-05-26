'use client'

// ─────────────────────────────────────────────────────────────
// Customer messaging mutations — scaffold layer
// ─────────────────────────────────────────────────────────────
// Lifted from spike: src/lib/customer-messaging.ts (mutations
// section). Karute version is a SCAFFOLD — `logMessage` is a
// no-op that records to console so the dialog flow works
// end-to-end during development. Anthony's Supabase swap is
// documented inline so the wiring is one PR.
//
// PROD SWAP (ANTHONY)
// -------------------
// logMessage() inserts a row in a `customer_messages` table
// scoped by RLS to (recipient_id = customer_id, salon = the
// signed-in user's business_id). Schema sketch:
//
//   customer_messages (
//     id            uuid pk,
//     customer_id   uuid fk customers(id),
//     business_id   uuid fk businesses(id),
//     staff_id      uuid fk staff(id),    -- who clicked send
//     channel       text  -- 'line' | 'sms' | 'email' | 'other'
//     body          text,
//     source        text  -- 'karute_followup' | 'dashboard_ai_action' | 'manual'
//     ai_drafted    bool default false,
//     ai_action_id  uuid null,  -- links to ai_actions(id)
//     marked_sent_at timestamptz null,  -- null = copy-only draft
//     created_at    timestamptz default now()
//   )
//
//   create policy "salon writes own messages"
//     on customer_messages for insert with check (
//       business_id = (select business_id from staff
//                      where user_id = auth.uid())
//       and staff_id = (select id from staff
//                       where user_id = auth.uid())
//     );
//
//   create policy "salon reads own messages"
//     on customer_messages for select using (
//       business_id = (select business_id from staff
//                      where user_id = auth.uid())
//     );
//
// AI actions integration: when `aiActionId` is set + markSent
// is true, also flip the ai_actions row's resolved_at so the
// dashboard backlog clears itself.

import { useCallback } from 'react'

import type { LogMessageInput } from './types'

export function useMessagingMutations() {
  const logMessage = useCallback((input: LogMessageInput) => {
    // Scaffold: log to console so dev can verify the flow.
    // Real impl: supabase.from('customer_messages').insert(...)
    if (typeof window !== 'undefined') {
      console.info('[scaffold] logMessage', input)
    }
  }, [])

  return { logMessage }
}
