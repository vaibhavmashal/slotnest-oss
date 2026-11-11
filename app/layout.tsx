import type { Metadata } from "next";
import "./globals.css";

// metadataBase makes the link-preview image URL absolute. APP_URL isn't set while the Docker image builds (when
// static pages are prerendered), so fall back to the public address.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://slotnest.at20.ai"),
  title: "Slotnest",
  description: "Book a time",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
