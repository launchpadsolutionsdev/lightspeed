-- Migration 043: Home Base — Link Preview Cache

CREATE TABLE IF NOT EXISTS home_base_link_previews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL UNIQUE,
    title TEXT,
    description TEXT,
    image TEXT,
    site_name TEXT,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hb_link_previews_url ON home_base_link_previews(url);
