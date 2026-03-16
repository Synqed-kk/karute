-- Appointments: a booking on the timeline for a staff member + customer
create table if not exists appointments (
  id uuid default gen_random_uuid() primary key,
  staff_profile_id uuid references profiles(id) on delete cascade not null,
  client_id uuid references customers(id) on delete cascade not null,
  start_time timestamptz not null,
  duration_minutes integer not null default 60,
  title text,
  notes text,
  karute_record_id uuid references karute_records(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table appointments enable row level security;

create policy "Authenticated users can read appointments"
  on appointments for select to authenticated using (true);
create policy "Authenticated users can insert appointments"
  on appointments for insert to authenticated with check (true);
create policy "Authenticated users can update appointments"
  on appointments for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete appointments"
  on appointments for delete to authenticated using (true);

create trigger update_appointments_updated_at before update on appointments
  for each row execute procedure update_updated_at_column();

-- Add role column to profiles for OWNER/STYLIST display
alter table profiles add column if not exists display_role text default 'staff';
