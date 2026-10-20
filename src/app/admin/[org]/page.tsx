import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Board } from "./Board";
import type { BookingRequest, Product } from "@/lib/types";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { org: slug } = await params;
  const { open } = await searchParams;
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id, name").eq("slug", slug).maybeSingle();
  if (!org) notFound();
  const { data: fk } = await supabase.rpc("fiken_status", { p_org: org.id }).maybeSingle<{ connected: boolean; company_slug: string | null }>();

  const [{ data: requests }, { data: products }] = await Promise.all([
    supabase.from("requests").select("*").eq("org_id", org.id).order("created_at", { ascending: false }).limit(500),
    supabase.from("products").select("*").eq("org_id", org.id).order("category").order("sort_order"),
  ]);

  return (
    <Board
      orgId={org.id}
      initialRequests={(requests ?? []) as BookingRequest[]}
      products={(products ?? []) as Product[]}
      initialOpen={open ?? null}
      orgSlug={slug}
      fikenReady={!!fk?.connected && !!fk?.company_slug}
    />
  );
}
