import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrgNav } from "./OrgNav";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const supabase = await createClient();
  const { data: orgs } = await supabase.from("organizations").select("slug, name").order("name");
  const current = orgs?.find((o) => o.slug === slug);
  if (!current) notFound();

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Bookingflyt</h1>
          <p className="muted small">{current.name}</p>
        </div>
        {orgs && orgs.length > 1 && (
          <div className="seg" role="group" aria-label="Bedrift">
            {orgs.map((o) => (
              <Link key={o.slug} href={`/admin/${o.slug}`} aria-current={o.slug === slug ? "page" : undefined}>
                {o.name}
              </Link>
            ))}
          </div>
        )}
      </header>
      <OrgNav slug={slug} />
      {children}
    </div>
  );
}
