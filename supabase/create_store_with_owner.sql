-- =============================================================================
-- MediFlow SaaS — Database function to create store and owner account with password
-- Run this in your Supabase SQL Editor (Project → SQL Editor → New Query)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_store_with_owner(
    p_store_name text,
    p_gstin text,
    p_address text,
    p_phone text,
    p_plan text,
    p_owner_email text,
    p_owner_password text,
    p_owner_name text,
    p_super_admin_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_store_id uuid;
    v_user_id uuid;
    v_existing_user_id uuid;
BEGIN
    -- 1. Security Check: Only super admins allowed
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Access denied. Only super admins can manage store creation.';
    END IF;

    -- 2. Check if user already exists
    SELECT id INTO v_existing_user_id
    FROM auth.users
    WHERE email = p_owner_email
    LIMIT 1;

    -- 3. Create the store
    INSERT INTO public.stores (name, gstin, address, phone, plan, created_by)
    VALUES (p_store_name, p_gstin, p_address, p_phone, p_plan, p_super_admin_id)
    RETURNING id INTO v_store_id;

    -- 4. Seed default settings
    PERFORM public.seed_default_store_settings(v_store_id);

    -- 5. Create user in auth.users if they don't exist
    IF v_existing_user_id IS NULL THEN
        v_user_id := gen_random_uuid();
        
        INSERT INTO auth.users (
            id,
            instance_id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            is_super_admin,
            created_at,
            updated_at,
            last_sign_in_at
        )
        VALUES (
            v_user_id,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            p_owner_email,
            crypt(p_owner_password, gen_salt('bf')),
            now(),
            '{"provider":"email","providers":["email"]}',
            jsonb_build_object(
                'role', 'store_member',
                'display_name', COALESCE(p_owner_name, p_owner_email)
            ),
            false,
            now(),
            now(),
            now()
        );

        INSERT INTO auth.identities (
            id,
            user_id,
            provider_id,
            identity_data,
            provider,
            last_sign_in_at,
            created_at,
            updated_at
        )
        VALUES (
            gen_random_uuid(),
            v_user_id,
            v_user_id::text,
            jsonb_build_object(
                'sub', v_user_id::text,
                'email', p_owner_email
            ),
            'email',
            now(),
            now(),
            now()
        );
    ELSE
        v_user_id := v_existing_user_id;
    END IF;

    -- 6. Link to store in store_users
    INSERT INTO public.store_users (store_id, user_id, role, display_name, invited_by)
    VALUES (v_store_id, v_user_id, 'owner', COALESCE(p_owner_name, p_owner_email), p_super_admin_id)
    ON CONFLICT (store_id, user_id) DO UPDATE
    SET role = 'owner', is_active = true;

    RETURN v_store_id;
END;
$$;
