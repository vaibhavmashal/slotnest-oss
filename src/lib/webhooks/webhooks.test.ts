import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bookingRedirect, isHttpsUrl } from "@/lib/urls";
import { isPrivateAddress, signature } from "./sign";

describe("webhook signature", () => {
  it("is t=<timestamp>,v1=<HMAC-SHA256 of t.body>", () => {
    const sig = signature("whsec_test", '{"a":1}', 1_700_000_000);
    const expected = createHmac("sha256", "whsec_test").update('1700000000.{"a":1}').digest("hex");
    expect(sig).toBe(`t=1700000000,v1=${expected}`);
  });
});

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "refuses %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "172.32.0.1", "2606:4700::1111"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("urls", () => {
  it("accepts only full https addresses without credentials", () => {
    expect(isHttpsUrl("https://at20.ai/thanks")).toBe(true);
    expect(isHttpsUrl("http://at20.ai/thanks")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("https://user:pw@at20.ai")).toBe(false);
    expect(isHttpsUrl("at20.ai")).toBe(false);
  });

  it("adds invitee details to the redirect only when asked, keeping existing parameters", () => {
    const details = { name: "Ann Lee", email: "ann@x.test", start: "2026-11-05T10:00:00.000Z", end: "2026-11-05T10:30:00.000Z", eventTitle: "Intro" };
    expect(bookingRedirect("https://at20.ai/thanks?src=ads", false, details)).toBe("https://at20.ai/thanks?src=ads");
    const u = new URL(bookingRedirect("https://at20.ai/thanks?src=ads", true, details));
    expect(Object.fromEntries(u.searchParams)).toEqual({ src: "ads", name: "Ann Lee", email: "ann@x.test", start: details.start, end: details.end, event: "Intro" });
  });
});
