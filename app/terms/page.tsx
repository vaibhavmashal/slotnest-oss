import { COMPANY, ContactLink, LegalFooter } from "@/components/LegalFooter";

export const metadata = { title: "Terms of service · Slotnest" };
// The operator's name and contact come from the server's environment, so render at request time.
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <main className="home legal">
      <h1>Terms of service</h1>
      <p className="muted">Last updated 1 November 2026</p>
      <p>
        These terms are an agreement between you and {COMPANY} for the use of Slotnest. By creating an account or booking a
        meeting, you agree to them.
      </p>

      <h2>Your account</h2>
      <p>
        You need a working email address to sign in. Keep access to it secure: anyone who can read your email can sign in as you.
        You&apos;re responsible for what happens under your account and for the event pages you publish.
      </p>

      <h2>Plans and payment</h2>
      <ul>
        <li>Paid plans have a one-time fee per seat and a yearly maintenance fee per seat, shown before you pay.</li>
        <li>Maintenance renews each year until you cancel it in the billing portal. Cancelling stops the next renewal.</li>
        <li>
          If maintenance lapses or a payment fails, your booking pages stop taking new bookings after a grace period. Existing
          meetings and your data stay in place.
        </li>
        <li>Fees are non-refundable except where the law requires otherwise, or if we end the service as described below.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use Slotnest to send spam, to collect data from people without a lawful reason, to impersonate anyone, or to
        break the law. Don&apos;t try to disrupt the service or access accounts that aren&apos;t yours. We may suspend accounts that
        do.
      </p>

      <h2>Your data</h2>
      <p>
        You own the data you put into Slotnest. You let us process it only to provide the service, as described in our{" "}
        <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep Slotnest running and your bookings accurate, but the service is provided &quot;as is&quot;, without a
        guaranteed uptime. Calendar, video and email providers are outside our control. If we ever shut Slotnest down, we&apos;ll
        give at least 60 days&apos; notice and refund the unused part of the current maintenance year.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, our total liability for any claim is limited to the amount you paid us in the 12 months
        before it, and we aren&apos;t liable for indirect or consequential losses, such as a missed meeting or lost business.
      </p>

      <h2>Ending</h2>
      <p>You can stop using Slotnest at any time and ask us to delete your account.</p>

      <h2>Changes and contact</h2>
      <p>
        We&apos;ll email account holders before material changes take effect. Questions: <ContactLink />.
      </p>
      <LegalFooter />
    </main>
  );
}
