import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MemberAdmin, type Member, type Invitation } from "./MemberAdmin";

export default async function UsersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: org } = await supabase.from("organizations").select("id, name").eq("slug", slug).maybeSingle();
  if (!org || !user) notFound();

  const [{ data: members }, { data: invitations }, { data: myRole }] = await Promise.all([
    supabase.rpc("list_members", { p_org: org.id }),
    supabase.from("invitations").select("email, role, created_at").eq("org_id", org.id).order("created_at"),
    supabase.rpc("my_role", { p_org: org.id }),
  ]);

  const h = await headers();
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `https://${h.get("host")}`;

  return (
    <MemberAdmin
      orgId={org.id}
      orgName={org.name}
      me={user.id}
      myRole={myRole as Member["role"]}
      members={(members ?? []) as Member[]}
      invitations={(invitations ?? []) as Invitation[]}
      loginUrl={`${base}/login`}
    />
  );
}
