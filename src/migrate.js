import { query } from './db.js';

export async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS setting (
      key   text PRIMARY KEY,
      value jsonb NOT NULL
    );

    CREATE TABLE IF NOT EXISTS festival (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name              text NOT NULL,
      public_id         text NOT NULL UNIQUE,
      manage_token_enc  text NOT NULL,
      manage_idx        text NOT NULL UNIQUE,
      counter_token_enc text NOT NULL,
      counter_idx       text NOT NULL UNIQUE,
      icon_emoji        text,
      icon_image        bytea,
      icon_mime         text,
      icon_version      integer NOT NULL DEFAULT 0,
      theme             jsonb NOT NULL DEFAULT '{}',
      created_at        timestamptz NOT NULL DEFAULT now(),
      expires_at        timestamptz NOT NULL,
      closed_at         timestamptz,
      last_activity_at  timestamptz NOT NULL DEFAULT now(),
      creator_ip        text
    );

    CREATE TABLE IF NOT EXISTS device (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      festival_id  uuid NOT NULL REFERENCES festival ON DELETE CASCADE,
      name         text NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS device_name ON device (festival_id, lower(name));

    CREATE TABLE IF NOT EXISTS team (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      festival_id     uuid NOT NULL REFERENCES festival ON DELETE CASCADE,
      name            text NOT NULL,
      color           text NOT NULL,
      sort            integer NOT NULL DEFAULT 0,
      hidden          boolean NOT NULL DEFAULT false,
      created_by      text NOT NULL,
      owner_token_enc text NOT NULL,
      owner_idx       text NOT NULL UNIQUE,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS team_name ON team (festival_id, lower(name));

    CREATE TABLE IF NOT EXISTS drink_type (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      festival_id uuid NOT NULL REFERENCES festival ON DELETE CASCADE,
      name        text NOT NULL,
      emoji       text NOT NULL DEFAULT '',
      points      integer NOT NULL DEFAULT 1,
      sort        integer NOT NULL DEFAULT 0,
      hidden      boolean NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS entry (
      id            bigserial PRIMARY KEY,
      festival_id   uuid NOT NULL REFERENCES festival ON DELETE CASCADE,
      team_id       uuid NOT NULL REFERENCES team ON DELETE CASCADE,
      drink_type_id uuid NOT NULL REFERENCES drink_type ON DELETE CASCADE,
      device_id     uuid REFERENCES device ON DELETE SET NULL,
      qty           integer NOT NULL,
      points        integer NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      undone_at     timestamptz,
      undone_by     text
    );
    CREATE INDEX IF NOT EXISTS entry_festival ON entry (festival_id, created_at);
    CREATE INDEX IF NOT EXISTS entry_team ON entry (team_id);
  `);
}
