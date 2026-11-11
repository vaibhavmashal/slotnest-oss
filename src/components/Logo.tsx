import Link from "next/link";

/** The Slotnest mark (a calendar page with a check) and wordmark. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo">
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="11" rx="2.5" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3M5.8 10.2l1.6 1.5 3-3" />
        </svg>
      </span>
      Slotnest
    </Link>
  );
}
