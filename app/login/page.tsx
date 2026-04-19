'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import ThemeToggle from '@/components/ThemeToggle';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, session, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && session) {
      router.replace('/');
    }
  }, [session, isLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email, password);
    if (error) {
      setError('E-posta veya şifre hatalı.');
      setSubmitting(false);
    } else {
      router.replace('/');
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={32} />
      </div>
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[var(--color-background)] px-5 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_55%_at_50%_0%,var(--color-accent-soft),transparent_70%)]" />
      <div className="absolute right-5 top-[calc(env(safe-area-inset-top)+1rem)] z-20">
        <ThemeToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex w-full max-w-sm flex-col"
      >
        {/* Logo */}
        <div
          className="flex flex-col items-center gap-2"
          style={{
            // Move the logo block toward the golden-ratio anchor (~38.2% from top).
            marginTop: 'clamp(-6.5rem, -11.8vh, -2rem)',
          }}
        >
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden pointer-events-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/login.png"
              alt="Genova Login Logo"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="text-center">
            <h1 className="font-serif text-2xl tracking-[-0.04em] text-[var(--color-text-high)]">
              Hoş Geldiniz
            </h1>
            <p className="mt-1 text-xs text-[var(--color-text-medium)]">
              Koro portalına giriş yapın
            </p>
          </div>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="glass-panel mt-[clamp(1.5rem,3.8vh,3rem)] space-y-4 p-6"
        >
          <div className="space-y-2">
            <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
              E-posta
            </label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="E-posta adresiniz"
              required
              className="editorial-input"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
              Şifre
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="editorial-input pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[4px] border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[0.78rem] text-rose-400"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-[var(--color-border-strong)] bg-[linear-gradient(180deg,var(--color-accent),color-mix(in_srgb,var(--color-accent)_85%,#7d5f2a))] py-3.5 font-sans text-[0.8rem] font-bold uppercase tracking-[0.18em] text-[#1f170b] transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? (
              <><Loader2 size={16} className="animate-spin" /> Giriş yapılıyor...</>
            ) : (
              'Giriş Yap'
            )}
          </button>
        </form>


      </motion.div>
    </main>
  );
}
