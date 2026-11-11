"use client";

import { useState } from "react";

/** "Coffee chat (30 min)" → "coffee-chat-30-min" */
export const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");

/**
 * Title and URL slug. For a new event type the slug follows the title until it's edited by hand; an existing one keeps
 * its slug, since changing it would break links already shared.
 */
export default function TitleSlugFields({ title, slug, isNew }: { title: string; slug: string; isNew: boolean }) {
  const [t, setT] = useState(title);
  const [s, setS] = useState(slug);
  const [follow, setFollow] = useState(isNew && (!slug || slug === slugify(title)));
  return (
    <>
      <label>
        Title
        <input
          name="title"
          value={t}
          onChange={(e) => {
            setT(e.target.value);
            if (follow) setS(slugify(e.target.value));
          }}
          required
          maxLength={120}
        />
      </label>
      <label>
        URL slug
        <input
          name="slug"
          value={s}
          onChange={(e) => {
            setS(e.target.value);
            setFollow(false);
          }}
          required
          pattern="[a-z0-9][a-z0-9\-]{0,63}"
        />
      </label>
    </>
  );
}
