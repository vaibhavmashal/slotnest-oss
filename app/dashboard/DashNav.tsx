"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/dashboard", "Overview"],
  ["/dashboard/event-types", "Event types"],
  ["/dashboard/routing", "Routing"],
  ["/dashboard/availability", "Availability"],
  ["/dashboard/team", "Team"],
  ["/dashboard/branding", "Branding"],
  ["/dashboard/webhooks", "Webhooks"],
  ["/dashboard/billing", "Billing"],
] as const;

export function DashNav({ assistant, admin }: { assistant: boolean; admin: boolean }) {
  const path = usePathname();
  const links = [
    ...LINKS.slice(0, 1),
    ...(assistant ? [["/dashboard/assistant", "Assistant"] as const] : []),
    ...LINKS.slice(1),
    ...(admin ? [["/dashboard/admin", "Admin"] as const] : []),
  ];
  return (
    <nav>
      {links.map(([href, label]) => {
        const active = href === "/dashboard" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
