import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Board } from "./Board";
import type { BookingRequest, Product } from "@/lib/types";

export default async function BoardPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id, name").eq("slug", slug).maybeSingle();
  if (!org) notFound();

  const [{ data: requests }, { data: products }] = await Promise.all([
    supabase.from("requests").select("*").eq("org_id", org.id).order("created_at", { ascending: false }).limit(500),
    supabase.from("products").select("*").eq("org_id", org.id).order("category").order("sort_order"),
  ]);

  return (
    <Board
      orgId={org.id}
      initialRequests={(requests ?? []) as BookingRequest[]}
      products={(products ?? []) as Product[]}
    />
  );
}
