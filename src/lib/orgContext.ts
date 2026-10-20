import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "./supabase/server";
import { decrypt } from "./secrets";
import { fiken } from "./fiken";

type Role = "eier" | "admin" | "medarbeider";

/** Innlogget bruker + bedrift (via RLS) + rolle. Returnerer et feilsvar hvis noe mangler. */
export async function orgContext(slug: string, opts: { manage?: boolean } = {}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Du er ikke logget inn" }, { status: 401 }) } as const;

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug, name, fiken_company_slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!org) return { error: NextResponse.json({ error: "Ingen tilgang til bedriften" }, { status: 403 }) } as const;

  const { data: role } = await supabase.rpc("my_role", { p_org: org.id });
  if (opts.manage && role !== "eier" && role !== "admin") {
    return { error: NextResponse.json({ error: "Bare eier eller admin kan endre dette" }, { status: 403 }) } as const;
  }
  return { supabase, user, org, role: role as Role } as const;
}

/** Fiken-klient for bedriften, eller null hvis den ikke er koblet til. */
export async function fikenFor(orgId: string, companySlug: string | null) {
  if (!companySlug) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("organization_secrets").select("fiken_token").eq("org_id", orgId).maybeSingle();
  if (!data?.fiken_token) return null;
  return { client: fiken(decrypt(data.fiken_token)), slug: companySlug };
}
