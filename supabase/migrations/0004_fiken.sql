alter table requests add column if not exists fiken_contact_id bigint;

-- Fiken: kobling per forespørsel og inntektskonto per produkt.
-- Kjøres i Supabase: SQL Editor → lim inn → Run.

-- Inntektskonto i Fiken. Tom = standard: 3000 for mva-pliktig salg, 3100 for salg uten mva.
alter table products add column if not exists income_account text
  check (income_account is null or income_account ~ '^[0-9]{4}$');

-- Om bedriften er koblet til Fiken (uten å vise selve nøkkelen)
create or replace function fiken_status(p_org uuid)
returns table (connected boolean, company_slug text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_org) then raise exception 'Ingen tilgang'; end if;
  return query
    select (s.fiken_token is not null), o.fiken_company_slug, s.updated_at
    from organizations o left join organization_secrets s on s.org_id = o.id
    where o.id = p_org;
end $$;
revoke all on function fiken_status(uuid) from public;
grant execute on function fiken_status(uuid) to authenticated;
