-- =============================================================
-- 0032 — Luxedge Sales (Sales & Profit Management module)
-- =============================================================
-- Adds ONLY the manual financial/operations layer for the
-- "Luxedge Sales" admin module. Existing tables are untouched:
--
--   * luxedge_orders stays the source of truth for order facts
--     (order_number, items snapshot, totals, payment status,
--     Stripe-authoritative refunded_amount). Nothing here copies
--     or overrides those historical values.
--
--   * order_financials is a 1:1 sidecar keyed by order_id holding
--     ONLY the fields the owner enters by hand (product cost,
--     shipping cost, payment fee, other expense, refund note,
--     supplier ops). NULL refund_amount = "use the provider's
--     refunded_amount"; a value here is an explicit override
--     (e.g. an out-of-band refund), never a double count.
--
--   * ops_status is the operational status shown in the Sales
--     module (e.g. 'ordered_from_supplier' — a supplier stage that
--     is not part of the payment lifecycle). NULL = follow
--     luxedge_orders.status. The webhook-owned status column is
--     never written by the Sales module.
--
--   * business_expenses holds general (non-order) business
--     expenses with soft deletion (deleted_at) so historical
--     reports never silently lose rows.
--
-- SECURITY: both tables are admin-only (same RLS pattern as
-- luxedge_orders: app_metadata.role = 'admin'). No public route
-- exposes them; the admin API uses the service-role key server
-- side only. No floating-point money: numeric(12,2) everywhere.
-- =============================================================

create table if not exists public.order_financials (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.luxedge_orders(id) on delete cascade,
  product_cost numeric(12,2) not null default 0 check (product_cost >= 0),
  shipping_cost numeric(12,2) not null default 0 check (shipping_cost >= 0),
  payment_fee numeric(12,2) not null default 0 check (payment_fee >= 0),
  other_expense numeric(12,2) not null default 0 check (other_expense >= 0),
  -- NULL = use luxedge_orders.refunded_amount (payment-provider truth).
  -- A value here is an explicit manual override of the refund amount.
  refund_amount numeric(12,2) check (refund_amount is null or refund_amount >= 0),
  -- NULL = display luxedge_orders.status. Set when the ops stage differs
  -- (e.g. 'ordered_from_supplier'). Never writes back to luxedge_orders.
  ops_status text check (
    ops_status is null or ops_status in (
      'pending','paid','processing','ordered_from_supplier','shipped',
      'delivered','cancelled','partially_refunded','refunded'
    )
  ),
  supplier text,
  supplier_order_number text,
  tracking_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_financials_updated_at_idx
  on public.order_financials(updated_at desc);

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null check (
    category in (
      'Advertising','Software','Hosting','Domain','Supplier','Shipping',
      'Payment Fees','Bank Fees','Contractor','Office',
      'Professional Services','Miscellaneous'
    )
  ),
  description text not null default '',
  amount numeric(12,2) not null check (amount >= 0),
  payment_method text,
  receipt_url text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_expenses_date_idx
  on public.business_expenses(expense_date desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- RLS — admin only, both tables (same claim the admin panel already uses).
-- Customers and anon can never read financial data.
-- ---------------------------------------------------------------------------
alter table public.order_financials enable row level security;
alter table public.business_expenses enable row level security;

drop policy if exists "owner all order_financials" on public.order_financials;
create policy "owner all order_financials" on public.order_financials
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "owner all business_expenses" on public.business_expenses;
create policy "owner all business_expenses" on public.business_expenses
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- updated_at maintenance (per-table function naming, same style as
-- blog_touch_updated_at / media_touch_updated_at in 0022/0026).
create or replace function public.sales_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists order_financials_touch on public.order_financials;
create trigger order_financials_touch
  before update on public.order_financials
  for each row execute function public.sales_touch_updated_at();

drop trigger if exists business_expenses_touch on public.business_expenses;
create trigger business_expenses_touch
  before update on public.business_expenses
  for each row execute function public.sales_touch_updated_at();
