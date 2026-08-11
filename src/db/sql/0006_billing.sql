-- Billing: grant_credits() ledger function, RLS for plans/stripe_events,
-- and the seed plan catalog. Idempotent where practical.

-- ---------------------------------------------------------------------------
-- grant_credits — sibling to reserve_credits/refund_credits. Used by the
-- Stripe webhook (signup bonus already has its own inline insert in
-- handle_new_user; this is for purchases/renewals/admin grants).
-- ---------------------------------------------------------------------------

create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount int,
  p_note text default null
) returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount <= 0 then
    raise exception 'grant amount must be positive';
  end if;

  select credit_balance into v_balance
  from profiles where id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'profile not found';
  end if;

  v_balance := v_balance + p_amount;

  update profiles set credit_balance = v_balance where id = p_user_id;

  insert into credit_transactions (user_id, delta, kind, balance_after, note)
  values (p_user_id, p_amount, 'grant', v_balance, p_note);

  return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.stripe_events enable row level security;

-- plans: public catalog, same posture as models/presets
drop policy if exists "plans_select_all" on public.plans;
create policy "plans_select_all" on public.plans
  for select using (enabled);

-- stripe_events: no policies at all — RLS enabled with zero policies means
-- even authenticated/anon reads are denied. Only the service role (which
-- bypasses RLS) ever touches this table, from the webhook handler.

-- Billing columns on profiles are never client-writable — column-level
-- privilege, same posture as credit_balance. The existing grant already
-- restricts UPDATE to (username, avatar_url) only, so nothing to add here;
-- this comment exists so the invariant is easy to find when auditing.

-- ---------------------------------------------------------------------------
-- Seed plan catalog. stripe_price_id is NULL until the matching Stripe
-- Price object exists — checkout blocks with a clear error until then.
-- ---------------------------------------------------------------------------

insert into plans (name, kind, credits, price_usd_cents, interval, sort_order)
select * from (values
  ('Starter', 'subscription'::plan_kind, 500, 1500, 'month', 10),
  ('Plus', 'subscription'::plan_kind, 1500, 3900, 'month', 20),
  ('Pro', 'subscription'::plan_kind, 4500, 9900, 'month', 30),
  ('300 Credits', 'credit_pack'::plan_kind, 300, 1000, null, 100)
) as v(name, kind, credits, price_usd_cents, interval, sort_order)
where not exists (select 1 from plans where plans.name = v.name);
