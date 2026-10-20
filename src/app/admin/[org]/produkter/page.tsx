import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductAdmin } from "./ProductAdmin";
import type { Product } from "@/lib/types";

export default async function ProductsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (!org) notFound();
  const { data } = await supabase.from("products").select("*").eq("org_id", org.id).order("category").order("sort_order").order("name");
  return <ProductAdmin orgId={org.id} initial={(data ?? []) as Product[]} />;
}
