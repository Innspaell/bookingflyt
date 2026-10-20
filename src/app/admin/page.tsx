import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Sender brukeren til første bedrift hen har tilgang til.
export default async function AdminIndex() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: orgs } = await supabase.from("organizations").select("slug").order("name");
  if (orgs && orgs.length) redirect(`/admin/${orgs[0].slug}`);

  return (
    <main className="center">
      <div className="panel narrow">
        <h1>Nesten klar</h1>
        <p>Du er logget inn som <b>{user.email}</b>, men har ikke tilgang til noen bedrift ennå.</p>
        <p className="muted">
          Be den som administrerer bedriften om å invitere <b>{user.email}</b> under fanen Brukere,
          og last deretter siden på nytt.
        </p>
      </div>
    </main>
  );
}
