import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fikenFor, orgContext } from "@/lib/orgContext";
import { FikenError } from "@/lib/fiken";
import { linesFor } from "@/lib/offerLines";
import type { BookingRequest, Product } from "@/lib/types";

// Lager tilbud i Fiken fra kortet, og sender det til kunden hvis send=true.
export async function POST(req: NextRequest, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const ctx = await orgContext(slug);
  if ("error" in ctx) return ctx.error;
  const { supabase, user, org } = ctx;
  const body = await req.json().catch(() => ({}));
  const send = body.send === true;
  const message = typeof body.message === "string" ? body.message.slice(0, 2000) : undefined;

  const { data: r } = await supabase.from("requests").select("*").eq("id", id).eq("org_id", org.id).maybeSingle<BookingRequest>();
  if (!r) return NextResponse.json({ error: "Fant ikke forespørselen" }, { status: 404 });
  if (!["ny", "kontaktet", "tilbud"].includes(r.status)) {
    return NextResponse.json({ error: "Tilbud kan bare lages før avtalen er bekreftet" }, { status: 422 });
  }

  // Hindrer dobbelttrykk: ett tilbud per kort per minutt
  const { data: recent } = await supabase.from("offers").select("id").eq("request_id", id)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString()).limit(1);
  if (recent?.length) return NextResponse.json({ error: "Det ble nettopp laget et tilbud for dette kortet" }, { status: 409 });

  const fk = await fikenFor(org.id, org.fiken_company_slug);
  if (!fk) return NextResponse.json({ error: "Bedriften er ikke koblet til Fiken. Gå til Innstillinger." }, { status: 422 });

  const { data: p } = r.product_id
    ? await supabase.from("products").select("*").eq("id", r.product_id).maybeSingle<Product>()
    : { data: null };

  let lines;
  try { lines = linesFor(r, p); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 422 }); }

  const admin = createAdminClient();
  const customerName = r.company_name || r.contact_name;

  try {
    const customerId = r.fiken_contact_id ?? await fk.client.findOrCreateCustomer(fk.slug, {
      name: customerName,
      email: r.email,
      organizationNumber: r.customer_type === "bedrift" ? r.orgnr : null,
      phoneNumber: r.phone,
    });
    if (customerId !== r.fiken_contact_id) {
      await supabase.from("requests").update({ fiken_contact_id: customerId }).eq("id", r.id);
    }

    const offer = await fk.client.createOffer(fk.slug, {
      customerId,
      lines,
      yourReference: r.company_name ? r.contact_name : undefined,
    });

    const { data: row } = await admin.from("offers").insert({
      org_id: org.id,
      request_id: r.id,
      fiken_offer_id: offer.offerId,
      fiken_offer_number: String(offer.offerNumber),
      total_inc_vat: offer.gross / 100,
    }).select("*").single();

    await supabase.from("request_log").insert({
      request_id: r.id, org_id: org.id, actor: user.id,
      message: `Tilbud #${offer.offerNumber} laget i Fiken (${(offer.gross / 100).toLocaleString("nb-NO")} kr inkl. mva)`,
    });

    let sendError: string | null = null;
    if (send) {
      try {
        await fk.client.sendOffer(fk.slug, { offerId: offer.offerId, email: r.email, name: r.contact_name, message });
        await admin.from("offers").update({ sent_to: r.email, sent_at: new Date().toISOString() }).eq("id", row!.id);
        await supabase.from("request_log").insert({
          request_id: r.id, org_id: org.id, actor: user.id,
          message: `Tilbud #${offer.offerNumber} sendt fra Fiken til ${r.email}`,
        });
      } catch (e) {
        sendError = e instanceof FikenError ? e.message : "Ukjent feil";
      }
    }

    // Kortet flyttes til «Tilbud sendt» (statusendringen logges automatisk)
    const patch: Partial<BookingRequest> = {};
    if (r.price_ex_vat == null && p?.price_ex_vat != null) patch.price_ex_vat = p.price_ex_vat;
    if (send && !sendError && r.status !== "tilbud") patch.status = "tilbud";
    if (Object.keys(patch).length) await supabase.from("requests").update(patch).eq("id", r.id);

    return NextResponse.json({
      ok: true,
      offerNumber: offer.offerNumber,
      total: offer.gross / 100,
      sent: send && !sendError,
      warning: sendError ? `Tilbudet ble laget, men ikke sendt: ${sendError}. Du kan sende det fra Fiken.` : null,
    });
  } catch (e) {
    if (e instanceof FikenError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error(e);
    return NextResponse.json({ error: "Noe gikk galt mot Fiken" }, { status: 500 });
  }
}
