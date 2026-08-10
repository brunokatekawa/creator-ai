-- Applied after the Drizzle-generated DDL. Contains everything Drizzle can't
-- express: cross-schema FKs, the signup trigger, RLS, and the credit ledger
-- functions. Idempotent where practical.

-- ---------------------------------------------------------------------------
-- Cross-schema / circular FKs
-- ---------------------------------------------------------------------------

alter table public.profiles
  add constraint profiles_auth_user_fk
  foreign key (id) references auth.users(id) on delete cascade;

alter table public.credit_transactions
  add constraint credit_tx_generation_fk
  foreign key (generation_id) references public.generations(id) on delete set null;

alter table public.generations
  add constraint generations_character_fk
  foreign key (character_id) references public.characters(id) on delete set null;

alter table public.generations
  add constraint generations_source_asset_fk
  foreign key (source_asset_id) references public.assets(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Signup trigger: create profile + starter credit grant (100 credits)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, credit_balance)
  values (new.id, 100);

  insert into public.credit_transactions (user_id, delta, kind, balance_after, note)
  values (new.id, 100, 'grant', 100, 'signup bonus');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Credit ledger functions. The ONLY writers of credit_balance.
-- SECURITY DEFINER so RLS doesn't block them; row lock prevents lost updates.
-- ---------------------------------------------------------------------------

-- Reserve credits when a generation is submitted. Raises on insufficient funds.
create or replace function public.reserve_credits(
  p_user_id uuid,
  p_amount int,
  p_generation_id uuid
) returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount <= 0 then
    raise exception 'reserve amount must be positive';
  end if;

  select credit_balance into v_balance
  from profiles where id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'profile not found';
  end if;

  if v_balance < p_amount then
    raise exception 'insufficient credits: have %, need %', v_balance, p_amount;
  end if;

  v_balance := v_balance - p_amount;

  update profiles set credit_balance = v_balance where id = p_user_id;

  insert into credit_transactions (user_id, delta, kind, balance_after, generation_id)
  values (p_user_id, -p_amount, 'reserve', v_balance, p_generation_id);

  return v_balance;
end;
$$;

-- Settle a reserve after success. Zero-delta ledger marker for auditability.
create or replace function public.settle_credits(p_generation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_balance int;
begin
  select user_id into v_user_id from generations where id = p_generation_id;
  if v_user_id is null then
    raise exception 'generation not found';
  end if;

  -- Guard against double-settle / settle-after-refund
  if exists (
    select 1 from credit_transactions
    where generation_id = p_generation_id and kind in ('settle', 'refund')
  ) then
    return;
  end if;

  select credit_balance into v_balance from profiles where id = v_user_id for update;

  insert into credit_transactions (user_id, delta, kind, balance_after, generation_id)
  values (v_user_id, 0, 'settle', v_balance, p_generation_id);
end;
$$;

-- Refund the reserve after failure. A failed generation never costs credits.
create or replace function public.refund_credits(p_generation_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_reserved int;
  v_balance int;
begin
  select user_id, credits_reserved into v_user_id, v_reserved
  from generations where id = p_generation_id;

  if v_user_id is null then
    raise exception 'generation not found';
  end if;

  -- Guard against double-refund / refund-after-settle
  if exists (
    select 1 from credit_transactions
    where generation_id = p_generation_id and kind in ('settle', 'refund')
  ) then
    select credit_balance into v_balance from profiles where id = v_user_id;
    return v_balance;
  end if;

  select credit_balance into v_balance from profiles where id = v_user_id for update;

  v_balance := v_balance + v_reserved;

  update profiles set credit_balance = v_balance where id = v_user_id;

  insert into credit_transactions (user_id, delta, kind, balance_after, generation_id)
  values (v_user_id, v_reserved, 'refund', v_balance, p_generation_id);

  return v_balance;
end;
$$;

-- Daily spend guard: credits reserved by this user in the trailing 24h.
create or replace function public.credits_spent_today(p_user_id uuid)
returns int
language sql
security definer set search_path = public
as $$
  select coalesce(-sum(delta), 0)::int
  from credit_transactions
  where user_id = p_user_id
    and kind = 'reserve'
    and created_at > now() - interval '24 hours';
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.models enable row level security;
alter table public.presets enable row level security;
alter table public.generations enable row level security;
alter table public.assets enable row level security;
alter table public.characters enable row level security;
alter table public.character_images enable row level security;

-- profiles: read/update own row (balance writes only via functions above)
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Balance and plan are never client-writable — column-level privilege, not RLS
revoke update on public.profiles from authenticated, anon;
grant update (username, avatar_url) on public.profiles to authenticated;

-- ledger: read own, never write from client
create policy "credit_tx_select_own" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- catalog: readable by everyone (drives public marketing/preset pages)
create policy "models_select_all" on public.models
  for select using (enabled);
create policy "presets_select_all" on public.presets
  for select using (enabled);

-- generations: own rows only; inserts happen server-side with the user's
-- session, so an INSERT policy is required. Status transitions are made by
-- the service role (webhook/cron), which bypasses RLS.
create policy "generations_select_own" on public.generations
  for select using (auth.uid() = user_id);
create policy "generations_insert_own" on public.generations
  for insert with check (auth.uid() = user_id);

-- assets: own rows; written by service role in the webhook
create policy "assets_select_own" on public.assets
  for select using (auth.uid() = user_id);

-- characters: full CRUD on own rows
create policy "characters_select_own" on public.characters
  for select using (auth.uid() = user_id);
create policy "characters_insert_own" on public.characters
  for insert with check (auth.uid() = user_id);
create policy "characters_update_own" on public.characters
  for update using (auth.uid() = user_id);
create policy "characters_delete_own" on public.characters
  for delete using (auth.uid() = user_id);

create policy "character_images_select_own" on public.character_images
  for select using (
    exists (select 1 from public.characters c where c.id = character_id and c.user_id = auth.uid())
  );
create policy "character_images_insert_own" on public.character_images
  for insert with check (
    exists (select 1 from public.characters c where c.id = character_id and c.user_id = auth.uid())
  );
create policy "character_images_delete_own" on public.character_images
  for delete using (
    exists (select 1 from public.characters c where c.id = character_id and c.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Realtime: stream generation status changes to the studio UI
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.generations;

-- ---------------------------------------------------------------------------
-- Storage buckets (private; served via signed URLs)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('assets', 'assets', false), ('training', 'training', false)
on conflict (id) do nothing;

create policy "assets_bucket_read_own" on storage.objects
  for select using (
    bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "training_bucket_rw_own" on storage.objects
  for all using (
    bucket_id = 'training' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'training' and (storage.foldername(name))[1] = auth.uid()::text
  );
