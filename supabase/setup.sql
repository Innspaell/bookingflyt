-- Bookingflyt: komplett oppsett i én fil (0001_init + 0002_calendar + 0003_members + seed).
-- For en NY database. Har du allerede kjørt setup.sql, kjør bare de nye filene i supabase/migrations/.

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

-- Bookingflyt: kalenderabonnement (ICS)
-- Kjøres i Supabase: SQL Editor → lim inn → Run.

-- Hemmelig nøkkel i kalenderlenken. Den som har lenken, kan lese kalenderen,
-- så den kan byttes ut i appen hvis den kommer på avveie.
alter table organizations
  add column if not exists ics_token text not null default encode(gen_random_bytes(24), 'hex');

create unique index if not exists organizations_ics_token_key on organizations (ics_token);

-- Lar medlemmer lage ny kalenderlenke uten å gi dem rett til å sette tokenet selv
create or replace function rotate_ics_token(p_org uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not is_member(p_org) then
    raise exception 'Ingen tilgang';
  end if;
  t := encode(gen_random_bytes(24), 'hex');
  update organizations set ics_token = t where id = p_org;
  return t;
end $$;

revoke all on function rotate_ics_token(uuid) from public;
grant execute on function rotate_ics_token(uuid) to authenticated;

-- Bookingflyt: brukere og invitasjoner
-- Kjøres i Supabase: SQL Editor → lim inn → Run.
--
-- Regler:
--  * Bare eier og admin kan invitere og fjerne brukere.
--  * Bare eier kan gjøre noen til eier, eller fjerne en eier.
--  * Den siste eieren kan ikke fjernes.
--  * En invitasjon gjelder én bedrift. Personen får tilgang automatisk første gang hen logger inn.

create table invitations (
  org_id     uuid not null references organizations(id) on delete cascade,
  email      text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role       member_role not null default 'medarbeider',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);
alter table invitations enable row level security;
create policy "medlem ser invitasjoner" on invitations for select using (is_member(org_id));
-- Ingen insert/delete-policyer: endringer går kun via funksjonene under.

create or replace function my_role(p_org uuid)
returns member_role language sql stable security definer set search_path = public as $$
  select role from members where org_id = p_org and user_id = auth.uid();
$$;

-- Liste over brukere med e-post (auth.users er ellers ikke lesbar for appen)
create or replace function list_members(p_org uuid)
returns table (user_id uuid, email text, role member_role, joined_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_member(p_org) then raise exception 'Ingen tilgang'; end if;
  return query
    select m.user_id, u.email::text, m.role, m.created_at, u.last_sign_in_at
    from members m join auth.users u on u.id = m.user_id
    where m.org_id = p_org
    order by m.role, u.email;
end $$;

-- Inviter. Returnerer 'lagt_til' hvis personen har konto fra før, ellers 'invitert'.
create or replace function invite_member(p_org uuid, p_email text, p_role member_role)
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  v_me member_role := my_role(p_org);
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if v_me is null or v_me = 'medarbeider' then raise exception 'Bare eier eller admin kan invitere'; end if;
  if p_role = 'eier' and v_me <> 'eier' then raise exception 'Bare en eier kan gjøre andre til eier'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Ugyldig e-postadresse'; end if;

  select id into v_user from auth.users where lower(email) = v_email limit 1;
  if v_user is not null then
    if exists (select 1 from members where org_id = p_org and user_id = v_user) then
      raise exception 'Personen har allerede tilgang';
    end if;
    insert into members (org_id, user_id, role) values (p_org, v_user, p_role);
    delete from invitations where org_id = p_org and email = v_email;
    return 'lagt_til';
  end if;

  insert into invitations (org_id, email, role, invited_by)
  values (p_org, v_email, p_role, auth.uid())
  on conflict (org_id, email) do update set role = excluded.role, invited_by = excluded.invited_by, created_at = now();
  return 'invitert';
end $$;

create or replace function revoke_invitation(p_org uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me member_role := my_role(p_org);
begin
  if v_me is null or v_me = 'medarbeider' then raise exception 'Bare eier eller admin kan trekke tilbake invitasjoner'; end if;
  delete from invitations where org_id = p_org and email = lower(trim(p_email));
end $$;

create or replace function remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me member_role := my_role(p_org);
  v_target member_role;
begin
  select role into v_target from members where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'Personen er ikke medlem'; end if;
  -- Alle kan melde seg selv ut, ellers kreves eier/admin
  if p_user <> auth.uid() and (v_me is null or v_me = 'medarbeider') then
    raise exception 'Bare eier eller admin kan fjerne brukere';
  end if;
  if v_target = 'eier' and p_user <> auth.uid() and v_me <> 'eier' then
    raise exception 'Bare en eier kan fjerne en eier';
  end if;
  if v_target = 'eier' and (select count(*) from members where org_id = p_org and role = 'eier') <= 1 then
    raise exception 'Den siste eieren kan ikke fjernes';
  end if;
  delete from members where org_id = p_org and user_id = p_user;
end $$;

create or replace function set_member_role(p_org uuid, p_user uuid, p_role member_role)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me member_role := my_role(p_org);
  v_target member_role;
begin
  select role into v_target from members where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'Personen er ikke medlem'; end if;
  if v_me is null or v_me = 'medarbeider' then raise exception 'Bare eier eller admin kan endre roller'; end if;
  if (p_role = 'eier' or v_target = 'eier') and v_me <> 'eier' then raise exception 'Bare en eier kan endre eierskap'; end if;
  if v_target = 'eier' and p_role <> 'eier' and (select count(*) from members where org_id = p_org and role = 'eier') <= 1 then
    raise exception 'Den siste eieren kan ikke miste eierrollen';
  end if;
  update members set role = p_role where org_id = p_org and user_id = p_user;
end $$;

-- Første innlogging: gjør om ventende invitasjoner til medlemskap
create or replace function accept_invitations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into members (org_id, user_id, role)
  select i.org_id, new.id, i.role from invitations i where i.email = lower(new.email)
  on conflict do nothing;
  delete from invitations where email = lower(new.email);
  return new;
end $$;

drop trigger if exists on_auth_user_created_accept_invitations on auth.users;
create trigger on_auth_user_created_accept_invitations
  after insert on auth.users for each row execute function accept_invitations();

revoke all on function list_members(uuid), invite_member(uuid, text, member_role), revoke_invitation(uuid, text),
  remove_member(uuid, uuid), set_member_role(uuid, uuid, member_role), my_role(uuid), accept_invitations() from public;
grant execute on function list_members(uuid), invite_member(uuid, text, member_role), revoke_invitation(uuid, text),
  remove_member(uuid, uuid), set_member_role(uuid, uuid, member_role), my_role(uuid) to authenticated;

-- Startdata: de to bedriftene og et første produktutvalg.
-- Kjøres etter 0001_init.sql. Rediger fritt – produktene kan endres i appen etterpå.

insert into organizations (slug, name, domain, brand_color, widget_heading, widget_intro, allowed_origins)
values
  ('innspaell', 'InnSpæll', 'innspaell.no', '#2f5d50',
   'Fortell oss hva du planlegger', 'Film og foto til bryllup, bedrift og arrangement.',
   array['https://innspaell.no', 'https://www.innspaell.no']),
  ('kjsn', 'Kjøsen Værsågod', 'kjsn.no', '#8a4b2a',
   'Book en innholdsdag', 'Foto, video og innhold til sosiale medier.',
   array['https://kjsn.no', 'https://www.kjsn.no']);

insert into products (org_id, category, name, booking_type, price_ex_vat, sort_order)
select o.id, p.category, p.name, p.booking_type::booking_type, p.price, p.sort
from organizations o
join (values
  ('innspaell', 'Film',         'Bryllupsfilm',                    'heldag',  32000, 1),
  ('innspaell', 'Film',         'Reklamefilm',                     'avtales', 18000, 2),
  ('innspaell', 'Film',         'Eventfilm / aftermovie',          'avtales', 14000, 3),
  ('innspaell', 'Film',         'Konsert- og forestillingsopptak', 'avtales', 12000, 4),
  ('innspaell', 'Film',         'Portrett- og dokumentarfilm',     'avtales', 25000, 5),
  ('innspaell', 'Foto',         'Bryllupsfoto',                    'heldag',  28000, 1),
  ('innspaell', 'Foto',         'Portrett',                        'avtales',  2500, 2),
  ('innspaell', 'Foto',         'Bedriftsportretter',              'avtales',  6500, 3),
  ('innspaell', 'Foto',         'Produktfoto',                     'avtales',  7500, 4),
  ('innspaell', 'Foto',         'Eventfoto',                       'avtales',  6000, 5),
  ('innspaell', 'Foto + video', 'Bryllup foto + film',             'heldag',  55000, 1),
  ('innspaell', 'Foto + video', 'Bedriftspakke foto + video',      'avtales', 24000, 2),
  ('innspaell', 'Foto + video', 'Innhold til sosiale medier',      'avtales',  9000, 3),
  ('kjsn',      'Foto + video', 'Innholdsdag',                     'heldag',  15000, 1),
  ('kjsn',      'Foto + video', 'Kampanjeproduksjon',              'avtales', 22000, 2),
  ('kjsn',      'Film',         'Kortvideo til Reels / TikTok',    'avtales',  7000, 1),
  ('kjsn',      'Foto',         'Produktfoto til nettbutikk',      'avtales',  5500, 1)
) as p(org, category, name, booking_type, price, sort) on p.org = o.slug;

-- Gi deg selv tilgang (kjør ETTER at du har logget inn i appen første gang):
--   insert into members (org_id, user_id, role)
--   select o.id, u.id, 'eier' from organizations o, auth.users u
--   where u.email = 'DIN@EPOST.NO';
