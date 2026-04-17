'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { Edit2, LogOut, Mail, Phone, Cake, Building2, GraduationCap, Music, Calendar, Clock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

export default function Profil() {
  const { member, roles, signOut, isLoading, isAdmin } = useAuth();
  const [todayTimestamp] = useState(() => Date.now());


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
        <span className="font-serif text-xl tracking-tight font-medium text-white/90">Profilim</span>
        <div className="flex items-center gap-2">
          {isAdmin() && (
            <Link href="/profil/degisiklikler"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent-soft)] border border-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[#C0B283]/20 transition-colors">
              <ShieldCheck size={16} />
            </Link>
          )}
          <button
            onClick={() => signOut()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 border border-white/10 text-[var(--color-text-medium)] hover:text-red-400 hover:border-red-400/30 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>


      {/* Avatar Kartı */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="glass-panel px-6 pb-6 pt-4 flex flex-col items-center text-center mt-12 !overflow-visible"
      >
        <div className="relative -mt-12 mb-3">
          <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[#b48600] text-3xl font-serif font-medium text-[var(--color-background)] shadow-[0_0_24px_rgba(192,178,131,0.35)] ring-[3px] ring-black">
            {member?.photo_url ? (
              <img src={member.photo_url} alt={fullName} className="h-full w-full object-cover" />
            ) : initials}
          </div>
          <Link
            href="/profil/duzenle"
            className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-black border border-[var(--color-border-strong)] text-[var(--color-accent)] shadow-md hover:scale-110 transition-transform"
          >
            <Edit2 size={13} />
          </Link>
        </div>

        <h2 className="font-serif text-2xl tracking-tight font-medium text-white">{fullName}</h2>

        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {member?.voice_group && (
            <span className="status-pill text-[var(--color-accent)] border-[var(--color-accent-soft)] !py-1">
              {member.voice_group}{member.sub_voice_group && member.sub_voice_group !== member.voice_group ? ` · ${member.sub_voice_group}` : ''}
            </span>
          )}
          {roles.map(role => (
            <span key={role} className="status-pill border-white/10 bg-white/5 text-white/60 !py-1">{role}</span>
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
  return <div className="h-px w-full bg-white/[0.06]" />;
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-[var(--color-text-medium)]">
        {icon}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)]">{label}</span>
        <span className={`text-[0.875rem] font-medium truncate ${value ? 'text-white/90' : 'text-white/30 italic'}`}>
          {value || 'Belirtilmemiş'}
        </span>
      </div>
    </div>
  );
}
