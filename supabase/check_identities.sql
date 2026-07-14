-- =============================================================================
-- Run each block ONE AT A TIME in Supabase SQL Editor
-- =============================================================================

-- BLOCK 1: Check auth.identities for both users (run this first)
SELECT 
  i.id,
  i.user_id,
  i.provider,
  i.provider_id,
  u.email,
  i.created_at
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
ORDER BY i.created_at;
