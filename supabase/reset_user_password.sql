-- =============================================================================
-- MediFlow SaaS — Reset user password (Super Admin only)
-- Run this in your Supabase SQL Editor (Project → SQL Editor → New Query)
-- =============================================================================
-- This SECURITY DEFINER function lets the super admin reset any store user's
-- password by directly updating auth.users. Only callable by super admins.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
    p_user_email text,
    p_new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Security Check: Only super admins allowed
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied. Only super admins can reset passwords.';
    END IF;

    -- Validate input
    IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
        RAISE EXCEPTION 'Password must be at least 6 characters long.';
    END IF;

    -- Find the user
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = p_user_email
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User with email "%" not found.', p_user_email;
    END IF;

    -- Update the password using bcrypt
    UPDATE auth.users
    SET
        encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = now()
    WHERE id = v_user_id;

END;
$$;

-- Grant execute permission to authenticated users (RLS inside function restricts to super admin)
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(text, text) TO authenticated;
