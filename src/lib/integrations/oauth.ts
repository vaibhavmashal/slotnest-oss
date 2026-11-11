// OAuth 2.0 authorization-code flows for Google, Microsoft (Entra ID) and Zoom.
import { config } from "@/lib/config";

export type Provider = "google" | "microsoft" | "zoom";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
}

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
const MICROSOFT_SCOPES = ["offline_access", "openid", "email", "User.Read", "Calendars.ReadWrite"];

export const redirectUri = (p: Provider) => `${config.appUrl}/api/integrations/${p}/callback`;

export function providerConfig(p: Provider) {
  const c = config[p];
  if (!c) throw new Error(`${p} is not configured. See SETUP.md.`);
  return c;
}

export function isConfigured(p: Provider): boolean {
  return config[p] !== null;
}

export function authorizeUrl(p: Provider, state: string): string {
  const c = providerConfig(p);
  const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: redirectUri(p), response_type: "code", state });
  switch (p) {
    case "google":
      q.set("scope", GOOGLE_SCOPES.join(" "));
      q.set("access_type", "offline");
      q.set("prompt", "consent"); // always return a refresh token
      q.set("include_granted_scopes", "true");
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    case "microsoft":
      q.set("scope", MICROSOFT_SCOPES.join(" "));
      q.set("response_mode", "query");
      q.set("prompt", "select_account");
      return `https://login.microsoftonline.com/${config.microsoft!.tenant}/oauth2/v2.0/authorize?${q}`;
    case "zoom":
      return `https://zoom.us/oauth/authorize?${q}`; // scopes are configured on the Zoom app
  }
}

function tokenEndpoint(p: Provider): string {
  switch (p) {
    case "google":
      return "https://oauth2.googleapis.com/token";
    case "microsoft":
      return `https://login.microsoftonline.com/${config.microsoft!.tenant}/oauth2/v2.0/token`;
    case "zoom":
      return "https://zoom.us/oauth/token";
  }
}

async function tokenRequest(p: Provider, params: Record<string, string>, previousRefreshToken?: string): Promise<TokenSet & { idToken?: string }> {
  const c = providerConfig(p);
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (p === "zoom") {
    headers.Authorization = `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", c.clientId);
    body.set("client_secret", c.clientSecret);
  }
  if (p === "microsoft") body.set("scope", MICROSOFT_SCOPES.join(" "));

  const res = await fetch(tokenEndpoint(p), { method: "POST", headers, body });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || !json.access_token) {
    throw new OAuthError(p, `${res.status} ${json.error ?? ""} ${json.error_description ?? json.reason ?? ""}`.trim(), json.error === "invalid_grant");
  }
  const refreshToken = json.refresh_token ?? previousRefreshToken; // Google omits it on refresh; Microsoft and Zoom rotate it
  if (!refreshToken) throw new OAuthError(p, "No refresh token returned", false);
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000),
    scopes: String(json.scope ?? "").split(/[ ,]+/).filter(Boolean),
    idToken: json.id_token,
  };
}

export class OAuthError extends Error {
  constructor(
    public provider: Provider,
    message: string,
    /** The grant was revoked or expired; the user must reconnect. */
    public revoked: boolean,
  ) {
    super(`${provider} OAuth: ${message}`);
  }
}

export function exchangeCode(p: Provider, code: string) {
  return tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p) });
}

export function refreshTokens(p: Provider, refreshToken: string) {
  return tokenRequest(p, { grant_type: "refresh_token", refresh_token: refreshToken }, refreshToken);
}

/** The account's email address, used to label the connection (and as the Microsoft schedule id). */
export async function fetchAccountEmail(p: Provider, tokens: TokenSet & { idToken?: string }): Promise<string> {
  if (p === "google" && tokens.idToken) {
    // Received directly from Google's token endpoint over TLS, so the payload can be read without verifying the signature.
    const payload = JSON.parse(Buffer.from(tokens.idToken.split(".")[1], "base64url").toString("utf8"));
    if (payload.email) return String(payload.email).toLowerCase();
  }
  const url = {
    google: "https://openidconnect.googleapis.com/v1/userinfo",
    microsoft: "https://graph.microsoft.com/v1.0/me",
    zoom: "https://api.zoom.us/v2/users/me",
  }[p];
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  if (!res.ok) throw new Error(`${p} profile lookup failed: ${res.status}`);
  const me = (await res.json()) as Record<string, any>;
  return String(me.email ?? me.mail ?? me.userPrincipalName).toLowerCase();
}
