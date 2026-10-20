-- Bookingflyt: grunnskjema
-- Kjøres i Supabase: SQL Editor → lim inn hele filen → Run.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Typer
-- ─────────────────────────────────────────────────────────────
create type request_status as enum ('ny', 'kontaktet', 'tilbud', 'bekreftet', 'avslatt');
create type customer_type  as enum ('privat', 'bedrift');
create type booking_type   as enum ('heldag', 'avtales');
create type member_role    as enum ('eier', 'admin', 'medarbeider');

-- ─────────────────────────────────────────────────────────────
-- Bedrifter (InnSpæll, kjsn …)
-- ─────────────────────────────────────────────────────────────
create table organizations (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name             text not null,
  domain           text,
  brand_color      text not null default '#2f5d50' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  widget_heading   text not null default 'Fortell oss hva du planlegger',
  widget_intro     text,
  allowed_origins  text[] not null default '{}',   -- nettsider som får bruke widgeten
  notify_email     text,                            -- hvem som får varsel om nye forespørsler
  reply_from_email text,                            -- avsender på e-post til kunder
  fiken_company_slug text,                          -- selskapets "slug" i Fiken
  created_at       timestamptz not null default now()
);

-- Hemmeligheter holdes i egen tabell uten policyer: kun serveren (service role) kan lese.
create table organization_secrets (
  org_id      uuid primary key references organizations(id) on delete cascade,
  fiken_token text,
  updated_at  timestamptz not null default now()
);

create table members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null default 'admin',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ─────────────────────────────────────────────────────────────
-- Produkter / tjenester
-- ─────────────────────────────────────────────────────────────
create table products (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  category     text not null check (category in ('Film', 'Foto', 'Foto + video')),
  name         text not null check (length(name) between 1 and 120),
  booking_type booking_type not null default 'avtales',
  price_ex_vat numeric(12,2) check (price_ex_vat >= 0),
  vat_rate     smallint not null default 25 check (vat_rate in (0, 12, 15, 25)),
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index on products (org_id, active, category, sort_order);

-- ─────────────────────────────────────────────────────────────
-- Forespørsler (kortene på tavla)
-- ─────────────────────────────────────────────────────────────
create table requests (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  status         request_status not null default 'ny',

  -- hva kunden ba om
  product_id     uuid references products(id) on delete set null,
  category       text,                 -- kategori kunden valgte (inkl. 'Annet')
  other_text     text,                 -- "Annet: …"
  wanted_date    date not null,
  place          text,
  message        text,

  -- hvem
  customer_type  customer_type not null default 'privat',
  contact_name   text not null,
  company_name   text,
  orgnr          text,
  email          text not null,
  phone          text,

  -- det som avtales underveis
  agreed_date    date,                 -- null = samme som wanted_date
  start_time     time,                 -- null = hele dagen
  duration_min   int check (duration_min is null or duration_min between 15 and 1440),
  price_ex_vat   numeric(12,2) check (price_ex_vat is null or price_ex_vat >= 0),
  notes          text,

  source_origin  text,                 -- hvilken nettside forespørselen kom fra
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  status_changed_at timestamptz not null default now()
);
create index on requests (org_id, status, created_at desc);
create index on requests (org_id, coalesce(agreed_date, wanted_date)) where status = 'bekreftet';

-- Historikk på hvert kort
create table request_log (
  id         bigint generated always as identity primary key,
  request_id uuid not null references requests(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  actor      uuid references auth.users(id) on delete set null,  -- null = system/kunde
  message    text not null,
  created_at timestamptz not null default now()
);
create index on request_log (request_id, created_at);

-- Tilbud (Fiken)
create table offers (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  request_id            uuid not null references requests(id) on delete cascade,
  fiken_offer_id        bigint,
  fiken_offer_number    text,
  total_inc_vat         numeric(12,2),
  sent_to               text,
  sent_at               timestamptz,
  accept_token_hash     text unique,          -- kun hash lagres, aldri selve lenken
  accept_expires_at     timestamptz,
  accepted_at           timestamptz,
  accepted_ip           text,
  fiken_order_confirmation_id bigint,
  created_at            timestamptz not null default now()
);
create index on offers (request_id);

-- ─────────────────────────────────────────────────────────────
-- Hjelpefunksjoner og triggere
-- ─────────────────────────────────────────────────────────────
create or replace function is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = p_org and user_id = auth.uid());
$$;

create or replace function touch_request()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;
create trigger requests_touch before update on requests
  for each row execute function touch_request();

-- Logger statusendringer automatisk, uansett hvor de kommer fra
create or replace function log_request_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  labels jsonb := '{"ny":"Nye forespørsler","kontaktet":"Kontaktet","tilbud":"Tilbud sendt","bekreftet":"Bekreftet","avslatt":"Avslått / arkiv"}';
  msg text;
begin
  if tg_op = 'INSERT' then
    insert into request_log (request_id, org_id, actor, message)
    values (new.id, new.org_id, auth.uid(), 'Forespørsel mottatt fra nettsiden');
  elsif new.status is distinct from old.status then
    msg := 'Flyttet fra ' || (labels->>old.status::text) || ' til ' || (labels->>new.status::text);
    if new.status = 'bekreftet' then msg := msg || ' · lagt i kalenderen'; end if;
    if old.status = 'bekreftet' then msg := msg || ' · fjernet fra kalenderen'; end if;
    insert into request_log (request_id, org_id, actor, message)
    values (new.id, new.org_id, auth.uid(), msg);
  end if;
  return new;
end $$;
create trigger requests_log_status after insert or update of status on requests
  for each row execute function log_request_status();

-- ─────────────────────────────────────────────────────────────
-- Tilgangskontroll (RLS)
-- Innloggede ser bare data for bedrifter de er medlem av.
-- Nettsidebesøkende har INGEN direkte tilgang: widgeten går via serverens API.
-- ─────────────────────────────────────────────────────────────
alter table organizations        enable row level security;
alter table organization_secrets enable row level security;  -- ingen policyer = ingen tilgang
alter table members              enable row level security;
alter table products             enable row level security;
alter table requests             enable row level security;
alter table request_log          enable row level security;
alter table offers               enable row level security;

create policy "medlem leser bedrift"      on organizations for select using (is_member(id));
create policy "medlem oppdaterer bedrift" on organizations for update using (is_member(id)) with check (is_member(id));

create policy "se egne medlemskap" on members for select using (user_id = auth.uid() or is_member(org_id));

create policy "medlem leser produkter"   on products for select using (is_member(org_id));
create policy "medlem lager produkter"   on products for insert with check (is_member(org_id));
create policy "medlem endrer produkter"  on products for update using (is_member(org_id)) with check (is_member(org_id));
create policy "medlem sletter produkter" on products for delete using (is_member(org_id));

create policy "medlem leser forespørsler"  on requests for select using (is_member(org_id));
create policy "medlem endrer forespørsler" on requests for update using (is_member(org_id)) with check (is_member(org_id));
create policy "medlem sletter forespørsler" on requests for delete using (is_member(org_id));

create policy "medlem leser logg"  on request_log for select using (is_member(org_id));
create policy "medlem skriver logg" on request_log for insert with check (is_member(org_id) and actor = auth.uid());

create policy "medlem leser tilbud" on offers for select using (is_member(org_id));

-- Kalenderen: bekreftede avtaler
create view calendar_events with (security_invoker = true) as
  select r.id, r.org_id,
         coalesce(r.agreed_date, r.wanted_date) as date,
         r.start_time, r.duration_min,
         coalesce(p.name, 'Annet: ' || coalesce(r.other_text, '')) as title,
         coalesce(r.company_name, r.contact_name) as customer,
         r.place, r.status
  from requests r
  left join products p on p.id = r.product_id
  where r.status in ('bekreftet', 'tilbud', 'kontaktet');

-- Sanntid: nye forespørsler dukker opp på tavla uten å laste siden på nytt (følger RLS)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table requests;
  end if;
end $$;
