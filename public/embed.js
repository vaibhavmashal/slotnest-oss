// Embeddable booking widget.
//   <div data-slotnest-url="https://HOST/at20/fit-call"></div>
//   <script src="https://HOST/embed.js" async></script>
// Inline: renders an auto-resizing iframe into each [data-slotnest-url] element.
// Popup:  any element with [data-slotnest-popup="URL"] opens the booking page in a modal.
// Emits window "slotnest:booked" CustomEvents with { start, end } in detail.
// If the event type has a page to show after booking, the host page goes there (the iframe asks via postMessage).
// Prefill name and email by adding ?name=…&email=… to the URL.
(function () {
  function frame(url) {
    var u = new URL(url, location.href);
    u.searchParams.set("embed", "1");
    var f = document.createElement("iframe");
    f.src = u.toString();
    f.title = "Book a time";
    f.style.cssText = "width:100%;border:0;min-height:560px;background:transparent";
    f.setAttribute("loading", "lazy");
    return f;
  }

  function mountInline() {
    document.querySelectorAll("[data-slotnest-url]:not([data-slotnest-mounted])").forEach(function (el) {
      el.setAttribute("data-slotnest-mounted", "");
      el.appendChild(frame(el.getAttribute("data-slotnest-url")));
    });
  }

  function openPopup(url) {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px";
    var box = document.createElement("div");
    box.style.cssText = "width:100%;max-width:900px;max-height:90vh;overflow:auto;border-radius:12px;background:#fff";
    box.appendChild(frame(url));
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc); }
    });
    document.body.appendChild(overlay);
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-slotnest-popup]");
    if (t) { e.preventDefault(); openPopup(t.getAttribute("data-slotnest-popup")); }
  });

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.source !== "slotnest") return;
    var ours = false;
    document.querySelectorAll("iframe").forEach(function (f) {
      if (f.contentWindow !== e.source) return;
      ours = new URL(f.src).origin === e.origin;
      if (d.type === "resize") f.style.height = d.payload.height + "px";
    });
    // Only our own booking frames may navigate the page, and only to https addresses.
    if (d.type === "redirect" && ours && /^https:\/\//.test(d.payload.url)) location.href = d.payload.url;
    if (d.type === "booked") window.dispatchEvent(new CustomEvent("slotnest:booked", { detail: d.payload }));
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountInline);
  else mountInline();
})();
