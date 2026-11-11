import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assets } from "@/db/schema";
import { assetStore } from "@/lib/branding/store";

// Public brand images (logos and profile photos appear on public booking pages and in emails).
// A new upload always gets a new id, so responses can be cached forever.
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^([0-9a-f-]{36})\.(png|jpg|webp)$/.exec(file);
  if (!m) return new Response("Not found", { status: 404 });
  const [a] = await db.select().from(assets).where(eq(assets.id, m[1]));
  if (!a) return new Response("Not found", { status: 404 });
  const bytes = await assetStore().get(a.storageKey);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": a.contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
