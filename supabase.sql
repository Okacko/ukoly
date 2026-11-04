-- Spusť jednou v Supabase → SQL Editor (New query → vlož → Run).
-- Vytvoří tabulku pro ZAŠIFROVANÝ stav aplikace (jeden řádek na uživatele)
-- a zapne Row Level Security, aby každý viděl a měnil jen svoje data.

create table if not exists public.app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  salt       text   not null,  -- veřejná sůl pro odvození klíče (není tajná)
  iv         text   not null,  -- inicializační vektor AES-GCM
  ciphertext text   not null,  -- zašifrovaná data (obsah úkolů Supabase nevidí)
  updated_at bigint not null default 0,  -- čas poslední změny (pro porovnání zařízení)
  modified   timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Každý smí jen svůj řádek (auth.uid() = přihlášený uživatel)
create policy "own_select" on public.app_state for select using (auth.uid() = user_id);
create policy "own_insert" on public.app_state for insert with check (auth.uid() = user_id);
create policy "own_update" on public.app_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.app_state for delete using (auth.uid() = user_id);

-- Přístup přes API má jen přihlášený uživatel; anonymní roli ber vše
grant select, insert, update, delete on public.app_state to authenticated;
revoke all on public.app_state from anon;

-- Živá synchronizace (realtime) mezi zařízeními – nepovinné.
-- Když to při opakovaném spuštění hlásí, že tabulka už v publikaci je, klidně ignoruj.
alter publication supabase_realtime add table public.app_state;
