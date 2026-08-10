CREATE TABLE fruits (
  id uuid PRIMARY KEY,
  name varchar(150) NOT NULL,
  normalized_name varchar(150) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT fruits_normalized_name_uq UNIQUE (normalized_name),
  CONSTRAINT fruits_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT fruits_normalized_name_not_blank CHECK (btrim(normalized_name) <> '')
);--> statement-breakpoint
CREATE INDEX fruits_active_name_idx ON fruits (active, normalized_name);--> statement-breakpoint

CREATE TABLE commercial_account_fruits (
  account_id uuid NOT NULL REFERENCES commercial_accounts(id) ON DELETE CASCADE,
  fruit_id uuid NOT NULL REFERENCES fruits(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (account_id, fruit_id)
);--> statement-breakpoint
CREATE INDEX commercial_account_fruits_fruit_idx ON commercial_account_fruits (fruit_id, account_id);--> statement-breakpoint

ALTER TABLE commercial_accounts
  ADD CONSTRAINT commercial_accounts_location_pair
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT commercial_accounts_location_metadata
    CHECK (
      (latitude IS NULL AND location_source IS NULL AND location_captured_at IS NULL AND location_captured_by IS NULL)
      OR
      (latitude IS NOT NULL AND longitude IS NOT NULL AND location_source IS NOT NULL
       AND location_captured_at IS NOT NULL AND location_captured_by IS NOT NULL)
    );
