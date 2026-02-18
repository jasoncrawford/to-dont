-- Fix mutable search_path on update_updated_at function (fixes #38)
-- The Supabase linter warns this function has a role-mutable search_path,
-- which could allow search_path manipulation attacks.

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';
