import { notFound } from "next/navigation";
import { getPublicForm } from "@/lib/routing";
import { getBranding } from "@/lib/branding";
import { toPageBranding } from "@/lib/branding/page";
import RoutingFormClient from "./RoutingFormClient";

export const dynamic = "force-dynamic";

type Params = Promise<{ user: string; form: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { user, form } = await params;
  const row = await getPublicForm(user, form);
  return { title: row ? `${row.form.title} · ${row.owner.name}` : "Not found" };
}

/** A routing form: a few questions, then on to the right booking page, another page, or a message. */
export default async function RoutingFormPage({ params }: { params: Params }) {
  const { user, form } = await params;
  const row = await getPublicForm(user, form);
  if (!row) notFound();
  const branding = toPageBranding(await getBranding(row.owner));
  return (
    <RoutingFormClient
      formId={row.form.id}
      title={row.form.title}
      description={row.form.description}
      hostName={row.owner.name}
      questions={row.form.questions}
      branding={branding}
    />
  );
}
