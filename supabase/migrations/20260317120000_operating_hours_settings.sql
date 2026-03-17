-- Add per-day operating hours to organization settings.

create table if not exists organization_settings (
  id uuid default gen_random_uuid() primary key,
  owner_profile_id uuid references profiles(id) on delete cascade not null,
  salon_name text default '' not null,
  business_type text default 'other' not null,
  webhook_url text default '' not null,
  ai_model text default 'gpt-4o-mini' not null,
  confidence_threshold numeric(3,2) default 0.7 not null,
  audio_quality text default 'standard' not null,
  auto_stop_minutes integer default 30 not null,
  operating_hours jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table organization_settings
  add column if not exists operating_hours jsonb;

alter table organization_settings
  alter column operating_hours set default '{
    "mon": {"openMinute": 600, "closeMinute": 1440},
    "tue": {"openMinute": 600, "closeMinute": 1440},
    "wed": {"openMinute": 600, "closeMinute": 1440},
    "thu": {"openMinute": 600, "closeMinute": 1440},
    "fri": {"openMinute": 600, "closeMinute": 1440},
    "sat": {"openMinute": 600, "closeMinute": 1440},
    "sun": {"openMinute": 600, "closeMinute": 1440}
  }'::jsonb;

update organization_settings
set operating_hours = '{
  "mon": {"openMinute": 600, "closeMinute": 1440},
  "tue": {"openMinute": 600, "closeMinute": 1440},
  "wed": {"openMinute": 600, "closeMinute": 1440},
  "thu": {"openMinute": 600, "closeMinute": 1440},
  "fri": {"openMinute": 600, "closeMinute": 1440},
  "sat": {"openMinute": 600, "closeMinute": 1440},
  "sun": {"openMinute": 600, "closeMinute": 1440}
}'::jsonb
where operating_hours is null;

alter table organization_settings
  alter column operating_hours set not null;
