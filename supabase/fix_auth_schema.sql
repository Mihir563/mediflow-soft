-- =============================================================================
-- MediFlow — Auth Schema Fix
-- Run this in Supabase SQL Editor to fix the "Database error querying schema"
-- =============================================================================

-- Step 1: Find and show any malformed auth users (missing password hash)
SELECT 
  id, 
  email, 
  email_confirmed_at,
  CASE WHEN encrypted_password IS NULL OR encrypted_password = '' 
       THEN '❌ BROKEN - no password' 
       ELSE '✓ OK' END AS password_status,
  created_at
FROM auth.users
ORDER BY created_at DESC;
