-- OEM branding: admin-configurable product name + logo, read at runtime by
-- the frontend (and the dynamic favicon route) instead of the hardcoded
-- defaults. All nullable — null means "use the built-in NAP defaults", so
-- an install with nothing configured behaves exactly as before.
ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS branding_short_name text,
    ADD COLUMN IF NOT EXISTS branding_full_name text,
    ADD COLUMN IF NOT EXISTS branding_logo_data text,
    ADD COLUMN IF NOT EXISTS branding_logo_mime text;
