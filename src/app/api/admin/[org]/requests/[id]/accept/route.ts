import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fikenFor, orgContext } from "@/lib/orgContext";
import { FikenError } from "@/lib/fiken";
import { linesFor, longDate } from "@/lib/offerLines";
import type { BookingRequest, Offer, Product } from "@/lib/types";

// Kunden har akseptert: lager ordrebekreftelse i Fiken og flytter kortet til Bekreftet.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const ctx = await orgContext(slug);
  if ("error" in ctx) return ctx.error;
  const { supabase, user, org } = ctx;

  const { data: r } = await supabase.from("requests").select("*").eq("id", id).eq("org_id", org.id).maybeSingle<BookingRequest>();
  if (!r) return NextResponse.json({ error: "Fant ikke forespørselen" }, { status: 404 });

  const { data: offer } = await supabase.from("offers").select("*").eq("request_id", id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle<Offer>();
  if (!offer) return NextResponse.json({ error: "Det finnes ikke noe tilbud for dette kortet" }, { status: 422 });

  const admin = createAdminClient();
  const now = new Date();

  if (!offer.fiken_order_confirmation_id) {
    const fk = await fikenFor(org.id, org.fiken_company_slug);
    if (!fk) return NextResponse.json({ error: "Bedriften er ikke koblet til Fiken" }, { status: 422 });
    if (!r.fiken_contact_id) return NextResponse.json({ error: "Kortet mangler kunde i Fiken" }, { status: 422 });

    const { data: p } = r.product_id
      ? await supabase.from("products").select("*").eq("id", r.product_id).maybeSingle<Product>()
      : { data: null };

    try {
      const ocId = await fk.client.createOrderConfirmation(fk.slug, {
        customerId: r.fiken_contact_id,
        lines: linesFor(r, p),
        text: `Bekreftelse av tilbud nr. ${offer.fiken_offer_number}, akseptert ${longDate(now.toISOString().slice(0, 10))}.`,
        yourReference: r.company_name ? r.contact_name : undefined,
      });
      await admin.from("offers").update({ accepted_at: now.toISOString(), fiken_order_confirmation_id: ocId }).eq("id", offer.id);
      await supabase.from("request_log").insert({
        request_id: r.id, org_id: org.id, actor: user.id,
        message: `Kunden aksepterte tilbud #${offer.fiken_offer_number} · ordrebekreftelse opprettet i Fiken`,
      });
    } catch (e) {
      const msg = e instanceof FikenError ? e.message : (e as Error).message;
      return NextResponse.json({ error: `Kunne ikke lage ordrebekreftelse: ${msg}` }, { status: 502 });
    }
  }

  if (r.status !== "bekreftet") {
    const { error } = await supabase.from("requests").update({ status: "bekreftet" }).eq("id", r.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
