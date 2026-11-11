import Link from "next/link";

/** Shown on pages for paid features while the account is on the Free plan. */
export function UpgradeNotice({ feature }: { feature: string }) {
  return (
    <p className="notice">
      {feature} {feature.endsWith("s") ? "are" : "is"} part of the paid plans. <Link href="/dashboard/billing">Upgrade</Link> to use{" "}
      {feature.endsWith("s") ? "them" : "it"}; your Free booking page keeps working either way.
    </p>
  );
}
