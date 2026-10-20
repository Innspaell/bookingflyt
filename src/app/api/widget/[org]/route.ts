import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { cors, json, originAllowed } from "@/lib/widget";
import { NextResponse } from "next/server";

// Offentlig: oppsett for widgeten (farger, tekster, aktive produkter).
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const origin = req.headers.get("origin");
  const db = createAdminClient();

  const { data: org } = await db
    .from("organizations")
    .select("id, slug, name, brand_color, widget_heading, widget_intro, allowed_origins")
    .eq("slug", slug)
    .maybeSingle();

  if (!org) return json({ error: "Ukjent bedrift" }, 404, origin);
  if (origin && !originAllowed(org, origin, req.nextUrl.origin)) return json({ error: "Denne nettsiden har ikke tilgang" }, 403, null);

  const { data: products } = await db
    .from("products")
    .select("id, category, name, booking_type")
    .eq("org_id", org.id)
    .eq("active", true)
    .order("category")
    .order("sort_order")
    .order("name");

  const res = json(
    {
      name: org.name,
      color: org.brand_color,
      heading: org.widget_heading,
      intro: org.widget_intro,
      products: products ?? [],
      // Tidsstempel brukes til spamvern (for rask innsending avvises)
      issued: Date.now(),
    },
    200,
    origin,
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return cors(new NextResponse(null, { status: 204 }), req.headers.get("origin"));
}
