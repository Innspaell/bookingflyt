# Bookingflyt

Forespørsler fra nettsiden → tavle → tilbud → kalender. Én installasjon for flere bedrifter (InnSpæll og Kjøsen Værsågod), med helt adskilte data.

**Stack:** Next.js (Vercel) · Supabase (database, innlogging, sanntid) · widget i ren JavaScript.

## Hva som er bygget (versjon 0.1)

- **Widget** (`public/w.js`) som limes inn på hvilken som helst nettside. Den har valg mellom privatperson og bedrift, tjenester per kategori, «Annet», fritekst, dato og sted. Den er innkapslet, så nettsidens stil ikke påvirker den, og har spamvern (skjult felt, minste utfyllingstid og maks 5 innsendinger per e-post i timen).
- **Offentlig API** for widgeten. Det godtar bare innsendinger fra nettsider du har godkjent.
- **Innlogging** med e-postlenke, uten passord.
- **Tavle** med kolonnene Ny → Kontaktet → Tilbud sendt → Bekreftet, pluss Avslått. Du kan dra og slippe kortene, og redigere produkt, dato, tid, varighet, pris, kundetype og notater. Systemet sjekker for kollisjoner, logger historikken og oppdaterer tavla i sanntid når nye forespørsler kommer inn.
- **Produkter**: legg til, skjul eller slett, og endre tidsramme, pris og mva per produkt.
- **Kalender**: månedsvisning der bekreftede avtaler vises som fylte felt, og tilbud og avklaringer som stiplede. Klikk på en avtale for å åpne kortet. I tillegg finnes en kalenderlenke (ICS) du kan abonnere på fra iPhone, Google eller Outlook. Lenken kan byttes ut hvis den kommer på avveie.
- **Brukere**: inviter folk til én bedrift om gangen, med rollene eier, admin eller medarbeider. Tilgang kan fjernes, og den siste eieren kan ikke fjernes.
- **Database med radnivåsikkerhet (RLS).** Brukere ser bare data for bedriftene de er medlem av.

**Kommer:** e-post (varsel, kvittering, bekreftelse) og Fiken (tilbud, PDF, godkjenningslenke, ordrebekreftelse).

## Oppsett, første gang

### 1. Supabase
1. Lag et prosjekt på supabase.com i regionen **Stockholm (eu-north-1)**.
2. Åpne **SQL Editor** → **New query**. Lim inn hele `supabase/migrations/0001_init.sql` og trykk **Run**.
3. Gjør det samme med `supabase/migrations/0002_calendar.sql`, og deretter `supabase/seed.sql`. Seed-filen legger inn bedriftene og produktene.
4. Gå til **Project Settings → API** og noter tre ting: `Project URL`, `anon public`-nøkkelen og `service_role`-nøkkelen. Service role-nøkkelen er hemmelig.

### 2. Vercel
1. Legg koden i et GitHub-repo.
2. På vercel.com velger du **Add New → Project** og importerer repoet.
3. Under **Environment Variables** legger du inn verdiene fra `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL`, som er Vercel-adressen, for eksempel `https://bookingflyt.vercel.app`
4. Trykk **Deploy**.

### 3. Innlogging
1. I Supabase går du til **Authentication → URL Configuration**. Sett **Site URL** til Vercel-adressen, og legg til `https://DIN-ADRESSE/auth/callback` under **Redirect URLs**.
2. Åpne appen, logg inn med e-posten din og klikk på lenken du får.
3. I **SQL Editor** kjører du dette, med din e-postadresse, for å gi deg tilgang til begge bedriftene:
   ```sql
   insert into members (org_id, user_id, role)
   select o.id, u.id, 'eier' from organizations o, auth.users u
   where u.email = 'DIN@EPOST.NO';
   ```
4. Last siden på nytt. Nå ser du tavla.

### 4. Widgeten på nettsiden
Under fanen **Widget** i appen finner du koden som skal limes inn. Nettsiden må stå på listen over godkjente adresser. Den endres i Supabase under **Table Editor → organizations → allowed_origins**. Adressene `https://innspaell.no` og `https://kjsn.no` med og uten www ligger inne fra start.

## Utvikling lokalt
```bash
cp .env.example .env.local   # fyll inn verdiene
npm install
npm run dev                  # http://localhost:3000
```

## Sikkerhet
- `SUPABASE_SERVICE_ROLE_KEY` brukes bare i API-rutene på serveren, og aldri i nettleseren.
- Fiken-nøkler skal ligge i `organization_secrets`. Den tabellen har ingen policyer, så bare serveren kan lese den.
- Nettsidebesøkende har ingen direkte tilgang til databasen. Alt går via API-et, som kontrollerer hver innsending.
