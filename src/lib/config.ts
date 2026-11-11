// All configuration comes from environment variables (see .env.example and SETUP.md).
// Integrations whose variables are missing are reported as "not configured" instead of failing at startup.

const env = (name: string) => {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
};

export const config = {
  appUrl: (env("APP_URL") ?? "http://localhost:3100").replace(/\/$/, ""),
  isProd: process.env.NODE_ENV === "production",

  google: env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")
    ? { clientId: env("GOOGLE_CLIENT_ID")!, clientSecret: env("GOOGLE_CLIENT_SECRET")! }
    : null,
  microsoft: env("MICROSOFT_CLIENT_ID") && env("MICROSOFT_CLIENT_SECRET")
    ? { clientId: env("MICROSOFT_CLIENT_ID")!, clientSecret: env("MICROSOFT_CLIENT_SECRET")!, tenant: env("MICROSOFT_TENANT") ?? "common" }
    : null,
  zoom: env("ZOOM_CLIENT_ID") && env("ZOOM_CLIENT_SECRET")
    ? { clientId: env("ZOOM_CLIENT_ID")!, clientSecret: env("ZOOM_CLIENT_SECRET")! }
    : null,

  email: {
    /** "log" prints emails to the server console; "smtp" (e.g. local Mailpit) or "postmark" send them. */
    provider: (env("EMAIL_PROVIDER") ?? "log") as "log" | "smtp" | "postmark",
    from: env("EMAIL_FROM") ?? "Slotnest <bookings@localhost>",
    smtpUrl: env("SMTP_URL"),
    postmarkToken: env("POSTMARK_SERVER_TOKEN"),
  },

  stripe: env("STRIPE_SECRET_KEY") && env("STRIPE_WEBHOOK_SECRET")
    ? {
        secretKey: env("STRIPE_SECRET_KEY")!,
        webhookSecret: env("STRIPE_WEBHOOK_SECRET")!,
        prices: {
          solo: { setup: env("STRIPE_PRICE_SOLO_SETUP"), yearly: env("STRIPE_PRICE_SOLO_YEARLY") },
          team: { setup: env("STRIPE_PRICE_TEAM_SETUP"), yearly: env("STRIPE_PRICE_TEAM_YEARLY") },
        },
      }
    : null,

  /** The AI scheduling assistant in the dashboard (see lib/assistant); hidden when there's no API key. */
  anthropic: env("ANTHROPIC_API_KEY")
    ? {
        apiKey: env("ANTHROPIC_API_KEY")!,
        model: env("ASSISTANT_MODEL") ?? "claude-opus-5-5",
        /** Messages each user can send the assistant per day (UTC), to cap spend. */
        dailyLimit: Number(env("ASSISTANT_DAILY_LIMIT") ?? 50),
      }
    : null,

  /** Who runs this copy: named in the footer, privacy policy and terms. The contact falls back to the first admin. */
  operator: {
    company: env("COMPANY_NAME"),
    contactEmail: env("CONTACT_EMAIL") ?? env("ADMIN_EMAILS")?.split(",")[0].trim() ?? null,
  },

  /** Accounts that can open the admin page (/dashboard/admin): comma-separated sign-in emails. */
  adminEmails: (env("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  /**
   * Paid-only features (hiding "Powered by Slotnest") when Stripe isn't configured, e.g. local development.
   * Set UNBILLED_PAID_FEATURES=false to test the free-plan behaviour locally.
   */
  unbilledPaidFeatures: env("UNBILLED_PAID_FEATURES") !== "false",

  /** Run the background job worker inside the web process (simplest single-server deployment). */
  runWorkerInProcess: env("RUN_WORKER") !== "false",
};

export function tokenEncryptionKey(): Buffer {
  const raw = env("TOKEN_ENCRYPTION_KEY");
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}
