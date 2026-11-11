import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Slotnest · Beautiful scheduling without the monthly bill",
  description:
    "Booking pages, round-robin and collective team meetings, Google Calendar sync and reminders. Free for one event type; pay once, then a small yearly fee, for everything else.",
};

// The footer names the operator from the server's environment, so render at request time.
export const dynamic = "force-dynamic";

// Small stroke icons (24×24, currentColor) used across the page.
const ICONS = {
  calendar: "M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  rotate: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  palette: "M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A1.7 1.7 0 0 1 12 22ZM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01",
  code: "m16 18 6-6-6-6M8 6l-6 6 6 6",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2",
  video: "m22 8-6 4 6 4V8ZM2 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2Z",
  check: "M20 6 9 17l-5-5",
  card: "M2 7h20M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  form: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v4",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const FEATURES: { icon: keyof typeof ICONS; tint: string; title: string; text: string; wide?: boolean; chips?: string[] }[] = [
  {
    icon: "calendar", tint: "i-blue", wide: true, title: "Never double-booked",
    text: "Slotnest checks your Google Calendar before offering a time, then adds the meeting with a Google Meet link the moment someone books.",
    chips: ["Live free/busy", "Buffers", "Minimum notice", "Daily limits"],
  },
  {
    icon: "people", tint: "i-violet", wide: true, title: "Built for teams",
    text: "Share one link for your whole team. Round-robin spreads meetings evenly; collective events find a time when everyone is free.",
    chips: ["Round-robin", "Collective", "One team link"],
  },
  { icon: "bell", tint: "i-orange", title: "Reminders that cut no-shows", text: "Confirmations, reminders and calendar invites go out automatically, with one-click reschedule and cancel." },
  { icon: "palette", tint: "i-pink", title: "Looks like you", text: "Add your logo and brand colour. Your booking page matches your website in light and dark mode." },
  { icon: "code", tint: "i-teal", title: "Embed anywhere", text: "Drop your calendar inline on any page, or open it in a pop-up from your own button. Two lines of code." },
  { icon: "globe", tint: "i-green", title: "Every time zone", text: "Invitees see times in their own zone automatically, so nobody has to do the maths." },
  { icon: "clock", tint: "i-blue", title: "Your hours, your rules", text: "Set weekly hours, date overrides and how far ahead people can book." },
  { icon: "card", tint: "i-violet", title: "No monthly bill", text: "Start free. When you need more, pay once to set up, then a small yearly fee per seat. No monthly subscription." },
  { icon: "form", tint: "i-orange", title: "Ask the right questions", text: "Add your own questions to the booking form, like company, phone or team size. Answers land in your inbox and calendar." },
  { icon: "plug", tint: "i-teal", title: "Webhooks for your stack", text: "Send every booking to your CRM, Slack, Zapier or Make the moment it happens. Signed and retried automatically." },
  { icon: "link", tint: "i-pink", title: "Fits your funnel", text: "Prefill name and email from your sign-up form, then send people to your own thank-you page after they book." },
];

const FAQ = [
  ["Is there a free plan?", "Yes. Free is yours to keep, with no card: one event type, calendar sync, Google Meet and Zoom, confirmations and reminders. Upgrade when you need more event types, a team, routing forms, payments, webhooks or your own branding."],
  ["Which calendars and video tools work?", "Google Calendar, Google Meet and Zoom today. Outlook is on the way."],
  ["Can Slotnest send bookings to my other tools?", "Yes. Add a webhook and every new, rescheduled or cancelled booking is sent to your CRM, Slack, Zapier, Make or your own app."],
  ["How is the price so low?", "Slotnest is built lean and charges once to set you up, then a small yearly fee to keep it running. No monthly subscription."],
  ["Can the people booking me use it for free?", "Yes. Anyone can book you without an account. Only the people taking bookings need a seat."],
  ["Can I put my booking page on my own website?", "Yes. Every event type has an embed code for an inline calendar or a pop-up button."],
];

export default function Home() {
  return (
    <main className="home">
      <header className="lp-nav">
        <div className="lp-wrap">
          <Logo />
          <nav aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <Link className="signin" href="/login">Sign in</Link>
          <Link className="primary" href="/login">Get started</Link>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap">
          <span className="eyebrow"><b>New</b> Team links with round-robin and collective meetings</span>
          <h1>
            Scheduling, <span className="gradient-text">beautifully simple.</span>
          </h1>
          <p className="lead">
            Share a link, let people pick a time, and Slotnest does the rest: calendar checks, Meet links, invites and reminders.
            Without the monthly bill.
          </p>
          <div className="cta-row">
            <Link className="primary" href="/login">Start free</Link>
            <a className="secondary" href="#how">See how it works</a>
          </div>
          <p className="fineprint">Free plan · No card needed · Set up in two minutes</p>

          <div className="shot" aria-hidden="true">
            <div className="window">
              <div className="window-bar"><i /><i /><i /><span>slotnest.at20.ai/you/intro-call</span></div>
              <div className="window-body">
                <div className="mock-info">
                  <div className="mock-avatar" />
                  <p>Alex Morgan</p>
                  <h3>Intro call</h3>
                  <p><Icon name="clock" /> 30 min</p>
                  <p><Icon name="video" /> Google Meet</p>
                  <p><Icon name="globe" /> Your time zone</p>
                </div>
                <div className="mock-pick">
                  <h4>Select a date &amp; time</h4>
                  <div className="mock-dates">
                    <div className="off">Mon<b>9</b></div>
                    <div>Tue<b>10</b></div>
                    <div className="on">Wed<b>11</b></div>
                    <div>Thu<b>12</b></div>
                    <div>Fri<b>13</b></div>
                    <div className="off">Sat<b>14</b></div>
                    <div className="off">Sun<b>15</b></div>
                  </div>
                  <div className="mock-times">
                    <div>9:00</div><div>9:30</div><div className="pick">10:30</div>
                    <div>11:00</div><div>1:30</div><div>2:00</div>
                    <div>3:30</div><div>4:00</div><div>4:30</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="float f1">
              <span className="dot i-green"><Icon name="check" /></span>
              <span>Meeting booked<small>Wed 11 · 10:30</small></span>
            </div>
            <div className="float f2">
              <span className="dot i-blue"><Icon name="calendar" /></span>
              <span>Added to Google Calendar<small>Meet link created</small></span>
            </div>
          </div>

          <div className="works-with">
            Works with
            <ul>
              <li><Icon name="calendar" /> Google Calendar</li>
              <li><Icon name="video" /> Google Meet</li>
              <li><Icon name="video" /> Zoom</li>
              <li><Icon name="card" /> Stripe</li>
              <li><Icon name="plug" /> Zapier &amp; webhooks</li>
              <li><Icon name="code" /> Any website</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="lp-section" id="features">
        <div className="lp-wrap">
          <div className="section-head">
            <span className="kicker">Everything included</span>
            <h2>All the scheduling power. None of the upsells.</h2>
            <p>The features other tools save for their priciest plans come with every Slotnest seat.</p>
          </div>
          <div className="bento">
            {FEATURES.map((f) => (
              <article key={f.title} className={f.wide ? "tile wide" : "tile"}>
                <span className={`icon ${f.tint}`}><Icon name={f.icon} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                {f.chips && <div className="chips">{f.chips.map((c) => <span key={c}>{c}</span>)}</div>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section" id="how">
        <div className="lp-wrap">
          <div className="section-head">
            <span className="kicker">How it works</span>
            <h2>Up and running before your coffee cools.</h2>
          </div>
          <div className="steps">
            <div className="step">
              <h3>Connect your calendar</h3>
              <p>Sign in with your email and connect Google Calendar, so Slotnest always knows when you&apos;re busy.</p>
            </div>
            <div className="step">
              <h3>Set your availability</h3>
              <p>Pick your working hours and create an event, like a 30-minute intro call. Add teammates if you like.</p>
            </div>
            <div className="step">
              <h3>Share your link</h3>
              <p>Send it in an email, add it to your signature or embed it on your site. Bookings land in your calendar.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="pricing">
        <div className="lp-wrap">
          <div className="section-head">
            <span className="kicker">Pricing</span>
            <h2>Start free. Pay once when you grow.</h2>
            <p>Free for one event type. Paid plans are a one-time setup fee, then a small yearly fee per seat. No monthly subscription.</p>
          </div>
          <div className="pricing">
            <div className="price-card">
              <h3>Free</h3>
              <p className="for">For trying it out, or one kind of meeting.</p>
              <div className="price"><strong>$0</strong><span>forever</span></div>
              <p className="price-then">no card needed</p>
              <ul className="ticks">
                <li>One event type, unlimited bookings</li>
                <li>Google Calendar, Meet and Zoom</li>
                <li>Custom booking questions</li>
                <li>Reminders, reschedule and cancel links</li>
                <li>Website embed</li>
              </ul>
              <Link className="secondary" href="/login">Start free</Link>
            </div>
            <div className="price-card">
              <h3>Solo</h3>
              <p className="for">For founders, consultants and coaches.</p>
              <div className="price"><strong>$40</strong><span>one-time</span></div>
              <p className="price-then">then <b>$20 a year</b></p>
              <ul className="ticks">
                <li>Everything in Free</li>
                <li>Unlimited event types</li>
                <li>Routing forms and webhooks</li>
                <li>Take payments for bookings</li>
                <li>Custom reminder emails</li>
                <li>Your logo, colours, no Slotnest badge</li>
              </ul>
              <Link className="secondary" href="/login">Start free, upgrade anytime</Link>
            </div>
            <div className="price-card featured">
              <span className="badge">For teams</span>
              <h3>Team</h3>
              <p className="for">For sales, support and customer teams.</p>
              <div className="price"><strong>$64</strong><span>one-time per seat</span></div>
              <p className="price-then">then <b>$32 a year</b> per seat</p>
              <ul className="ticks">
                <li>Everything in Solo</li>
                <li>One shared team link</li>
                <li>Round-robin and collective meetings</li>
                <li>Invite teammates by email</li>
                <li>Team seats cover members&apos; own pages</li>
              </ul>
              <Link className="primary" href="/login">Start free, upgrade anytime</Link>
            </div>
          </div>
          <p className="price-note">Prices in US dollars. Start on Free with no card; upgrade from your dashboard when you&apos;re ready.</p>
        </div>
      </section>

      <section className="lp-section" id="faq">
        <div className="lp-wrap">
          <div className="section-head">
            <h2>Questions, answered.</h2>
          </div>
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <div className="lp-wrap">
        <section className="final-cta">
          <h2>Your calendar, finally in good hands.</h2>
          <p>Create your booking link in two minutes. Free to start, no card needed.</p>
          <div className="cta-row">
            <Link className="btn-light" href="/login">Get started free</Link>
          </div>
        </section>
      </div>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <Logo />
          <LegalFooter />
        </div>
      </footer>
    </main>
  );
}
