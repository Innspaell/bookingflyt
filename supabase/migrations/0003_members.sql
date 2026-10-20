create table invitations (
  org_id     uuid not null references organizations(id) on delete cascade,
  email      text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role       member_role not null default 'medarbeider',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);
alter table invitations enable row level security;

-- Bookingflyt: brukere og invitasjoner
-- Kjøres i Supabase: SQL Editor → lim inn → Run.
--
-- Regler:
--  * Bare eier og admin kan invitere og fjerne brukere.
--  * Bare eier kan gjøre noen til eier, eller fjerne en eier.
--  * Den siste eieren kan ikke fjernes.
--  * En invitasjon gjelder én bedrift. Personen får tilgang automatisk første gang hen logger inn.

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
