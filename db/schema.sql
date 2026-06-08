CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  interests TEXT NOT NULL,
  preferred_sources TEXT NOT NULL,
  reading_mode TEXT NOT NULL DEFAULT 'daily',
  language TEXT NOT NULL DEFAULT 'tr',
  reading_goal INTEGER NOT NULL DEFAULT 20
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,

  -- Legacy display fields (kept for backward compat)
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  full_text TEXT NOT NULL,

  -- Original-language fields (never overwritten by translation)
  original_title TEXT,
  original_summary TEXT,
  original_content TEXT,
  original_language TEXT NOT NULL DEFAULT 'tr',

  -- Translation fields (populated by AI translation pipeline; optional)
  translated_title TEXT NOT NULL DEFAULT '',
  translated_summary TEXT NOT NULL DEFAULT '',
  translated_content TEXT NOT NULL DEFAULT '',

  -- Locale-aware display fields (derived; updated when translation arrives)
  display_title TEXT,
  display_summary TEXT,
  display_content TEXT,

  -- Category & topics
  category TEXT NOT NULL,
  subcategory TEXT,
  tags TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',

  -- Source metadata
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_country TEXT NOT NULL DEFAULT '',
  source_country_code TEXT NOT NULL DEFAULT '',
  source_region TEXT NOT NULL DEFAULT 'global',
  source_language TEXT NOT NULL DEFAULT 'tr',
  source_trust_level TEXT NOT NULL DEFAULT 'medium',
  source_type TEXT NOT NULL DEFAULT 'rss',
  is_global_source INTEGER NOT NULL DEFAULT 0,
  source_id TEXT NOT NULL DEFAULT '',

  -- Region detection
  detected_event_region TEXT NOT NULL DEFAULT 'global',
  mentioned_regions TEXT NOT NULL DEFAULT '[]',
  mentioned_countries TEXT NOT NULL DEFAULT '[]',

  -- Named entities (JSON object)
  named_entities TEXT NOT NULL DEFAULT '{}',

  -- Media & URLs
  image_url TEXT,
  url TEXT,
  author TEXT,

  -- Timestamps
  published_at TEXT NOT NULL,
  fetched_at TEXT,
  created_at TEXT NOT NULL,

  -- Processing
  content_hash TEXT NOT NULL,
  duplicate_group_id TEXT,
  ai_summary TEXT,
  content_status TEXT NOT NULL DEFAULT 'summary_only'
);

CREATE TABLE user_article_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE read_status (
  user_id TEXT NOT NULL REFERENCES users(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
