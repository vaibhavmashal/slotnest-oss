import Link from "next/link";
import { config } from "@/lib/config";

/** Who runs this copy of Slotnest, as named in the footer, privacy policy and terms (COMPANY_NAME). */
export const COMPANY = config.operator.company ?? "the operator of this site";
/** Where people write to (CONTACT_EMAIL, else the first ADMIN_EMAILS address); null when neither is set. */
export const CONTACT_EMAIL = config.operator.contactEmail;

/** The contact address as a mail link, or a plain description when none is configured. */
export function ContactLink() {
  return CONTACT_EMAIL ? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> : <>the site&apos;s administrator</>;
}

export function LegalFooter() {
  return (
    <footer className="legal-footer muted small">
      © {new Date().getFullYear()}
      {config.operator.company && ` ${config.operator.company}`} · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
      {CONTACT_EMAIL && (
        <>
          {" "}
          · <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </>
      )}
    </footer>
  );
}
