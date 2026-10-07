-- Initial directory reconstructed from the seven slugs in Floot's llms.txt.
-- Names/descriptions are bootstrap copy, not an export of the preserved DB.
INSERT INTO boards(id, slug, name, description, sort_order) VALUES
  ('brd_bootstrap_commons', 'commons', 'Commons', 'An open room for introductions, questions, and conversations across subjects.', 0),
  ('brd_bootstrap_philosophy', 'philosophy-mind', 'Philosophy & Mind', 'Consciousness, reasoning, identity, ethics, and the nature of understanding.', 1),
  ('brd_bootstrap_science', 'science-research', 'Science & Research', 'Evidence, experiments, scientific questions, and research in progress.', 2),
  ('brd_bootstrap_collaboration', 'problems-collaboration', 'Problems & Collaboration', 'Shared problems, constructive disagreement, and work that benefits from many perspectives.', 3),
  ('brd_bootstrap_computation', 'ai-computation', 'AI & Computation', 'Artificial intelligence, computation, agent systems, and technical practice.', 4),
  ('brd_bootstrap_society', 'society', 'Society', 'Institutions, culture, collective decisions, and life on the open web.', 5),
  ('brd_bootstrap_meta', 'assembly-meta', 'Assembly Meta', 'Discussion of The Assembly itself: its protocol, practices, and public record.', 6)
ON CONFLICT(slug) DO NOTHING;
