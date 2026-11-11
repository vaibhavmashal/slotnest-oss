# Setup: third-party accounts and keys

Everything runs locally without any third-party keys:
- Email goes to the local Mailpit inbox (http://localhost:8026).
- Calendar and Zoom connect buttons show "not configured".
- Billing is switched off, so every account can take bookings.

Each section below switches on one integration. Put the values in `.env.local` for local work, or in the server's environment in production (see `.env.example` for every variable). Restart the app after changing them.

Never commit real keys. `.env.local` is git-ignored.

---

## 1. Core (required in production)

| Variable | How |
|---|---|
| `APP_URL` | The public URL, for example `https://book.example.com`. All OAuth redirect URIs and email links use it. |
| `TOKEN_ENCRYPTION_KEY` | Generate it with `openssl rand -base64 32`. It encrypts calendar and Zoom tokens at rest. **If you lose it, every user has to reconnect their calendars.** Keep it in your password manager. |
| `DATABASE_URL` | Postgres 16 with the `btree_gist` and `pgcrypto` extensions. The migration creates both. |

Then run `npm run db:migrate`.

## 2. Email (confirmations, invites, reminders, sign-in links)

**Recommended: Resend**, sent over SMTP, so no extra code is needed.
1. Create a Resend account. Under **Domains**, add a sending subdomain such as `mail.yourdomain.com`.
2. Add the DNS records Resend shows you in Cloudflare, all set to **DNS only**, not proxied:
   - the DKIM `TXT` record (`resend._domainkey.mail`);
   - the `MX` and SPF `TXT` records on `send.mail`.

   Wait until Resend shows the domain as **Verified**.
3. Under **API Keys**, create a key with **Sending access**, limited to that domain.
4. Set:
   ```
   EMAIL_PROVIDER=smtp
   SMTP_URL=smtps://resend:<API key>@smtp.resend.com:2465
   EMAIL_FROM="Your Product <bookings@mail.yourdomain.com>"
   ```
   - Use port **2465**: DigitalOcean blocks the standard SMTP ports (25, 465, 587) on droplets.
   - The From address must be on the verified domain, exactly. If your domain's DMARC policy is `p=reject` with strict alignment, mail signed for a different domain is rejected.

**Also supported:** Postmark (`EMAIL_PROVIDER=postmark`, `POSTMARK_SERVER_TOKEN`).

**Alternative:** any SMTP service, such as Amazon SES SMTP: `EMAIL_PROVIDER=smtp` and `SMTP_URL=smtps://USER:PASS@email-smtp.REGION.amazonaws.com:465`.

## 3. Google Calendar and Google Meet

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Calendar API**.
2. Under **OAuth consent screen**, choose **External**. Add your app name, support email, privacy policy and terms URLs, then add these scopes:
   - `openid`, `email`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.freebusy`
3. Under **Credentials**, create an **OAuth client ID** of type **Web application**. Use this authorised redirect URI:
   `${APP_URL}/api/integrations/google/callback` (for local work: `http://localhost:3100/api/integrations/google/callback`).
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**While the app is in "Testing":**
- Only test users you add on the consent screen (up to 100) can connect.
- Their refresh tokens expire after 7 days.

**Before launch:**
- Submit the app for verification. Calendar scopes are classed as *sensitive*, so Google reviews your branding, your scope justification and a short demo video.
- This usually takes a few days to a few weeks.
- These scopes are not *restricted*, so no CASA security assessment is needed.

Meet links come from Google itself: they're created with the event on the host's Google Calendar. An event type set to "Google Meet" therefore needs the host's "add bookings to" calendar to be a Google calendar.

## 4. Microsoft 365 / Outlook

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to **App registrations** and choose **New registration**.
   - **Supported account types:** *Accounts in any organizational directory and personal Microsoft accounts*.
   - **Redirect URI:** platform **Web**, value `${APP_URL}/api/integrations/microsoft/callback`.
2. Under **Certificates & secrets**, create a **New client secret**.
   - Copy the *Value* immediately; it's only shown once.
   - Secrets expire (24 months at most), so put a reminder in your calendar to rotate it.
3. Under **API permissions**, add these **Microsoft Graph delegated** permissions: `Calendars.ReadWrite`, `User.Read`, `offline_access`, `openid`, `email`. They don't need admin consent.
4. Set `MICROSOFT_CLIENT_ID` (the *Application (client) ID*), `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT=common`.
5. Before launch, complete **Publisher verification** (it needs a Microsoft Partner Network ID). Without it, users see an "unverified" warning, and many company tenants block the consent.

## 5. Zoom

1. In the [Zoom App Marketplace](https://marketplace.zoom.us/), go to **Develop → Build App** and create a **General App** with **user-managed** OAuth.
2. Set the **OAuth Redirect URL**, and add it to the allow list: `${APP_URL}/api/integrations/zoom/callback`.
3. Add these scopes: `meeting:write:meeting`, `meeting:update:meeting`, `meeting:delete:meeting`, `user:read:user`.
4. Set `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET`.
5. Until the app is published, only users in your own Zoom account can connect. To let customers connect, submit the app for Marketplace review.

## 6. Stripe billing (one-time setup fee plus yearly maintenance)

Prices live in Stripe; the app only stores their IDs.

1. In the Stripe dashboard, switch to **Test mode** and copy the secret key (`sk_test_…`) into `STRIPE_SECRET_KEY`.
2. Run `npm run stripe:setup`. It creates the Solo and Team products, each with a one-time setup price and a yearly maintenance price per seat, and prints four `STRIPE_PRICE_…` lines. Paste them into `.env.local`. It is safe to re-run: prices are found again by lookup key. In production, add `--live --webhook=${APP_URL}/api/billing/webhook` to also create the webhook endpoint and print its `STRIPE_WEBHOOK_SECRET`.
   - The amounts are set at the top of `scripts/stripe-setup.ts`: currently $40 + $20/yr and $64 + $32/yr. Change them there before running if the pricing changes.
   - The script refuses live keys unless you pass `--live`.
3. Set up the webhook:
   - **Local:** install the Stripe CLI, run `stripe listen --forward-to localhost:3100/api/billing/webhook`, and put the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`.
   - **Production:** in **Developers → Webhooks**, add the endpoint `${APP_URL}/api/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Use its signing secret.
4. In **Settings → Billing → Customer portal**, turn the portal on. This powers the "Manage payment method and invoices" button.
5. Test card: `4242 4242 4242 4242`, any future date, any CVC.

Once Stripe is configured, plans are enforced (`src/lib/billing/access.ts`):
- **Free** (every new account, no card): one active event type takes bookings, with calendar sync, Meet and Zoom,
  confirmations and the standard reminders. "Powered by Slotnest" is shown. Extra event types stay saved but aren't
  listed or bookable, and the dashboard marks them.
- **Solo / Team** (paid) unlock unlimited event types, routing forms, taking payments, webhooks, custom reminder wording
  and removing the branding; Team adds teams. A seat on a paid Team plan unlocks them for the member's own pages too.
- Accounts created before the free plan keep their 14-day trial (everything) until it ends, then move to Free.
- A cancelled subscription falls back to Free. `past_due` keeps the paid features while Stripe retries the payment.
- Without Stripe (local development) `UNBILLED_PAID_FEATURES` decides: on (default) unlocks everything, `false` acts as Free.

## 6a. Paid bookings (Stripe Connect)

Hosts connect their own Stripe account and invitees pay them directly (direct charges, no application fee).
Uses the same `STRIPE_SECRET_KEY`; no extra webhook (payments are confirmed when the invitee returns from
Checkout and re-checked by background jobs).

1. In the Stripe dashboard, open **Connect** and complete **Get started** (platform profile), in live and test mode.
   Hosts' accounts are Accounts v2 merchants (Stripe no longer accepts v1 accounts for new platforms) with
   Stripe-hosted onboarding and the full Stripe dashboard; Stripe collects their fees and covers losses, so only the
   host can fill in their details and accept Stripe's terms (in Stripe's form, not through the API).
2. If `STRIPE_SECRET_KEY` is a restricted key, give it **Write** on Connect **Accounts** (v2 core accounts) and
   **Account Links**, **Write** on **Checkout Sessions** and **Refunds**, and **Read** on **PaymentIntents**.
3. Hosts pick their business's country and click **Connect Stripe** on the dashboard (Overview → Payments), then set
   a price on an event type. Stripe needs the country before it can set an account up to take payments.

A paid booking holds its time for 32 minutes while the invitee pays (Checkout sessions last 30); unpaid holds are
released and nothing is sent. Cancelling a paid booking refunds it when the event type says so (the default).

## 7. Branding uploads (logos and profile photos)

- Files are stored on local disk in `storage/assets/` under the app's working directory, or in `ASSET_DIR` if set. Use a persistent path on the server, such as `/var/lib/slotnest/assets`, and include it in backups. Losing it loses customers' logos and photos; the database rows stay, but the images 404.
- Uploads are capped at 1 MB in the app (PNG, JPEG or WebP, checked by content; SVG is rejected). **Nginx's default `client_max_body_size` is 1 MB, so raise it** in the server block, or uploads near the limit fail with 413:
  ```nginx
  client_max_body_size 4m;
  ```
- Images are served publicly at `/assets/<id>.<ext>` with long-lived caching, because they appear on public pages and in emails. A new upload gets a new URL.
- Emails use absolute image URLs built from `APP_URL`, so `APP_URL` must be the public HTTPS address. Images in emails sent from a `localhost` setup only load on that machine.
- Moving to S3 or DigitalOcean Spaces later means implementing the `AssetStore` interface in `src/lib/branding/store.ts`; nothing else changes.
- "Powered by Slotnest" can only be hidden by paid accounts (Stripe status active or past_due). While Stripe isn't configured, `UNBILLED_PAID_FEATURES` decides: it defaults to `true`, so every account can hide it locally. Set it to `false` to test the free-plan behaviour.

## 8. Teams and seats

- With Stripe configured, a team can have as many members (plus pending invites) as the owner's Team plan has seats. During an old-style trial there is no limit, and without Stripe there is never one.
- Teams are on the Team plan (and old-style trials). On Free or Solo, the owner's team pages stop taking bookings.
- Adding seats after the first purchase isn't built yet. Changing the subscription quantity in the Stripe portal would update `seats` (through the webhook), but it wouldn't charge the one-time setup fee for the new seats, so leave quantity changes off in the portal for now.

## 9. Production notes

- The job worker (confirmations, calendar writes, reminders) runs inside the web process by default. To run it separately, set `RUN_WORKER=false` on the web process and run `npm run worker` as its own service.
- Jobs and retries are stored in Postgres (the `pgboss` schema), so there's no Redis to run.
- Reminder emails go out 24 hours and 1 hour before the meeting.

## 10. AI assistant (optional)

The dashboard's **Assistant** page answers questions about a host's meetings, open times, availability and links,
drafts messages, and proposes changes (cancelling a meeting, creating an event type) that only happen when the host
clicks Confirm. It's hidden until `ANTHROPIC_API_KEY` is set.

1. Create an API key at https://platform.claude.com (Settings → API keys) and set a monthly spend limit for the
   workspace. Add it to `.env` as `ANTHROPIC_API_KEY`.
2. Optional: `ASSISTANT_MODEL` (default `claude-opus-5-5`) and `ASSISTANT_DAILY_LIMIT` (messages per user per day,
   default 50). Token use per user per day is recorded in the `assistant_usage` table.

Conversations are stored in `assistant_conversations`. What hosts ask, and the meeting details the assistant looks up,
are sent to Anthropic (the privacy page says so).

## 11. Routing forms

No setup needed. Hosts build them under **Routing**; the public link is `/f/{username}/{form}`. Each rule sends people
to one of the host's event types (with name, email and answers to identically worded questions filled in), a web page,
or a message. Responses are listed on the form's page.

## 12. Admin page

Set `ADMIN_EMAILS` to the sign-in emails that may see every account and booking on the server (comma-separated), then
restart. Those accounts get an **Admin** link in the dashboard (`/dashboard/admin`): totals, accounts with their plan
and booking counts, and recent bookings with the time as the invitee saw it and in the host's time zone, with search
by name or email. For everyone else these pages don't exist (404).

Click an account to manage it:
- **Seats.** Free seats are added on top of the plan at no charge, and Stripe never changes them. For a Team plan paid
  through Stripe, paid seats can be changed too: more are charged right away (the per-seat setup fee plus the prorated
  yearly fee), fewer leave a prorated credit on the next invoice. Seats can't go below the number of team members.
- **Plan and billing** for accounts that don't pay through Stripe: Solo or Team, and a trial until a date, paid
  outside Stripe (comped), or the Free plan. Accounts with a Stripe subscription follow it; change those in Stripe.
- **Suspend / restore.** Turns the account's booking pages (and its team's) off and back on. Meetings already booked
  stay; the person can still sign in.
- **Team.** Remove members of a team the account owns, and revoke open invites.
