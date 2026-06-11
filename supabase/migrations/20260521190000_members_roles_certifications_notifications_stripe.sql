-- Oxalys shared schema update.
-- Run this once on the Supabase project used by Oxalys, OxalysTeach and OxalysMonitor.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.membre') is null and to_regclass('public.etudiant') is not null then
    alter table public.etudiant rename to membre;
  end if;
end $$;

alter table if exists public.membre
  add column if not exists is_technicien boolean not null default false,
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_professeur boolean not null default false,
  add column if not exists certification_status text not null default 'pending',
  add column if not exists certification_requested_at timestamptz,
  add column if not exists certification_reviewed_at timestamptz,
  add column if not exists certification_reviewed_by uuid,
  add column if not exists notification_preferences jsonb not null default jsonb_build_object(
    'app', true,
    'email', true,
    'sms', false,
    'professorOrange', false,
    'technicianAllThresholds', true
  ),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists subscription_plan text,
  add column if not exists subscription_current_period_end timestamptz;

do $$
begin
  if to_regclass('public.etudiant') is null and to_regclass('public.membre') is not null then
    create view public.etudiant as select * from public.membre;
  end if;
end $$;

create table if not exists public.membre_certification_requests (
  id uuid primary key default gen_random_uuid(),
  membre_id uuid not null,
  fablab_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  reviewer_role text,
  reason text,
  payload jsonb not null default '{}'::jsonb
);

create unique index if not exists membre_certification_pending_once
  on public.membre_certification_requests (membre_id, fablab_id)
  where status = 'pending';

create index if not exists membre_certification_fablab_status_idx
  on public.membre_certification_requests (fablab_id, status, requested_at desc);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  fablab_id uuid not null,
  membre_id uuid,
  audience_role text not null check (audience_role in ('student', 'professor', 'technician')),
  title text not null,
  message text not null,
  threshold_from text,
  threshold_to text not null,
  channels jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notification_events_fablab_created_idx
  on public.notification_events (fablab_id, created_at desc);

create index if not exists notification_events_membre_created_idx
  on public.notification_events (membre_id, created_at desc);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.notification_events(id) on delete cascade,
  channel text not null check (channel in ('app', 'email', 'sms')),
  recipient text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  provider text,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.fablab_logs (
  id uuid primary key default gen_random_uuid(),
  fablab_id uuid,
  actor_id uuid,
  actor_role text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fablab_logs_fablab_created_idx
  on public.fablab_logs (fablab_id, created_at desc);

create index if not exists fablab_logs_created_idx
  on public.fablab_logs (created_at desc);

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table if exists public.membre enable row level security;
alter table if exists public.membre_certification_requests enable row level security;
alter table if exists public.notification_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'membre' and policyname = 'membre_select_self'
  ) then
    create policy membre_select_self on public.membre
      for select using (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'membre' and policyname = 'membre_update_self_preferences'
  ) then
    create policy membre_update_self_preferences on public.membre
      for update using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notification_events' and policyname = 'notifications_select_self'
  ) then
    create policy notifications_select_self on public.notification_events
      for select using (membre_id = auth.uid());
  end if;
end $$;
