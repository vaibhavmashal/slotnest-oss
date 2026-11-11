import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, safeEqualHex, sha256 } from "./crypto";

describe("token encryption", () => {
  const key = randomBytes(32);

  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("refresh-token-value", key);
    const b = encrypt("refresh-token-value", key);
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a, key)).toBe("refresh-token-value");
  });

  it("rejects tampered ciphertext and wrong keys", () => {
    const blob = encrypt("secret", key);
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob, key)).toThrow();
    expect(() => decrypt(encrypt("secret", key), randomBytes(32))).toThrow();
  });

  it("compares hashes in constant time", () => {
    expect(safeEqualHex(sha256("a"), sha256("a"))).toBe(true);
    expect(safeEqualHex(sha256("a"), sha256("b"))).toBe(false);
    expect(safeEqualHex(sha256("a"), "abcd")).toBe(false);
  });
});
