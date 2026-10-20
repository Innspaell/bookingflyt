import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { orgContext } from "@/lib/orgContext";
import { encrypt, decrypt } from "@/lib/secrets";
import { fiken, FikenError } from "@/lib/fiken";

// POST { token }        → kobler til, lagrer nøkkelen kryptert, returnerer selskapene nøkkelen har tilgang til
// POST { companySlug }  → velger hvilket Fiken-selskap bedriften skal bruke
// DELETE                → kobler fra
export async function POST(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await orgContext(slug, { manage: true });
  if ("error" in ctx) return ctx.error;
  const admin = createAdminClient();
  const body = await req.json().catch(() => ({}));

  try {
    if (typeof body.token === "string") {
      const token = body.token.trim();
      if (token.length < 20) return NextResponse.json({ error: "Det ser ikke ut som en API-nøkkel fra Fiken" }, { status: 422 });
      const companies = await fiken(token).companies(); // feiler hvis nøkkelen er ugyldig
      await admin.from("organization_secrets").upsert({ org_id: ctx.org.id, fiken_token: encrypt(token), updated_at: new Date().toISOString() });
      const only = companies.length === 1 ? companies[0].slug : null;
      await admin.from("organizations").update({ fiken_company_slug: only }).eq("id", ctx.org.id);
      return NextResponse.json({ companies: companies.map((c) => ({ name: c.name, slug: c.slug, organizationNumber: c.organizationNumber })), selected: only });
    }

    if (typeof body.companySlug === "string") {
      const { data } = await admin.from("organization_secrets").select("fiken_token").eq("org_id", ctx.org.id).maybeSingle();
      if (!data?.fiken_token) return NextResponse.json({ error: "Koble til Fiken først" }, { status: 422 });
      const companies = await fiken(decrypt(data.fiken_token)).companies();
      if (!companies.some((c) => c.slug === body.companySlug)) {
        return NextResponse.json({ error: "Nøkkelen har ikke tilgang til det selskapet" }, { status: 422 });
      }
      await admin.from("organizations").update({ fiken_company_slug: body.companySlug }).eq("id", ctx.org.id);
      return NextResponse.json({ selected: body.companySlug });
    }

    if (body.list === true) {
      const { data } = await admin.from("organization_secrets").select("fiken_token").eq("org_id", ctx.org.id).maybeSingle();
      if (!data?.fiken_token) return NextResponse.json({ companies: [] });
      const companies = await fiken(decrypt(data.fiken_token)).companies();
      return NextResponse.json({ companies: companies.map((c) => ({ name: c.name, slug: c.slug, organizationNumber: c.organizationNumber })) });
    }
  } catch (e) {
    if (e instanceof FikenError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error(e);
    return NextResponse.json({ error: "Noe gikk galt" }, { status: 500 });
  }
  return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await orgContext(slug, { manage: true });
  if ("error" in ctx) return ctx.error;
  const admin = createAdminClient();
  await admin.from("organization_secrets").update({ fiken_token: null, updated_at: new Date().toISOString() }).eq("org_id", ctx.org.id);
  await admin.from("organizations").update({ fiken_company_slug: null }).eq("id", ctx.org.id);
  return NextResponse.json({ ok: true });
}
