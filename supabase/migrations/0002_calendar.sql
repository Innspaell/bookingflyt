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
