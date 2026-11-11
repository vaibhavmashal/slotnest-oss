import { COMPANY, ContactLink, LegalFooter } from "@/components/LegalFooter";
import { assistantAvailable } from "@/lib/assistant";

// The AI assistant is only mentioned while it is switched on (an Anthropic key is set), which is read at runtime.
export const dynamic = "force-dynamic";

export const metadata = { title: "Privacy policy · Slotnest" };

export default function PrivacyPage() {
  const ai = assistantAvailable();
  return (
    <main className="home legal">
      <h1>Privacy policy</h1>
      <p className="muted">Last updated 1 November 2026</p>
      <p>
        Slotnest is run by {COMPANY} (&quot;we&quot;). This policy explains what we collect when you use Slotnest, either as an
        account holder who takes bookings or as someone who books a meeting.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account holders:</strong> name, email address, username, time zone, working hours, event settings, and any logo
          or photo you upload.
        </li>
        <li>
          <strong>People who book:</strong> the name, email address, time zone and any notes entered on the booking form, and the
          meeting time. If they fill in a routing form first, we keep their answers and where it sent them.
        </li>
        {ai && (
          <li>
            <strong>AI assistant:</strong> if you use the assistant in your dashboard, we keep your conversation with it so you
            can pick it up again. What you ask, and the meeting details it looks up to answer you, are sent to Anthropic to
            generate its replies.
          </li>
        )}
        <li>
          <strong>Connected calendars and Zoom:</strong> access tokens for the accounts you connect, stored encrypted. We read your
          busy times when someone views your booking page, and we create, update and delete the events for meetings booked
          through Slotnest. We don&apos;t store the contents of your other calendar events.
        </li>
        <li>
          <strong>Billing:</strong> payments are handled by Stripe. We keep your plan and payment status, not your card details.
        </li>
        <li>
          <strong>Cookies:</strong> one cookie keeps you signed in, and a short-lived one protects calendar connections. We don&apos;t
          use advertising or analytics cookies.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run Slotnest: show availability, book, reschedule and cancel meetings, send confirmations and reminders, bill
        accounts, and give support. We don&apos;t sell personal data or use it for advertising.
      </p>

      <h2>Google user data</h2>
      <p>
        Slotnest&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including
        the Limited Use requirements. We use Google Calendar access only to check your free/busy times and to manage the events
        for meetings booked through Slotnest. People don&apos;t read this data except with your permission for support, for
        security, or where the law requires it. We don&apos;t use it to train AI or machine-learning models.
      </p>

      <h2>Who we share it with</h2>
      <p>
        Service providers that run parts of Slotnest for us: DigitalOcean (hosting), Resend (email), Stripe (payments),{" "}
        {ai && "Anthropic (the AI assistant, only when you use it), "}and the Google, Microsoft and Zoom accounts you choose to
        connect. When someone books you, their details are shared with you and with the other hosts of that meeting.
      </p>

      <h2>How long we keep it</h2>
      <p>
        While your account is open. Disconnecting a calendar deletes its tokens. If you close your account we delete your data
        within 30 days, apart from billing records we must keep by law. Backups are kept for up to 14 days.
      </p>

      <h2>Your choices</h2>
      <p>
        You can see and change most of your data in the dashboard. To get a copy, correct or delete your data, or if someone has
        booked you and you want your booking details removed, email <ContactLink />.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we&apos;ll email account holders before it takes effect.</p>
      <LegalFooter />
    </main>
  );
}
