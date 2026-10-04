-- Real pgvector KB retrieval. kb_items.embedding has existed since Phase 1
-- but nothing ever populated or queried it — AI context-building was plain
-- string concatenation of every kb_items row. This adds the similarity
-- search itself; embeddings are backfilled lazily by aiTemplates.ts the
-- first time a project's context is built after this ships (only when the
-- connected AI provider is OpenAI — see packages/providers' Embedder type
-- for why Gemini/Anthropic can't produce 1536-dim vectors matching this
-- column).
create index if not exists kb_items_embedding_idx on kb_items using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function match_kb_items(query_embedding vector(1536), p_project_id uuid, match_count int default 5)
returns table (id uuid, title text, text text, similarity float)
language sql stable security definer set search_path = public as $$
  select id, title, text, 1 - (embedding <=> query_embedding) as similarity
  from kb_items
  where project_id = p_project_id and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
