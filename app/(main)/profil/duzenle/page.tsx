'use client';

import { motion } from 'motion/react';
import { ArrowLeft, SendHorizonal, Check, ChevronDown, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';

/* ---------- Statik veriler (idealde DB'den gelir) ---------- */
const SCHOOLS = [
  { id: 'ecfbb198-9806-4754-8f21-8b076f44f345', name: 'İstanbul Üniversitesi-Cerrahpaşa' },
  { id: '4e051892-100b-4689-8bf2-552c8c79185d', name: 'İstanbul Topkapı Üniversitesi' },
  { id: '82025b8e-45f1-4d2f-9469-5b6e4e254c53', name: 'Marmara Üniversitesi' },
  { id: '73a04f1c-8d08-49aa-9e3f-aca8d50150f3', name: 'Yıldız Teknik Üniversitesi' },
];

const DEPTS = [
  { id: '8381f9d1-59d1-4f6c-bd81-814608fc6d93', name: 'Fen Bilgisi Öğretmenliği' },
  { id: '2d3a7104-c6cb-4e10-8748-d2aa6796ef19', name: 'Tıp' },
  { id: '38d2dd30-5963-4419-8634-cb4e9fe0a8b0', name: 'Matematik Mühendisliği' },
  { id: 'b06e6885-9f86-43ab-ad2a-efa342e13e4c', name: 'Sosyal Bilgiler Öğretmenliği' },
  { id: 'eded5e14-b2b9-449a-b5a7-895572d3a79d', name: 'Kimya Mühendisliği' },
  { id: '8e13bf94-76ec-44b4-ae08-873d7ad4625b', name: 'Endüstri Mühendisliği' },
  { id: '87dcc0ea-c890-4746-aaec-c70c433d1a7e', name: 'Biyomühendislik' },
  { id: 'fe161a65-b917-4a01-99f3-1104d795043c', name: 'Çevre Mühendisliği' },
  { id: '4ffe6058-ce7f-4e82-a63d-d2147e03fd8f', name: 'Hukuk' },
  { id: '56c37fa0-04c2-4b9b-a493-08b5794009fb', name: 'İnşaat Mühendisliği' },
  { id: '7eda3a36-e3d4-4925-8861-5dc90ff88a17', name: 'İşletme' },
  { id: 'c5895ea9-f57c-46b8-bb76-d055db05afeb', name: 'Kimya' },
  { id: '60effde1-6b18-4faf-9696-34c46ca98244', name: 'Biyomedikal Mühendisliği' },
  { id: 'f4259af9-4181-4e30-ae21-01e057860ea4', name: 'İletişim ve Tasarım' },
  { id: '8a794ff4-c307-4e93-9652-ec2e36e1d8c3', name: 'Müzik' },
];

/* ---------- Field config ---------- */
type FieldKey = 'email' | 'phone' | 'birth_date' | 'school_id' | 'department_id' | 'linkedin_url' | 'instagram_url' | 'youtube_url' | 'spotify_url';

interface FieldDef {
  key: FieldKey;
  label: string;
  type: 'text' | 'email' | 'tel' | 'date' | 'select';
  placeholder?: string;
  options?: { id: string; name: string }[];
}

const FIELDS: FieldDef[] = [
  { key: 'email', label: 'E-posta', type: 'email', placeholder: 'E-posta adresiniz' },
  { key: 'phone', label: 'Telefon', type: 'tel', placeholder: '05XX XXX XX XX' },
  { key: 'birth_date', label: 'Doğum Tarihi', type: 'date' },
  { key: 'school_id', label: 'Okul', type: 'select', options: SCHOOLS },
  { key: 'department_id', label: 'Bölüm', type: 'select', options: DEPTS },
  { key: 'linkedin_url', label: 'LinkedIn', type: 'text', placeholder: 'https://linkedin.com/in/...' },
  { key: 'instagram_url', label: 'Instagram', type: 'text', placeholder: 'https://instagram.com/...' },
  { key: 'youtube_url', label: 'YouTube', type: 'text', placeholder: 'https://youtube.com/@...' },
  { key: 'spotify_url', label: 'Spotify veya YTMUSIC', type: 'text', placeholder: 'https://open.spotify.com/user/...' },
];

export default function ProfilDuzenle() {
  const { member, user, roles, isLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState<Record<FieldKey, string>>({
    email: '', phone: '', birth_date: '', school_id: '', department_id: '',
    linkedin_url: '', instagram_url: '', youtube_url: '', spotify_url: '',
  });
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'sent'>('idle');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<'idle' | 'saving' | 'done'>('idle');

  useEffect(() => {
    if (member) {
      setForm({
        email: member.email || '',
        phone: member.phone || '',
        birth_date: member.birth_date || '',
        school_id: member.school_id || '',
        department_id: member.department_id || '',
        linkedin_url: member.linkedin_url || '',
        instagram_url: member.instagram_url || '',
        youtube_url: member.youtube_url || '',
        spotify_url: member.spotify_url || '',
      });
      setPhotoUrl(member.photo_url || '');
    }
  }, [member]);

  const handlePickPhoto = () => {
    if (status !== 'idle' || uploadingPhoto) return;
    fileInputRef.current?.click();
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !member || !user) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Lütfen geçerli bir görsel dosyası seçin.', 'Profil fotoğrafı');
      e.target.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Görsel boyutu 5MB altında olmalıdır.', 'Profil fotoğrafı');
      e.target.value = '';
      return;
    }

    setUploadingPhoto(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.');

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/profile-photo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Fotoğraf yüklenemedi.');
      }

      const payload = await res.json() as { publicUrl?: string };
      const publicUrl = payload.publicUrl;
      if (!publicUrl) throw new Error('Public URL alınamadı.');
      setPhotoUrl(publicUrl);
    } catch (err: any) {
      toast.error(`Fotoğraf yükleme hatası: ${err.message}`, 'Profil fotoğrafı');
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;

    // Yalnızca değişen alanları gönder
    const original: Record<string, string> = {
      email: member.email || '', phone: member.phone || '', birth_date: member.birth_date || '',
      school_id: member.school_id || '', department_id: member.department_id || '',
      linkedin_url: member.linkedin_url || '', instagram_url: member.instagram_url || '',
      youtube_url: member.youtube_url || '', spotify_url: member.spotify_url || '',
      photo_url: member.photo_url || '',
    };
    const changes: Record<string, string> = {};
    (Object.keys(form) as FieldKey[]).forEach(k => {
      if (form[k] !== original[k]) changes[k] = form[k];
    });
    if (photoUrl !== original.photo_url) changes.photo_url = photoUrl;

    if (Object.keys(changes).length === 0) {
      router.push('/profil');
      return;
    }

    setStatus('saving');
    try {
      const { error } = await supabase.from('profile_change_requests').insert({
        member_id: member.id,
        changes_json: changes,
        note: note || null,
        status: 'pending',
      });
      if (error) throw error;
      setStatus('sent');
      toast.success('Değişiklik talebi şefe gönderildi.');
      setTimeout(() => router.push('/profil'), 1500);
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`, 'Değişiklik talebi');
      setStatus('idle');
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member?.email) {
      toast.error('Şifre değiştirilemedi: e-posta bilgisi bulunamadı.', 'Şifre');
      return;
    }

    if (!oldPassword || !newPassword || !confirmNewPassword) {
      toast.error('Lütfen tüm şifre alanlarını doldurun.', 'Şifre');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('Yeni şifre en az 8 karakter olmalıdır.', 'Şifre');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast.error('Yeni şifre ve tekrar şifresi eşleşmiyor.', 'Şifre');
      return;
    }

    if (oldPassword === newPassword) {
      toast.error('Yeni şifre eski şifre ile aynı olamaz.', 'Şifre');
      return;
    }

    setPasswordStatus('saving');
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: member.email,
        password: oldPassword,
      });
      if (reauthError) throw new Error('Eski şifre yanlış.');

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordStatus('done');
      toast.success('Şifre güncellendi.');
      setTimeout(() => setPasswordStatus('idle'), 1800);
    } catch (err: any) {
      toast.error(`Şifre değiştirme hatası: ${err.message}`, 'Şifre');
      setPasswordStatus('idle');
    }
  };

  if (isLoading) {
    return (
      <main className="page-shell flex min-h-[50vh] items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="h-10 w-10 rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
      </main>
    );
  }

  const initials = member?.first_name && member?.last_name
    ? `${member.first_name[0]}${member.last_name[0]}`.toUpperCase() : 'GY';
  const hasProfileChanges = !!member && (
    (Object.keys(form) as FieldKey[]).some((k) => form[k] !== (member[k] || '')) ||
    photoUrl !== (member.photo_url || '')
  );

  return (
    <main className="page-shell pb-28 space-y-4 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
      {/* Header */}
      <div className="flex items-center gap-3 px-1 pt-2">
        <Link href="/profil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 border border-white/10 text-[var(--color-text-medium)] hover:text-white transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <span className="font-serif text-xl tracking-tight font-medium text-white/90">Değişiklik Talebi</span>
      </div>

      {/* Bilgi notu */}
      <div className="rounded-xl border border-[#C0B283]/20 bg-[#C0B283]/5 px-4 py-3 text-[0.78rem] text-[#E0D8B8]/70 leading-relaxed">
        Aşağıdaki bilgilerde yaptığın değişiklikler <strong className="text-[#D4C8A0]">Şef onayına</strong> gönderilecek. Onaylandıktan sonra profilinde güncellenecek.
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-4">
        {/* Avatar gösterimi */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="glass-panel px-6 pb-4 pt-4 flex flex-col items-center mt-12 !overflow-visible"
        >
          <button
            type="button"
            onClick={handlePickPhoto}
            disabled={uploadingPhoto || status !== 'idle'}
            className="-mt-12 mb-3 relative h-[88px] w-[88px] rounded-full ring-[3px] ring-black transition-transform hover:scale-[1.02] disabled:opacity-70"
            aria-label="Profil fotoğrafını değiştir"
          >
            <div className="h-full w-full flex items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[#b48600] text-3xl font-serif font-medium text-black shadow-[0_0_24px_rgba(192,178,131,0.3)]">
              {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : initials}
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoChange}
          />
          <p className="text-[0.85rem] font-medium text-white/80 font-serif">{member?.first_name} {member?.last_name}</p>
          <div className="flex flex-wrap justify-center gap-1.5 mt-1.5">
            {member?.voice_group && (
              <span className="status-pill text-[var(--color-accent)] border-[var(--color-accent-soft)] !py-1 !min-h-0 !text-[0.62rem]">
                {member.voice_group}
              </span>
            )}
            {roles.map(role => (
              <span key={role} className="status-pill border-white/10 bg-white/5 text-white/60 !py-1 !min-h-0 !text-[0.62rem]">
                {role}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Form alanları */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
          className="glass-panel p-5 flex flex-col gap-4">
          {FIELDS.map(field => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-[0.62rem] uppercase tracking-[0.18em] font-bold text-[var(--color-text-medium)] px-0.5">
                {field.label}
              </label>
              {field.type === 'select' ? (
                <div className="relative">
                  <select
                    value={form[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    className="editorial-input w-full appearance-none pr-9 cursor-pointer"
                  >
                    <option value="">-- Seçiniz --</option>
                    {field.options?.map(o => (
                      <option key={o.id} value={o.id} className="bg-[#111]">{o.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-medium)]" />
                </div>
              ) : (
                <input
                  type={field.type}
                  value={form[field.key]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  className={`editorial-input w-full ${field.type === 'date' ? '[color-scheme:dark]' : ''}`}
                  placeholder={field.placeholder}
                />
              )}
            </div>
          ))}
        </motion.div>

        {/* Not alanı */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }}
          className="glass-panel p-5 space-y-1.5">
          <label className="text-[0.62rem] uppercase tracking-[0.18em] font-bold text-[var(--color-text-medium)]">
            Şefe Not (isteğe bağlı)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="Değişiklik hakkında kısa bir not..."
            className="editorial-input w-full resize-none"
          />
        </motion.div>

        {/* Submit */}
        <button
          type="submit"
          disabled={status !== 'idle' || uploadingPhoto || !hasProfileChanges}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[#b48600] text-black px-6 py-3.5 font-serif font-bold text-[0.95rem] transition-all disabled:opacity-60 hover:shadow-[0_0_20px_rgba(192,178,131,0.35)] active:scale-[0.98]"
        >
          {status === 'sent' ? (
            <><Check size={18} /> Onaya Gönderildi</>
          ) : status === 'saving' ? (
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="h-5 w-5 rounded-full border-2 border-black border-t-transparent" />
          ) : (
            <><SendHorizonal size={17} /> Değişiklikleri Onaya Gönder</>
          )}
        </button>
      </form>

      {/* Şifre Değiştir */}
      <motion.form
        onSubmit={handlePasswordChange}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="glass-panel p-5 space-y-3 mt-4"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 border border-white/10 text-[var(--color-accent)]">
            <LockKeyhole size={14} />
          </div>
          <div>
            <p className="text-[0.82rem] font-semibold text-white/90">Şifre Değiştir</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.62rem] uppercase tracking-[0.18em] font-bold text-[var(--color-text-medium)]">
            Eski Şifre
          </label>
          <input
            type="password"
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            className="editorial-input w-full"
            placeholder="Mevcut şifreniz"
            autoComplete="current-password"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.62rem] uppercase tracking-[0.18em] font-bold text-[var(--color-text-medium)]">
            Yeni Şifre
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="editorial-input w-full"
            placeholder="En az 8 karakter"
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.62rem] uppercase tracking-[0.18em] font-bold text-[var(--color-text-medium)]">
            Yeni Şifre (Tekrar)
          </label>
          <input
            type="password"
            value={confirmNewPassword}
            onChange={e => setConfirmNewPassword(e.target.value)}
            className="editorial-input w-full"
            placeholder="Yeni şifreyi tekrar girin"
            autoComplete="new-password"
          />
        </div>

        <button
          type="submit"
          disabled={passwordStatus === 'saving'}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] px-6 py-3 text-[var(--color-accent)] font-serif font-bold text-[0.9rem] transition-all hover:bg-[#C0B283]/10 disabled:opacity-60"
        >
          {passwordStatus === 'done' ? 'Şifre Güncellendi' : passwordStatus === 'saving' ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
        </button>
      </motion.form>
    </main>
  );
}
