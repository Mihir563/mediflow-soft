-- =============================================================================
-- STEP 1: Completely delete the broken manually-inserted user
-- This user was created by direct SQL insert which GoTrue can't handle
-- We'll recreate them properly through Supabase Auth Admin UI
-- =============================================================================

-- First check which store_users entry this person owns
SELECT su.id, su.store_id, su.role, su.display_name, s.name as store_name, u.email
FROM public.store_users su
JOIN auth.users u ON u.id = su.user_id  
JOIN public.stores s ON s.id = su.store_id
WHERE u.email = 'jaydeeappatel1999@gmail.com';

-- Then delete their identity first (required before deleting from auth.users)
DELETE FROM auth.identities 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'jaydeeappatel1999@gmail.com');

-- Delete their store_users entry (we'll re-link after recreation)
DELETE FROM public.store_users 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'jaydeeappatel1999@gmail.com');

-- Delete the broken auth user
DELETE FROM auth.users 
WHERE email = 'jaydeeappatel1999@gmail.com';

-- Confirm deletion
SELECT COUNT(*) as remaining_users FROM auth.users;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
