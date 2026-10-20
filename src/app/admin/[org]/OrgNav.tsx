"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function OrgNav({ slug }: { slug: string }) {
  const path = usePathname();
  const tabs = [
    { href: `/admin/${slug}`, label: "Tavle" },
    { href: `/admin/${slug}/produkter`, label: "Produkter" },
    { href: `/admin/${slug}/widget`, label: "Widget" },
  ];
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
