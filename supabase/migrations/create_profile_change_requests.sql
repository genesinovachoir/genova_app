-- =============================================
-- profile_change_requests tablosu
-- Supabase Dashboard > SQL Editor'de çalıştır
-- =============================================

CREATE TABLE IF NOT EXISTS public.profile_change_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL REFERENCES public.choir_members(id) ON DELETE CASCADE,
  changes_json  jsonb NOT NULL,          -- {"email": "...", "phone": "...", ...}
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note          text,                    -- Koristin isteğe bağlı notu
  reviewed_by   uuid REFERENCES public.choir_members(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  reject_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS aç
ALTER TABLE public.profile_change_requests ENABLE ROW LEVEL SECURITY;

-- Koristler yalnızca kendi isteklerini görebilir ve ekleyebilir
CREATE POLICY "member_select_own" ON public.profile_change_requests
  FOR SELECT USING (
    member_id = (
      SELECT id FROM public.choir_members WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "member_insert_own" ON public.profile_change_requests
  FOR INSERT WITH CHECK (
    member_id = (
      SELECT id FROM public.choir_members WHERE auth_user_id = auth.uid()
    )
  );

-- Şef rolündekiler tüm istekleri görebilir ve güncelleyebilir
CREATE POLICY "admin_full_access" ON public.profile_change_requests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.choir_members cm
      JOIN public.choir_member_roles cmr ON cmr.member_id = cm.id
      JOIN public.roles r ON r.id = cmr.role_id
      WHERE cm.auth_user_id = auth.uid() AND r.name = 'Şef'
    )
  );

-- updated_at otomatik güncelle
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pcr_updated_at
  BEFORE UPDATE ON public.profile_change_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
