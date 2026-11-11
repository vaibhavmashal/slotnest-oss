import { boss } from "./queue";
import { checkPayment } from "@/lib/payments";
import { deliver } from "@/lib/webhooks";
import { onCancelled, onConfirmed, onReminder, onRescheduled } from "./effects";

let started = false;

export async function startWorker() {
  if (started) return;
  started = true;
  const b = await boss();
  // Handlers receive batches (pg-boss v12); a thrown error fails the job and pg-boss retries with backoff.
  await b.work("booking-confirmed", async (jobs: any[]) => { for (const j of jobs) await onConfirmed(j.data); });
  await b.work("booking-rescheduled", async (jobs: any[]) => { for (const j of jobs) await onRescheduled(j.data); });
  await b.work("booking-cancelled", async (jobs: any[]) => { for (const j of jobs) await onCancelled(j.data); });
  await b.work("booking-reminder", async (jobs: any[]) => { for (const j of jobs) await onReminder(j.data); });
  await b.work("payment-check", async (jobs: any[]) => { for (const j of jobs) await checkPayment(j.data.bookingId); });
  await b.work("webhook-delivery", async (jobs: any[]) => { for (const j of jobs) await deliver(j.data.webhookId, j.data.payload); });
  console.log("[jobs] worker started");
}
