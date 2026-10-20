import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FikenSettings } from "./FikenSettings";

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (!org) notFound();
  const [{ data: status }, { data: role }] = await Promise.all([
    supabase.rpc("fiken_status", { p_org: org.id }).maybeSingle<{ connected: boolean; company_slug: string | null; updated_at: string | null }>(),
    supabase.rpc("my_role", { p_org: org.id }),
  ]);

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
      <FikenSettings
        slug={org.slug}
        orgName={org.name}
        canManage={role === "eier" || role === "admin"}
        connected={!!status?.connected}
        companySlug={status?.company_slug ?? null}
        secretsConfigured={!!process.env.SECRETS_KEY}
      />
    </div>
  );
}
