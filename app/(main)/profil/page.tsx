'use client';

import dynamic from 'next/dynamic';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Edit2, LogOut, Mail, Phone, Cake, Building2, GraduationCap, Music, Calendar, Clock, ShieldCheck, Moon, Sun, Menu } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useAuth } from '@/components/AuthProvider';
import { getRoleDisplayLabel } from '@/lib/role-labels';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

export default function Profil() {
  const { member, roles, signOut, isLoading } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [todayTimestamp] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [celebrationAnimation, setCelebrationAnimation] = useState<any>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const isDark = resolvedTheme !== 'light';
  const today = new Date();
  const isBirthdayToday = (() => {
    if (!member?.birth_date) return false;
    const parts = member.birth_date.split('-');
    if (parts.length < 3) return false;
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return false;
    return today.getMonth() + 1 === month && today.getDate() === day;
  })();

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!isBirthdayToday) return;

    let cancelled = false;
    fetch('/lottie/celebration.json')
      .then((res) => {
        if (!res.ok) throw new Error('celebration.json not found');
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setCelebrationAnimation(json);
      })
      .catch(() => {
        if (!cancelled) setCelebrationAnimation(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isBirthdayToday]);


  if (isLoading) {
    return (
      <main className="page-shell flex min-h-[50vh] items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="h-10 w-10 rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
      </main>
    );
  }

  const initials = member?.first_name && member?.last_name
    ? `${member.first_name[0]}${member.last_name[0]}`.toUpperCase()
    : 'GY';
  const fullName = member ? `${member.first_name} ${member.last_name}` : 'Misafir Kullanıcı';

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const joinDayCount = member?.join_date
    ? Math.floor((todayTimestamp - new Date(member.join_date).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <main className="page-shell pb-28 space-y-4 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pt-2">
        <span className="font-serif text-xl tracking-tight font-medium text-[var(--color-text-high)]">Profilim</span>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen(prev => !prev)}
            aria-label={menuOpen ? 'Profil menüsünü kapat' : 'Profil menüsünü aç'}
            aria-expanded={menuOpen}
            className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all ${
              menuOpen
                ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-soft-bg)] text-[var(--color-text-medium)] hover:text-[var(--color-text-high)]'
            }`}
          >
            <Menu size={17} />
          </button>

          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18 }}
              className="absolute right-0 top-[calc(100%+0.7rem)] z-30 w-[17.5rem] overflow-visible rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-panel-bg)] p-2 shadow-[0_16px_35px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            >
              <div className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-[var(--color-border-strong)] bg-[var(--color-panel-bg)]" />

              <Link
                href="/profil/degisiklikler"
                onClick={() => setMenuOpen(false)}
                className="group flex w-full items-center justify-between rounded-xl border border-transparent bg-[var(--color-soft-bg)] px-3 py-2.5 text-left hover:border-[var(--color-border)] hover:bg-[var(--color-soft-bg-hover)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                    <ShieldCheck size={15} />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-[0.82rem] font-semibold text-[var(--color-text-high)]">Profil Değişiklikleri</span>
                    <span className="text-[0.7rem] text-[var(--color-text-medium)]">Talep geçmişini ve durumunu gör</span>
                  </div>
                </div>
              </Link>

              <button
                type="button"
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                className="mt-1 flex w-full items-center justify-between rounded-xl border border-transparent bg-[var(--color-soft-bg)] px-3 py-2.5 text-left hover:border-[var(--color-border)] hover:bg-[var(--color-soft-bg-hover)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-soft-bg)] text-[var(--color-text-medium)]">
                    {isDark ? <Moon size={15} /> : <Sun size={15} />}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-[0.82rem] font-semibold text-[var(--color-text-high)]">Tema</span>
                  </div>
                </div>
                <span className="text-[0.68rem] uppercase tracking-[0.14em] text-[var(--color-accent)]">{isDark ? 'Koyu' : 'Açık'}</span>
              </button>

              <div className="my-2 h-px bg-[var(--color-border)]" />

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--status-rejected-border)] bg-[var(--status-rejected-bg)] px-3 py-2.5 text-left text-[var(--status-rejected-text)] transition-colors hover:border-[var(--status-rejected-border)] hover:bg-[var(--status-rejected-bg)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--status-rejected-bg)] text-[var(--status-rejected-text)]">
                  <LogOut size={15} />
                </span>
                <div className="flex flex-col">
                  <span className="text-[0.82rem] font-semibold">Çıkış Yap</span>
                  <span className="text-[0.7rem] text-[var(--status-rejected-text)]/85">Hesabından güvenli çıkış yap</span>
                </div>
              </button>
            </motion.div>
          )}
        </div>
      </div>


      {/* Avatar Kartı */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="glass-panel px-6 pb-6 pt-4 flex flex-col items-center text-center mt-12 !overflow-visible"
      >
        {isBirthdayToday && Boolean(celebrationAnimation) && (
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
            style={{ position: 'absolute', inset: 0, zIndex: 0 }}
            aria-hidden="true"
          >
            <Lottie
              animationData={celebrationAnimation}
              loop
              autoplay
              rendererSettings={{ preserveAspectRatio: 'xMidYMid slice' }}
              style={{ width: '100%', height: '100%', opacity: 0.5 }}
            />
          </div>
        )}

        <div className="relative -mt-12 mb-3">
          <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[#b48600] text-3xl font-serif font-medium text-[var(--color-background)] shadow-[0_0_24px_rgba(192,178,131,0.35)] ring-[3px] ring-[var(--color-panel-bg)]">
            {member?.photo_url ? (
              <img src={member.photo_url} alt={fullName} className="h-full w-full object-cover" />
            ) : initials}
          </div>
          <Link
            href="/profil/duzenle"
            className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-panel-bg)] border border-[var(--color-border-strong)] text-[var(--color-accent)] shadow-md hover:scale-110 transition-transform"
          >
            <Edit2 size={13} />
          </Link>
        </div>

        <h2 className="font-serif text-2xl tracking-tight font-medium text-[var(--color-text-high)]">{fullName}</h2>

        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {member?.voice_group && (
            <span className="status-pill text-[var(--color-accent)] border-[var(--color-accent-soft)] !py-1">
              {member.voice_group}{member.sub_voice_group && member.sub_voice_group !== member.voice_group ? ` · ${member.sub_voice_group}` : ''}
            </span>
          )}
          {roles.map(role => (
            <span key={role} className="status-pill border-[var(--color-border)] bg-[var(--color-soft-bg)] text-[var(--color-text-medium)] !py-1">
              {getRoleDisplayLabel(role, member?.voice_group)}
            </span>
          ))}
        </div>

        {joinDayCount !== null && (
          <p className="mt-2.5 text-[0.68rem] text-[var(--color-accent)] font-medium tracking-wide">
            {joinDayCount} gündür Genova&apos;lı
          </p>
        )}
      </motion.div>

      {/* İletişim */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.06 }}
        className="glass-panel p-5 flex flex-col gap-3.5">
        <SectionTitle icon={<Phone size={11} />} label="İLETİŞİM" />
        <InfoRow icon={<Mail size={15} />} label="E-posta" value={member?.email} />
        <Div />
        <InfoRow icon={<Phone size={15} />} label="Telefon" value={member?.phone} />
      </motion.div>

      {/* Kişisel */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.12 }}
        className="glass-panel p-5 flex flex-col gap-3.5">
        <SectionTitle icon={<Calendar size={11} />} label="KİŞİSEL" />
        <InfoRow icon={<Cake size={15} />} label="Doğum Tarihi" value={formatDate(member?.birth_date)} />
        {member?.school_name && <><Div /><InfoRow icon={<Building2 size={15} />} label="Okul" value={member.school_name} /></>}
        {member?.department_name && <><Div /><InfoRow icon={<GraduationCap size={15} />} label="Bölüm" value={member.department_name} /></>}
        {member?.join_date && <><Div /><InfoRow icon={<Clock size={15} />} label="Katılım Tarihi" value={formatDate(member.join_date)} /></>}
        {member?.favorite_song_title && <><Div /><InfoRow icon={<Music size={15} />} label="En Sevdiğim Eser" value={member.favorite_song_title} /></>}
      </motion.div>
    </main>
  );
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)] font-bold">
      {icon} {label}
    </div>
  );
}

function Div() {
  return <div className="h-px w-full bg-[var(--color-border)]" />;
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-soft-bg)] text-[var(--color-text-medium)]">
        {icon}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)]">{label}</span>
        <span className={`text-[0.875rem] font-medium truncate ${value ? 'text-[var(--color-text-high)]' : 'text-[var(--color-text-medium)] italic'}`}>
          {value || 'Belirtilmemiş'}
        </span>
      </div>
    </div>
  );
}
