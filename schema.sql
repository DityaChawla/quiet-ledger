-- ═══════════════════════════════════════════════════════════════
-- Quiet Ledger · Supabase schema + Row-Level Security
-- Paste this whole file into Supabase → SQL Editor → Run.
-- It creates the tables, the security rules, and the invite flow.
-- ═══════════════════════════════════════════════════════════════

-- ── profiles (one row per user, mirrors auth.users) ────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz default now()
);

-- auto-create a profile whenever someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── spaces (a shared pot: Household, Personal, Roommates…) ──────
create table if not exists public.spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null default 'family' check (type in ('family','roommates')),
  currency    text not null default '₹',
  income      numeric not null default 0,
  savings_pct numeric not null default 0,
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz default now()
);

-- ── membership (who is in a space, and what they can do) ────────
create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     text not null default 'member' check (role in ('owner','member','viewer')),
  added_at timestamptz default now(),
  primary key (space_id, user_id)
);

-- when a space is created, its creator becomes the owner
create or replace function public.handle_new_space()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.space_members (space_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists on_space_created on public.spaces;
create trigger on_space_created
  after insert on public.spaces
  for each row execute function public.handle_new_space();

-- ── transactions (the ledger) ──────────────────────────────────
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  amount      numeric not null check (amount > 0),
  category    text not null,
  note        text,
  occurred_on date not null default current_date,
  paid_by     uuid references auth.users(id),   -- used by roommates/split spaces
  is_fixed    boolean not null default false,
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz default now()
);
create index if not exists tx_space_date on public.transactions(space_id, occurred_on desc);

-- ── fixed expenses (recurring commitments per space) ───────────
create table if not exists public.space_fixed (
  id       uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name     text not null,
  amount   numeric not null default 0,
  category text not null default 'bills'
);

-- ── category budget overrides (per space) ──────────────────────
create table if not exists public.space_budgets (
  space_id uuid not null references public.spaces(id) on delete cascade,
  category text not null,
  amount   numeric not null,
  primary key (space_id, category)
);

-- ── invites (share a space by email) ───────────────────────────
create table if not exists public.space_invites (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces(id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('member','viewer')),
  invited_by uuid not null default auth.uid() references auth.users(id),
  accepted   boolean not null default false,
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
-- Security helpers (SECURITY DEFINER so they bypass RLS and never
-- recurse). Every policy below is expressed in terms of these.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.is_space_member(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.space_members
                 where space_id = sid and user_id = auth.uid());
$$;

create or replace function public.is_space_editor(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.space_members
                 where space_id = sid and user_id = auth.uid()
                 and role in ('owner','member'));
$$;

create or replace function public.is_space_owner(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.space_members
                 where space_id = sid and user_id = auth.uid() and role = 'owner');
$$;

-- accept an invite addressed to the signed-in user's email
create or replace function public.accept_invite(p_invite uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_space uuid; v_role text; v_email text;
begin
  select space_id, role, email into v_space, v_role, v_email
  from public.space_invites where id = p_invite and accepted = false;
  if v_space is null then raise exception 'Invite not found or already used'; end if;
  if lower(v_email) <> lower(auth.jwt()->>'email') then
    raise exception 'This invite is for a different email';
  end if;
  insert into public.space_members (space_id, user_id, role)
  values (v_space, auth.uid(), v_role) on conflict do nothing;
  update public.space_invites set accepted = true where id = p_invite;
  return v_space;
end; $$;

-- ═══════════════════════════════════════════════════════════════
-- Enable RLS and define policies. Nobody sees a row unless they
-- belong to that space. This is enforced by the database, not app.
-- ═══════════════════════════════════════════════════════════════
alter table public.profiles      enable row level security;
alter table public.spaces        enable row level security;
alter table public.space_members enable row level security;
alter table public.transactions  enable row level security;
alter table public.space_fixed   enable row level security;
alter table public.space_budgets enable row level security;
alter table public.space_invites enable row level security;

-- profiles: you can read profiles of people who share a space, edit only your own
create policy "read own or co-member profiles" on public.profiles for select
  using (id = auth.uid() or exists (
    select 1 from public.space_members m1
    join public.space_members m2 on m1.space_id = m2.space_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id));
create policy "update own profile" on public.profiles for update using (id = auth.uid());

-- spaces
create policy "members read spaces"  on public.spaces for select using (is_space_member(id));
create policy "create spaces"        on public.spaces for insert with check (created_by = auth.uid());
create policy "editors update space" on public.spaces for update using (is_space_editor(id));
create policy "owner deletes space"  on public.spaces for delete using (is_space_owner(id));

-- space_members
create policy "read memberships"   on public.space_members for select
  using (user_id = auth.uid() or is_space_member(space_id));
create policy "owner adds members" on public.space_members for insert with check (is_space_owner(space_id));
create policy "owner edits members" on public.space_members for update using (is_space_owner(space_id));
create policy "leave or owner removes" on public.space_members for delete
  using (user_id = auth.uid() or is_space_owner(space_id));

-- transactions / fixed / budgets: members read, editors write
create policy "members read tx"   on public.transactions for select using (is_space_member(space_id));
create policy "editors write tx"  on public.transactions for insert with check (is_space_editor(space_id));
create policy "editors update tx" on public.transactions for update using (is_space_editor(space_id));
create policy "editors delete tx" on public.transactions for delete using (is_space_editor(space_id));

create policy "members read fixed"  on public.space_fixed for select using (is_space_member(space_id));
create policy "editors write fixed" on public.space_fixed for all
  using (is_space_editor(space_id)) with check (is_space_editor(space_id));

create policy "members read budgets"  on public.space_budgets for select using (is_space_member(space_id));
create policy "editors write budgets" on public.space_budgets for all
  using (is_space_editor(space_id)) with check (is_space_editor(space_id));

-- invites: members + the invited email can see; owners create/revoke
create policy "read invites" on public.space_invites for select
  using (is_space_member(space_id) or lower(email) = lower(auth.jwt()->>'email'));
create policy "owner creates invite" on public.space_invites for insert with check (is_space_owner(space_id));
create policy "owner revokes invite" on public.space_invites for delete using (is_space_owner(space_id));

-- ── realtime: co-members see each other's changes live ─────────
alter publication supabase_realtime add table public.transactions;
alter publication supabase_realtime add table public.space_fixed;
alter publication supabase_realtime add table public.space_budgets;
