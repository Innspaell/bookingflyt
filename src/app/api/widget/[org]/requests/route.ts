import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { cors, json, originAllowed, parseSubmission } from "@/lib/widget";

const MIN_FILL_MS = 3000;        // raskere enn dette er en robot
const MAX_PER_EMAIL_PER_HOUR = 5;

// Offentlig: tar imot en forespørsel fra widgeten.
export async function POST(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const origin = req.headers.get("origin");
  const db = createAdminClient();

  const { data: org } = await db
    .from("organizations")
    .select("id, allowed_origins")
    .eq("slug", slug)
    .maybeSingle();
  if (!org) return json({ error: "Ukjent bedrift" }, 404, origin);
  if (!originAllowed(org, origin, req.nextUrl.origin)) return json({ error: "Denne nettsiden har ikke tilgang" }, 403, null);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig innsending" }, 400, origin);
  }

  // Spamvern: skjult felt som mennesker ikke ser, og minimum utfyllingstid.
  // Roboter får et "vellykket" svar så de ikke prøver på nytt.
  const issued = Number(body.issued);
  if (body.website || !issued || Date.now() - issued < MIN_FILL_MS) {
    return json({ ok: true }, 200, origin);
  }

  const parsed = parseSubmission(body);
  if (!parsed.ok) return json({ error: parsed.error }, 422, origin);
  const d = parsed.data;

  // Produktet må tilhøre denne bedriften og være aktivt
  if (d.product_id) {
    const { data: p } = await db
      .from("products")
      .select("id")
      .eq("id", d.product_id)
      .eq("org_id", org.id)
      .eq("active", true)
      .maybeSingle();
    if (!p) return json({ error: "Tjenesten finnes ikke lenger. Last siden på nytt." }, 422, origin);
  }

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db
    .from("requests")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id)
    .eq("email", d.email)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_PER_EMAIL_PER_HOUR) {
    return json({ error: "Vi har allerede fått flere forespørsler fra deg. Vi tar kontakt!" }, 429, origin);
  }

  const { data: created, error } = await db
    .from("requests")
    .insert({ ...d, org_id: org.id, source_origin: origin })
    .select("id")
    .single();

  if (error) {
    console.error("Kunne ikke lagre forespørsel", error);
    return json({ error: "Noe gikk galt. Prøv igjen om litt." }, 500, origin);
  }

  // TODO steg 5: e-post – varsel til bedriften og kvittering til kunden.

  return json({ ok: true, id: created.id }, 201, origin);
}

export async function OPTIONS(req: NextRequest) {
  return cors(new NextResponse(null, { status: 204 }), req.headers.get("origin"));
}
