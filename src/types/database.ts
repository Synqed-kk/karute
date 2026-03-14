export type ProfileRole = 'admin' | 'staff'

export interface Profile {
  id: string
  full_name: string | null
  role: ProfileRole
  created_at: string
}

export interface Customer {
  id: string
  name: string
  furigana: string | null
  phone: string | null
  email: string | null
  contact_info: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface KaruteRecord {
  id: string
  customer_id: string
  staff_id: string | null
  transcript: string | null
  summary: string | null
  duration: number | null
  created_at: string
  updated_at: string
}

export interface Entry {
  id: string
  karute_record_id: string
  category: string
  content: string
  source_quote: string | null
  confidence_score: number | null
  is_manual: boolean
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: { id?: string; full_name?: string | null; role?: ProfileRole }
        Update: Partial<Profile>
        Relationships: []
      }
      customers: {
        Row: Customer
        Insert: Omit<Customer, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Customer>
        Relationships: []
      }
      karute_records: {
        Row: KaruteRecord
        Insert: Omit<KaruteRecord, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<KaruteRecord>
        Relationships: [
          {
            foreignKeyName: 'karute_records_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
        ]
      }
      entries: {
        Row: Entry
        Insert: Omit<Entry, 'id' | 'created_at'>
        Update: Partial<Entry>
        Relationships: [
          {
            foreignKeyName: 'entries_karute_record_id_fkey'
            columns: ['karute_record_id']
            isOneToOne: false
            referencedRelation: 'karute_records'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
