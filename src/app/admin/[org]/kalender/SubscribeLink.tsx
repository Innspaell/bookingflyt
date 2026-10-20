"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SubscribeLink({ orgId, feed }: { orgId: string; feed: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [withOffers, setWithOffers] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const url = withOffers ? `${feed}?tilbud=1` : feed;
  const https = url.replace(/^webcal:/, "https:");

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* brukeren kan markere teksten selv */ }
  }
  async function rotate() {
    setConfirmRotate(false);
    const { error } = await supabase.rpc("rotate_ics_token", { p_org: orgId });
    if (!error) router.refresh();
  }

  return (
    <section className="panel subscribe">
      <h3>Abonner fra telefonen eller Outlook</h3>
      <p className="muted small">
        Kalenderen oppdateres av seg selv, vanligvis innen en halvtime. På iPhone: trykk lenken under.
        I Google Kalender: «Andre kalendere» → «Fra nettadresse», og lim inn lenken. I Outlook: «Legg til kalender» → «Abonner fra nettet».
      </p>
      <label className="check">
        <input type="checkbox" checked={withOffers} onChange={(e) => setWithOffers(e.target.checked)} />
        Ta også med sendte tilbud som foreløpige avtaler
      </label>
      <pre className="code" aria-label="Kalenderlenke">{url}</pre>
      <div className="moves">
        <a className="btn small primary" href={url}>Åpne i kalenderappen</a>
        <button className="btn small" onClick={copy}>{copied ? "Kopiert" : "Kopier lenke"}</button>
        <a className="btn small" href={https} target="_blank" rel="noreferrer">Last ned .ics</a>
        {confirmRotate ? (
          <>
            <button className="btn small danger" onClick={rotate}>Lag ny lenke</button>
            <button className="btn small" onClick={() => setConfirmRotate(false)}>Avbryt</button>
          </>
        ) : (
          <button className="btn small" onClick={() => setConfirmRotate(true)}>Lag ny lenke …</button>
        )}
      </div>
      {confirmRotate && (
        <p className="small error">Den gamle lenken slutter å virke, og alle som abonnerer må legge inn den nye.</p>
      )}
      <p className="muted small">Lenken gir lesetilgang til avtalene, med kundenavn og telefon. Del den bare med folk som skal se kalenderen.</p>
    </section>
  );
}
