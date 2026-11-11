import nodemailer, { type Transporter } from "nodemailer";
import { config } from "@/lib/config";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Calendar invite: sent as a text/calendar alternative part plus an invite.ics attachment. */
  ics?: { method: "REQUEST" | "CANCEL"; content: string };
}

let transport: Transporter | null = null;

export async function sendEmail(msg: OutgoingEmail): Promise<void> {
  const { provider, from } = config.email;

  if (provider === "log") {
    console.log(`[email] to=${msg.to} subject="${msg.subject}"${msg.ics ? ` ics=${msg.ics.method}` : ""}\n${msg.text}\n`);
    return;
  }

  if (provider === "smtp") {
    if (!config.email.smtpUrl) throw new Error("EMAIL_PROVIDER=smtp requires SMTP_URL");
    transport ??= nodemailer.createTransport(config.email.smtpUrl);
    await transport.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(msg.ics && { icalEvent: { method: msg.ics.method, filename: "invite.ics", content: msg.ics.content } }),
    });
    return;
  }

  if (provider === "postmark") {
    if (!config.email.postmarkToken) throw new Error("EMAIL_PROVIDER=postmark requires POSTMARK_SERVER_TOKEN");
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": config.email.postmarkToken,
      },
      body: JSON.stringify({
        From: from,
        To: msg.to,
        Subject: msg.subject,
        TextBody: msg.text,
        HtmlBody: msg.html,
        MessageStream: "outbound",
        ...(msg.ics && {
          Attachments: [
            {
              Name: "invite.ics",
              Content: Buffer.from(msg.ics.content, "utf8").toString("base64"),
              ContentType: `text/calendar; charset=utf-8; method=${msg.ics.method}`,
            },
          ],
        }),
      }),
    });
    if (!res.ok) throw new Error(`Postmark ${res.status}: ${await res.text()}`);
    return;
  }

  throw new Error(`Unknown EMAIL_PROVIDER: ${provider}`);
}
