import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayName, kr } from "@/lib/format";
import type { BookingRequest } from "@/lib/types";
import { SubscribeLink } from "./SubscribeLink";

const MND = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

type Row = BookingRequest & { products: { name: string } | null };

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const { org: slug } = await params;
  const { m } = await searchParams;
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id, name, ics_token").eq("slug", slug).maybeSingle();
  if (!org) notFound();

  const today = new Date();
  const [y, mo] = m && /^\d{4}-\d{2}$/.test(m) ? m.split("-").map(Number) : [today.getFullYear(), today.getMonth() + 1];
  const first = new Date(y, mo - 1, 1);
  const start = new Date(y, mo - 1, 1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const from = iso(days[0]), to = iso(days[41]);

  const { data } = await supabase
    .from("requests")
    .select("*, products(name)")
    .eq("org_id", org.id)
    .in("status", ["bekreftet", "tilbud", "kontaktet"])
    .or(`and(agreed_date.gte.${from},agreed_date.lte.${to}),and(agreed_date.is.null,wanted_date.gte.${from},wanted_date.lte.${to})`);
  const rows = (data ?? []) as Row[];

  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.agreed_date ?? r.wanted_date;
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.start_time ?? "00").localeCompare(b.start_time ?? "00"));

  const monthKey = (yy: number, mm: number) => {
    const d = new Date(yy, mm - 1, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  const inMonth = rows.filter((r) => r.status === "bekreftet" && (r.agreed_date ?? r.wanted_date).startsWith(`${y}-${pad(mo)}`));
  const sum = inMonth.reduce((s, r) => s + Number(r.price_ex_vat ?? 0), 0);

  const h = await headers();
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `https://${h.get("host")}`;
  const feed = `${base.replace(/^https?:/, "webcal:")}/api/ics/${org.ics_token}.ics`;

  return (
    <>
      <div className="cal-h">
        <div>
          <h2>{MND[mo - 1][0].toUpperCase() + MND[mo - 1].slice(1)} {y}</h2>
          <p className="muted small">
            {inMonth.length} bekreftet denne måneden{sum > 0 ? ` · ${kr(sum)} ekskl. mva` : ""}
          </p>
        </div>
        <div className="moves">
          <Link className="btn small" href={`?m=${monthKey(y, mo - 1)}`} aria-label="Forrige måned">←</Link>
          <Link className="btn small" href="?">I dag</Link>
          <Link className="btn small" href={`?m=${monthKey(y, mo + 1)}`} aria-label="Neste måned">→</Link>
        </div>
      </div>
      <div className="legend">
        <span><i className="sw st-bekreftet solid" />Bekreftet</span>
        <span><i className="sw st-tilbud" />Tilbud sendt</span>
        <span><i className="sw st-kontaktet" />Under avklaring</span>
      </div>

      <div className="calscroll">
        <div className="cal">
          {["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"].map((d) => <div key={d} className="dow">{d}</div>)}
          {days.map((d) => {
            const k = iso(d);
            const ev = byDay.get(k) ?? [];
            const out = d.getMonth() !== mo - 1;
            return (
              <div key={k} className={`day${out ? " out" : ""}${k === iso(today) ? " today" : ""}`}>
                <span className="dn">{d.getDate()}</span>
                {ev.map((r) => (
                  <Link
                    key={r.id}
                    href={`/admin/${slug}?open=${r.id}`}
                    className={`ev st-${r.status}${r.status === "bekreftet" ? "" : " tent"}`}
                    title={`${displayName(r)} – ${r.products?.name ?? "Annet: " + (r.other_text ?? "")}`}
                  >
                    {r.start_time && <span className="mono">{r.start_time.slice(0, 5)} </span>}
                    {r.company_name ?? r.contact_name}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <SubscribeLink orgId={org.id} feed={feed} />
    </>
  );
}
