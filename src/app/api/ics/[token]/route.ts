import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildCalendar, type IcsEvent } from "@/lib/ics";

// Kalenderabonnement: /api/ics/<hemmelig-nøkkel>.ics
// Inneholder bekreftede avtaler. Legg til ?tilbud=1 for å også få med sendte tilbud som «foreløpig».
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{48}$/.test(token)) return new NextResponse("Ikke funnet", { status: 404 });

  const db = createAdminClient();
  const { data: org } = await db.from("organizations").select("id, name").eq("ics_token", token).maybeSingle();
  if (!org) return new NextResponse("Ikke funnet", { status: 404 });

  const withOffers = req.nextUrl.searchParams.get("tilbud") === "1";
  const statuses = withOffers ? ["bekreftet", "tilbud"] : ["bekreftet"];

  // Fra 90 dager tilbake og fremover holder kalenderen lett
  const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);

  const { data: rows, error } = await db
    .from("requests")
    .select("id, status, wanted_date, agreed_date, start_time, duration_min, place, message, notes, contact_name, company_name, phone, email, other_text, updated_at, products(name)")
    .eq("org_id", org.id)
    .in("status", statuses)
    .or(`agreed_date.gte.${from},and(agreed_date.is.null,wanted_date.gte.${from})`);

  if (error) return new NextResponse("Feil ved henting", { status: 500 });

  const events: IcsEvent[] = (rows ?? []).map((r) => {
    const product = (r.products as unknown as { name: string } | null)?.name ?? `Annet: ${r.other_text ?? ""}`;
    const customer = r.company_name ? `${r.company_name} v/ ${r.contact_name}` : r.contact_name;
    const tentative = r.status === "tilbud";
    return {
      uid: `${r.id}@bookingflyt`,
      date: r.agreed_date ?? r.wanted_date,
      startTime: r.start_time,
      durationMin: r.duration_min,
      summary: `${tentative ? "[Tilbud] " : ""}${product} – ${customer}`,
      description: [
        `Kunde: ${customer}`,
        r.phone ? `Telefon: ${r.phone}` : null,
        `E-post: ${r.email}`,
        r.notes ? `\nNotater: ${r.notes}` : null,
        r.message ? `\nFra kunden: ${r.message}` : null,
      ].filter(Boolean).join("\n"),
      location: r.place,
      tentative,
      updatedAt: r.updated_at,
    };
  });

  return new NextResponse(buildCalendar(org.name, events), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${org.name.replace(/[^\w-]+/g, "_")}.ics"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
