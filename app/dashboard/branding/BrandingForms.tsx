"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { contrastReport, normalizeHex, palette, DEFAULT_BRAND } from "@/lib/branding/color";
import { IMAGE_LIMITS } from "@/lib/branding/image";
import { removeImage, saveBrandColor, uploadBrandImage, type ActionState } from "./actions";

const ACCEPT = "image/png,image/jpeg,image/webp";

export function ImageUpload({ kind, label, hint, current }: { kind: "logo" | "avatar"; label: string; hint: string; current: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadBrandImage, {});
  const [clientError, setClientError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // After a successful upload the saved image comes back as `current`; drop the local preview.
  useEffect(() => {
    if (state.ok) {
      setPreview(null);
      formRef.current?.reset();
    }
  }, [state]);

  function check(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setClientError(null);
    setPreview(null);
    if (!f) return;
    if (!ACCEPT.split(",").includes(f.type)) {
      setClientError("Use a PNG, JPEG or WebP image.");
      e.target.value = "";
    } else if (f.size > IMAGE_LIMITS.maxBytes) {
      setClientError("Images must be 1 MB or smaller.");
      e.target.value = "";
    } else {
      setPreview(URL.createObjectURL(f));
    }
  }

  const shown = preview ?? current;
  return (
    <div className="upload">
      <div className={`upload-preview ${kind}`}>{shown ? <img src={shown} alt="" /> : <span className="muted small">None</span>}</div>
      <div className="upload-body">
        <strong>{label}</strong>
        <p className="muted small">{hint}</p>
        <form ref={formRef} action={action} className="row wrap tight">
          <input type="hidden" name="kind" value={kind} />
          <input type="file" name="file" accept={ACCEPT} onChange={check} required aria-label={label} />
          <button className="secondary small" type="submit" disabled={pending || !!clientError}>
            {pending ? "Uploading…" : "Upload"}
          </button>
        </form>
        {current && !preview && (
          <form action={removeImage}>
            <input type="hidden" name="kind" value={kind} />
            <button className="link inline danger-text small" type="submit">
              Remove
            </button>
          </form>
        )}
        {(clientError || state.error) && <p className="error small">{clientError ?? state.error}</p>}
        {state.ok && !preview && <p className="ok small">{state.ok}</p>}
      </div>
    </div>
  );
}

const fmt = (r: number) => `${r.toFixed(1)}:1`;

export function BrandColorForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBrandColor, {});
  const [value, setValue] = useState(current ?? DEFAULT_BRAND);
  const hex = normalizeHex(value);
  const p = useMemo(() => (hex ? palette(hex) : null), [hex]);
  const report = useMemo(() => (hex ? contrastReport(hex) : null), [hex]);

  return (
    <form action={action} className="stack">
      <div className="row wrap tight">
        <input type="color" value={hex ?? DEFAULT_BRAND} onChange={(e) => setValue(e.target.value)} aria-label="Pick a brand colour" />
        <input name="color" value={value} onChange={(e) => setValue(e.target.value)} maxLength={7} className="hex" aria-label="Brand colour hex" />
        <button className="primary small" type="submit" disabled={pending || !hex}>
          Save colour
        </button>
        {current && (
          <button className="link inline small" type="submit" name="op" value="reset" formNoValidate>
            Reset to default
          </button>
        )}
      </div>
      {!hex && <p className="error small">Enter a 6-digit hex colour, like #2f5bea.</p>}
      {state.error && <p className="error small">{state.error}</p>}
      {state.ok && <p className="ok small">{state.ok}</p>}

      {p && report && (
        <div className="previews">
          {(["light", "dark"] as const).map((mode) => {
            const m = p[mode];
            const raw = mode === "light" ? report.onLight : report.onDark;
            return (
              <div key={mode} className={`swatch ${mode}`}>
                <div className="swatch-title">{mode === "light" ? "Light mode" : "Dark mode"}</div>
                <button type="button" style={{ background: m.accent, color: m.accentText }} tabIndex={-1}>
                  Confirm booking
                </button>
                <span className="swatch-time" style={{ color: m.accent, borderColor: m.accent }}>
                  10:30
                </span>
                <span style={{ color: m.accent }}>Reschedule link</span>
                <p className="swatch-note">
                  Button text {fmt(mode === "light" ? report.buttonLight : report.buttonDark)} ✓ · Your colour as text {fmt(raw)}{" "}
                  {raw >= 4.5 ? "✓ AA" : "✗ below AA"}
                  {m.adjusted && (
                    <>
                      <br />
                      Links and time buttons use a {mode === "light" ? "darker" : "lighter"} shade ({m.accent}) so they stay readable.
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </form>
  );
}
