import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Script from "next/script";
import { createClient } from "@/lib/supabase/server";

export default async function WidgetPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("slug, name, allowed_origins").eq("slug", slug).maybeSingle();
  if (!org) notFound();

  const h = await headers();
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `https://${h.get("host")}`;
  const snippet = `<div id="bookingflyt"></div>\n<script src="${base}/w.js" data-org="${org.slug}" charset="utf-8" defer></script>`;

  return (
    <div className="wview">
      <section className="panel">
        <h2>Forhåndsvisning</h2>
        <p className="muted small">Slik ser skjemaet ut på nettsiden. Innsendinger herfra havner på tavla som ekte forespørsler.</p>
        <div id="bookingflyt" />
        <Script src="/w.js" data-org={org.slug} strategy="afterInteractive" />
      </section>
      <aside className="stack">
        <div className="panel">
          <h3>Lim inn på nettsiden</h3>
          <p className="muted small">Der skjemaet skal vises, i HTML-en eller en «Egendefinert HTML»-blokk.</p>
          <pre className="code">{snippet}</pre>
        </div>
        <div className="panel">
          <h3>Nettsider med tilgang</h3>
          <p className="muted small">Skjemaet virker bare på disse adressene.</p>
          <ul className="plain mono small">
            {org.allowed_origins.length ? org.allowed_origins.map((o: string) => <li key={o}>{o}</li>) : <li>Ingen ennå</li>}
          </ul>
        </div>
      </aside>
    </div>
  );
}
