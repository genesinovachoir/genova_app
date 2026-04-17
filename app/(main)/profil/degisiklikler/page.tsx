'use client';

import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, Clock, ChevronRight, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/ToastProvider';

/* ----------- Types ----------- */
interface ChangeRequest {
  id: string;
  member_id: string;
  changes_json: Record<string, string>;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  reject_reason: string | null;
  created_at: string;
  requester: { first_name: string; last_name: string; voice_group: string | null } | null;
}

const FIELD_LABELS: Record<string, string> = {
  email: 'E-posta', phone: 'Telefon', birth_date: 'Doğum Tarihi',
  school_id: 'Okul (ID)', department_id: 'Bölüm (ID)',
  linkedin_url: 'LinkedIn', instagram_url: 'Instagram',
  youtube_url: 'YouTube', spotify_url: 'Spotify veya YTMUSIC',
};

const SCHOOLS: Record<string, string> = {
  'ecfbb198-9806-4754-8f21-8b076f44f345': 'İstanbul Üniversitesi-Cerrahpaşa',
  '4e051892-100b-4689-8bf2-552c8c79185d': 'İstanbul Topkapı Üniversitesi',
  '82025b8e-45f1-4d2f-9469-5b6e4e254c53': 'Marmara Üniversitesi',
  '73a04f1c-8d08-49aa-9e3f-aca8d50150f3': 'Yıldız Teknik Üniversitesi',
};
const DEPTS: Record<string, string> = {
  '8381f9d1-59d1-4f6c-bd81-814608fc6d93': 'Fen Bilgisi Öğretmenliği',
  '2d3a7104-c6cb-4e10-8748-d2aa6796ef19': 'Tıp',
  '38d2dd30-5963-4419-8634-cb4e9fe0a8b0': 'Matematik Mühendisliği',
  'b06e6885-9f86-43ab-ad2a-efa342e13e4c': 'Sosyal Bilgiler Öğretmenliği',
  'eded5e14-b2b9-449a-b5a7-895572d3a79d': 'Kimya Mühendisliği',
  '8e13bf94-76ec-44b4-ae08-873d7ad4625b': 'Endüstri Mühendisliği',
  '87dcc0ea-c890-4746-aaec-c70c433d1a7e': 'Biyomühendislik',
  'fe161a65-b917-4a01-99f3-1104d795043c': 'Çevre Mühendisliği',
  '4ffe6058-ce7f-4e82-a63d-d2147e03fd8f': 'Hukuk',
  '56c37fa0-04c2-4b9b-a493-08b5794009fb': 'İnşaat Mühendisliği',
  '7eda3a36-e3d4-4925-8861-5dc90ff88a17': 'İşletme',
  'c5895ea9-f57c-46b8-bb76-d055db05afeb': 'Kimya',
  '60effde1-6b18-4faf-9696-34c46ca98244': 'Biyomedikal Mühendisliği',
  'f4259af9-4181-4e30-ae21-01e057860ea4': 'İletişim ve Tasarım',
  '8a794ff4-c307-4e93-9652-ec2e36e1d8c3': 'Müzik',
};

function displayValue(key: string, val: string) {
  if (key === 'school_id') return SCHOOLS[val] || val;
  if (key === 'department_id') return DEPTS[val] || val;
  if (key === 'birth_date' && val) return new Date(val).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  return val || '—';
}

function formatFullDate(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return { date, time };
}

export default function ProfilDegisiklikler() {
  const { member, isAdmin, isLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectText, setRejectText] = useState<Record<string, string>>({});

  const fetchRequests = useCallback(async () => {
    setLoadingReqs(true);
    const { data, error } = await supabase
      .from('profile_change_requests')
      .select('id, member_id, changes_json, status, note, reject_reason, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Profil değişiklik talepleri alınamadı:', error);
      toast.error('Profil değişiklik talepleri yüklenemedi.', 'Profil talepleri');
    } else if (data) {
      const rows = data as Omit<ChangeRequest, 'requester'>[];
      const memberIds = Array.from(new Set(rows.map(r => r.member_id)));

      let requesterMap = new Map<string, ChangeRequest['requester']>();
      if (memberIds.length > 0) {
        const { data: members, error: membersError } = await supabase
          .from('choir_members')
          .select('id, first_name, last_name, voice_group')
          .in('id', memberIds);

        if (membersError) {
          console.warn('Talep sahipleri alınamadı:', membersError);
        } else {
          requesterMap = new Map(
            (members || []).map((m: any) => [m.id, {
              first_name: m.first_name,
              last_name: m.last_name,
              voice_group: m.voice_group,
            }]),
          );
        }
      }

      setRequests(rows.map(r => ({ ...r, requester: requesterMap.get(r.member_id) ?? null })));
    }
    setLoadingReqs(false);
  }, [toast]);

  useEffect(() => {
    if (!isLoading && !isAdmin()) router.replace('/profil');
  }, [isLoading, isAdmin, router]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleApprove = async (req: ChangeRequest) => {
    setProcessing(req.id);
    try {
      // 1. Üye tablosunu güncelle
      const { error: updateErr } = await supabase
        .from('choir_members')
        .update(req.changes_json)
        .eq('id', req.member_id);
      if (updateErr) throw updateErr;

      // 2. İsteği onayla
      const { error: reqErr } = await supabase
        .from('profile_change_requests')
        .update({ status: 'approved', reviewed_by: member!.id, reviewed_at: new Date().toISOString() })
        .eq('id', req.id);
      if (reqErr) throw reqErr;

      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));
      toast.success('Talep onaylandı.');
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`, 'Profil talepleri');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (req: ChangeRequest) => {
    setProcessing(req.id);
    try {
      const { error } = await supabase
        .from('profile_change_requests')
        .update({
          status: 'rejected',
          reviewed_by: member!.id,
          reviewed_at: new Date().toISOString(),
          reject_reason: rejectText[req.id] || null,
        })
        .eq('id', req.id);
      if (error) throw error;
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'rejected' } : r));
      toast.success('Talep reddedildi.');
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`, 'Profil talepleri');
    } finally {
      setProcessing(null);
    }
  };

  if (isLoading || loadingReqs) {
    return (
      <main className="page-shell flex min-h-[50vh] items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="h-10 w-10 rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
      </main>
    );
  }

  const pending = requests.filter(r => r.status === 'pending');
  const done = requests.filter(r => r.status !== 'pending');

  return (
    <main className="page-shell pb-28 space-y-4 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-3 px-1 pt-2">
        <Link href="/profil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 border border-white/10 text-[var(--color-text-medium)] hover:text-white transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <span className="font-serif text-xl tracking-tight font-medium text-white/90">Profil Değişiklik Talepleri</span>
        {pending.length > 0 && (
          <span className="ml-auto text-white/80 font-serif text-lg tracking-tight">
            ({pending.length})
          </span>
        )}
      </div>

      {/* Bekleyenler */}
      {pending.length === 0 ? (
        <div className="glass-panel p-8 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 size={32} className="text-green-400/60" />
          <p className="text-[0.85rem] text-[var(--color-text-medium)]">Bekleyen değişiklik talebi yok</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map(req => (
            <RequestCard key={req.id} req={req} expanded={expanded === req.id}
              onToggle={() => setExpanded(expanded === req.id ? null : req.id)}
              onApprove={() => handleApprove(req)}
              onReject={() => handleReject(req)}
              rejectText={rejectText[req.id] || ''}
              onRejectTextChange={t => setRejectText(p => ({ ...p, [req.id]: t }))}
              processing={processing === req.id} />
          ))}
        </div>
      )}

      {/* Geçmiş */}
      {done.length > 0 && (
        <>
          <div className="flex items-center gap-3 px-1 pt-3">
            <span className="text-[0.68rem] uppercase tracking-[0.2em] font-bold text-[var(--color-text-medium)]">Geçmiş</span>
          </div>
          <div className="flex flex-col gap-2">
            {done.map(req => (
              <DoneCard key={req.id} req={req} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function RequestCard({ req, expanded, onToggle, onApprove, onReject, rejectText, onRejectTextChange, processing }: {
  req: ChangeRequest; expanded: boolean; onToggle: () => void;
  onApprove: () => void; onReject: () => void;
  rejectText: string; onRejectTextChange: (t: string) => void; processing: boolean;
}) {
  const name = req.requester ? `${req.requester.first_name} ${req.requester.last_name}` : 'Bilinmiyor';
  const changes = Object.entries(req.changes_json);

  return (
    <motion.div layout className="glass-panel overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition-colors">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C0B283]/10 text-[#C0B283] shrink-0">
          <Clock size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.88rem] font-medium text-white/90 truncate">{name}</p>
          <p className="text-[0.68rem] text-[var(--color-text-medium)]">
            {changes.length} değişiklik · {formatFullDate(req.created_at).date} <span className="font-black text-[var(--color-text-medium)] opacity-80 mx-0.5">·</span> {formatFullDate(req.created_at).time}
          </p>
        </div>
        <ChevronRight size={16} className={`text-[var(--color-text-medium)] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-4">
              <div className="h-px w-full bg-white/[0.06]" />

              {/* Değişiklikler */}
              <div className="space-y-2">
                {changes.map(([key, val]) => (
                  <div key={key} className="flex items-start gap-2 rounded-lg bg-white/[0.03] p-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] block">{FIELD_LABELS[key] || key}</span>
                      <span className="text-[0.85rem] text-white/85 break-all">{displayValue(key, val)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Not */}
              {req.note && (
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] mb-1">Korist Notu</p>
                  <p className="text-[0.82rem] text-white/70 italic">{req.note}</p>
                </div>
              )}

              {/* Red nedeni */}
              <div className="space-y-1.5">
                <label className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)]">Red Nedeni (isteğe bağlı)</label>
                <textarea
                  value={rejectText}
                  onChange={e => onRejectTextChange(e.target.value)}
                  rows={2}
                  placeholder="Reddetme nedenini belirt..."
                  className="editorial-input w-full resize-none text-[0.82rem]"
                />
              </div>

              {/* Butonlar */}
              <div className="flex gap-2">
                <button onClick={onApprove} disabled={processing}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 py-2.5 text-[0.82rem] font-bold hover:bg-green-500/30 transition-colors disabled:opacity-50">
                  {processing ? '...' : <><CheckCircle2 size={15} /> Onayla</>}
                </button>
                <button onClick={onReject} disabled={processing}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 py-2.5 text-[0.82rem] font-bold hover:bg-red-500/20 transition-colors disabled:opacity-50">
                  {processing ? '...' : <><XCircle size={15} /> Reddet</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DoneCard({ req }: { req: ChangeRequest }) {
  const name = req.requester ? `${req.requester.first_name} ${req.requester.last_name}` : 'Bilinmiyor';
  const changes = Object.keys(req.changes_json).length;
  const isApproved = req.status === 'approved';
  return (
    <div className="glass-panel p-4 flex items-center gap-3 opacity-60">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${isApproved ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
        {isApproved ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[0.82rem] font-medium text-white/80 truncate">{name}</p>
        <p className="text-[0.65rem] text-[var(--color-text-medium)]">{changes} değişiklik · {isApproved ? 'Onaylandı' : 'Reddedildi'}</p>
      </div>
      <span className="text-[0.62rem] text-[var(--color-text-medium)]">
        {formatFullDate(req.created_at).date} <span className="font-black text-[var(--color-text-medium)] opacity-80 mx-0.5">·</span> {formatFullDate(req.created_at).time}
      </span>
    </div>
  );
}
