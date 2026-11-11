-- Per-account branding: logo, profile photo, brand colour, and the paid option to hide "Powered by Slotnest".

CREATE TABLE assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('logo', 'avatar')),
  content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size     integer NOT NULL CHECK (byte_size > 0),
  width         integer NOT NULL CHECK (width > 0),
  height        integer NOT NULL CHECK (height > 0),
  sha256        text NOT NULL,
  storage_key   text NOT NULL UNIQUE,    -- key in the AssetStore (local disk now; S3/Spaces later)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_user ON assets (user_id);

ALTER TABLE users
  ADD COLUMN brand_color text CHECK (brand_color ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN logo_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  ADD COLUMN avatar_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  -- The user's preference; it only takes effect while the account is on a paid plan (see lib/branding).
  ADD COLUMN hide_powered_by boolean NOT NULL DEFAULT false;
