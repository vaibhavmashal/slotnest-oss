import { PgBoss, type SendOptions } from "pg-boss";
import type { WebhookPayload } from "@/lib/webhooks";

export const QUEUES = ["booking-confirmed", "booking-rescheduled", "booking-cancelled", "booking-reminder", "webhook-delivery", "payment-check"] as const;
export type QueueName = (typeof QUEUES)[number];

export interface JobData {
  "booking-confirmed": { bookingId: string };
  "booking-rescheduled": { bookingId: string; previousStart: string };
  "booking-cancelled": { bookingId: string; by: "invitee" | "host" };
  /** `reminderId` names one of the event type's reminders; `kind` is from jobs queued before reminder workflows. */
  "booking-reminder": { bookingId: string; startAt: string; reminderId?: string; kind?: "24h" | "1h" };
  "webhook-delivery": { webhookId: string; payload: WebhookPayload };
  "payment-check": { bookingId: string };
}

const g = globalThis as unknown as { boss?: Promise<PgBoss> };

/** One pg-boss instance per process (survives Next.js dev hot reloads). Jobs live in the "pgboss" schema. */
export function boss(): Promise<PgBoss> {
  g.boss ??= (async () => {
    const b = new PgBoss(process.env.DATABASE_URL!);
    b.on("error", (err) => console.error("[jobs]", err));
    await b.start();
    for (const q of QUEUES) {
      await b.createQueue(q, { retryLimit: 5, retryDelay: 30, retryBackoff: true }).catch(() => {});
    }
    return b;
  })();
  return g.boss;
}

export async function enqueue<Q extends QueueName>(name: Q, data: JobData[Q], options: SendOptions = {}) {
  return (await boss()).send(name, data, options);
}
