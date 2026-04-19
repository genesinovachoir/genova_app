'use client';

import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, Clock, ChevronRight, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ToastProvider';

interface PersonSummary {
  first_name: string;
  last_name: string;
  voice_group: string | null;
}

interface ChangeRequest {
  id: string;
  member_id: string;
  changes_json: Record<string, string>;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  requester: PersonSummary | null;
  reviewer: PersonSummary | null;
}

const FIELD_LABELS: Record<string, string> = {
  email: 'E-posta',
  phone: 'Telefon',
  birth_date: 'Doğum Tarihi',
  school_id: 'Okul',
  department_id: 'Bölüm',
  linkedin_url: 'LinkedIn',
  instagram_url: 'Instagram',
  youtube_url: 'YouTube',
  spotify_url: 'Spotify veya YTMUSIC',
  photo_url: 'Profil Fotoğrafı',
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
  if (key === 'school_id') {
    return SCHOOLS[val] || val;
  }
  if (key === 'department_id') {
    return DEPTS[val] || val;
  }
  if (key === 'birth_date' && val) {
    return new Date(val).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  if (key === 'photo_url') {
    return val ? 'Profil fotoğrafı güncellendi' : 'Profil fotoğrafı temizlendi';
  }
  return val || '—';
}

function formatFullDate(iso: string | null) {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);
  const datePart = date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${datePart} · ${timePart}`;
}

function getStatusLabel(status: ChangeRequest['status']) {
  if (status === 'pending') {
    return 'Beklemede';
  }
  if (status === 'approved') {
    return 'Onaylandı';
  }
  return 'Reddedildi';
}

function statusPillClass(status: ChangeRequest['status']) {
  if (status === 'approved') {
    return 'bg-[var(--status-approved-bg)] text-[var(--status-approved-text)] border-[var(--status-approved-border)]';
  }
  if (status === 'rejected') {
    return 'bg-[var(--status-rejected-bg)] text-[var(--status-rejected-text)] border-[var(--status-rejected-border)]';
  }
  return 'bg-[var(--status-pending-bg)] text-[var(--status-pending-text)] border-[var(--status-pending-border)]';
}

async function reviewRequest(params: { requestId: string; action: 'approve' | 'reject'; rejectReason?: string }) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.');
  }

  const response = await fetch('/api/profile-change-requests/review', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'İşlem başarısız.');
  }
}

export default function ProfilDegisiklikler() {
  const { member, isAdmin, isLoading } = useAuth();
  const chefView = isAdmin();
  const toast = useToast();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedDone, setExpandedDone] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectText, setRejectText] = useState<Record<string, string>>({});

  const fetchRequests = useCallback(async () => {
    setLoadingReqs(true);

    const { data, error } = await supabase
      .from('profile_change_requests')
      .select('id, member_id, changes_json, status, note, reject_reason, reviewed_by, reviewed_at, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Profil değişiklik talepleri alınamadı:', error);
      toast.error('Profil değişiklik talepleri yüklenemedi.', 'Profil talepleri');
      setLoadingReqs(false);
      return;
    }

    const rows = (data ?? []) as Omit<ChangeRequest, 'requester' | 'reviewer'>[];
    const personIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [row.member_id, row.reviewed_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    let peopleMap = new Map<string, PersonSummary>();
    if (personIds.length > 0) {
      const { data: people, error: peopleError } = await supabase
        .from('choir_members')
        .select('id, first_name, last_name, voice_group')
        .in('id', personIds);

      if (peopleError) {
        console.warn('İlgili kişi bilgileri alınamadı:', peopleError);
      } else {
        peopleMap = new Map(
          (people ?? []).map((person: any) => [
            person.id,
            {
              first_name: person.first_name,
              last_name: person.last_name,
              voice_group: person.voice_group,
            },
          ]),
        );
      }
    }

    setRequests(
      rows.map((row) => ({
        ...row,
        requester: peopleMap.get(row.member_id) ?? null,
        reviewer: row.reviewed_by ? peopleMap.get(row.reviewed_by) ?? null : null,
      })),
    );

    setLoadingReqs(false);
  }, [toast]);

  useEffect(() => {
    if (!member?.id) {
      setLoadingReqs(false);
      return;
    }

    void fetchRequests();
  }, [fetchRequests, member?.id]);

  useEffect(() => {
    if (!member?.id) {
      return;
    }

    const channel = supabase
      .channel(`profile-change-requests-page:${member.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profile_change_requests',
          ...(chefView ? {} : { filter: `member_id=eq.${member.id}` }),
        },
        () => {
          void fetchRequests();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chefView, fetchRequests, member?.id]);

  const handleApprove = async (req: ChangeRequest) => {
    setProcessing(req.id);
    try {
      await reviewRequest({ requestId: req.id, action: 'approve' });
      await fetchRequests();
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
      await reviewRequest({
        requestId: req.id,
        action: 'reject',
        rejectReason: rejectText[req.id] || undefined,
      });
      await fetchRequests();
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
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="h-10 w-10 rounded-full border-2 border-[var(--color-accent)] border-t-transparent"
        />
      </main>
    );
  }

  const isChefView = chefView;
  const pending = requests.filter((request) => request.status === 'pending');
  const done = requests.filter((request) => request.status !== 'pending');

  return (
    <main className="page-shell pb-28 space-y-4 !pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-3 px-1 pt-2">
        <Link
          href="/profil"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-soft-bg)] text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] transition-colors"
        >
          <ArrowLeft size={16} />
        </Link>
        <span className="font-serif text-xl tracking-tight font-medium text-[var(--color-text-high)]">
          {isChefView ? 'Profil Değişiklik Talepleri' : 'Profil Değişiklik Taleplerim'}
        </span>
      </div>

      {requests.length === 0 ? (
        <div className="glass-panel p-8 flex flex-col items-center gap-3 text-center">
          <Clock size={32} className="text-[var(--color-accent)]/60" />
          <p className="text-[0.85rem] text-[var(--color-text-medium)]">
            {isChefView ? 'Henüz profil değişiklik talebi yok.' : 'Henüz gönderilmiş profil değişiklik talebin yok.'}
          </p>
        </div>
      ) : isChefView ? (
        <>
          {pending.length === 0 ? (
            <div className="glass-panel p-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={32} className="text-green-400/60" />
              <p className="text-[0.85rem] text-[var(--color-text-medium)]">Bekleyen değişiklik talebi yok</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {pending.map((request) => (
                <ChefPendingRequestCard
                  key={request.id}
                  req={request}
                  expanded={expanded === request.id}
                  onToggle={() => setExpanded(expanded === request.id ? null : request.id)}
                  onApprove={() => handleApprove(request)}
                  onReject={() => handleReject(request)}
                  rejectText={rejectText[request.id] || ''}
                  onRejectTextChange={(text) =>
                    setRejectText((previous) => ({
                      ...previous,
                      [request.id]: text,
                    }))
                  }
                  processing={processing === request.id}
                />
              ))}
            </div>
          )}

          {done.length > 0 && (
            <>
              <div className="flex items-center gap-3 px-1 pt-3">
                <span className="text-[0.68rem] uppercase tracking-[0.2em] font-bold text-[var(--color-text-medium)]">
                  Geçmiş
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {done.map((request) => (
                  <ChefDoneCard
                    key={request.id}
                    req={request}
                    expanded={expandedDone === request.id}
                    onToggle={() => setExpandedDone(expandedDone === request.id ? null : request.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((request) => (
            <ChoristRequestCard
              key={request.id}
              req={request}
              expanded={expanded === request.id}
              onToggle={() => setExpanded(expanded === request.id ? null : request.id)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function ChoristRequestCard({ req, expanded, onToggle }: { req: ChangeRequest; expanded: boolean; onToggle: () => void }) {
  const changes = Object.entries(req.changes_json);
  const reviewerName = req.reviewer ? `${req.reviewer.first_name} ${req.reviewer.last_name}` : '—';

  return (
    <motion.div layout className="glass-panel overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left hover:bg-[var(--color-soft-bg)] transition-colors">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--status-pending-bg)] text-[var(--status-pending-text)] shrink-0">
          <Clock size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.88rem] font-medium text-[var(--color-text-high)] truncate">{changes.length} değişiklik</p>
          <p className="text-[0.68rem] text-[var(--color-text-medium)]">Talep: {formatFullDate(req.created_at)}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] ${statusPillClass(req.status)}`}>
          {getStatusLabel(req.status)}
        </span>
        <ChevronRight size={16} className={`text-[var(--color-text-medium)] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              <div className="h-px w-full bg-[var(--color-border)]" />

              <InfoRow label="Durum" value={getStatusLabel(req.status)} />
              <InfoRow label="Talep Zamanı" value={formatFullDate(req.created_at)} />
              <InfoRow label="Karar Zamanı" value={formatFullDate(req.reviewed_at)} />
              <InfoRow label="Karar Veren" value={reviewerName} />

              {req.status === 'rejected' && req.reject_reason && <InfoRow label="Red Sebebi" value={req.reject_reason} />}

              {req.note && (
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <p className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] mb-1">Korist Notu</p>
                  <p className="text-[0.82rem] text-[var(--color-text-medium)] italic">{req.note}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)]">Değişiklik Detayları</p>
                {changes.map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-[var(--color-soft-bg)] p-3">
                    <span className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] block">
                      {FIELD_LABELS[key] || key}
                    </span>
                    <span className="text-[0.85rem] text-[var(--color-text-high)] break-all">{displayValue(key, value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ChefPendingRequestCard({
  req,
  expanded,
  onToggle,
  onApprove,
  onReject,
  rejectText,
  onRejectTextChange,
  processing,
}: {
  req: ChangeRequest;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  rejectText: string;
  onRejectTextChange: (value: string) => void;
  processing: boolean;
}) {
  const requesterName = req.requester ? `${req.requester.first_name} ${req.requester.last_name}` : 'Bilinmiyor';
  const changes = Object.entries(req.changes_json);

  return (
    <motion.div layout className="glass-panel overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left hover:bg-[var(--color-soft-bg)] transition-colors">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--status-pending-bg)] text-[var(--status-pending-text)] shrink-0">
          <Clock size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.88rem] font-medium text-[var(--color-text-high)] truncate">{requesterName}</p>
          <p className="text-[0.68rem] text-[var(--color-text-medium)]">
            {changes.length} değişiklik · {formatFullDate(req.created_at)}
          </p>
        </div>
        <ChevronRight size={16} className={`text-[var(--color-text-medium)] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              <div className="h-px w-full bg-[var(--color-border)]" />

              <div className="space-y-2">
                {changes.map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2 rounded-lg bg-[var(--color-soft-bg)] p-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] block">
                        {FIELD_LABELS[key] || key}
                      </span>
                      <span className="text-[0.85rem] text-[var(--color-text-high)] break-all">{displayValue(key, value)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {req.note && (
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <p className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] mb-1">Korist Notu</p>
                  <p className="text-[0.82rem] text-[var(--color-text-medium)] italic">{req.note}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)]">Red Nedeni (isteğe bağlı)</label>
                <textarea
                  value={rejectText}
                  onChange={(event) => onRejectTextChange(event.target.value)}
                  rows={2}
                  placeholder="Reddetme nedenini belirt..."
                  className="editorial-input w-full resize-none text-[0.82rem]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={onApprove}
                  disabled={processing}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 py-2.5 text-[0.82rem] font-bold hover:bg-green-500/30 transition-colors disabled:opacity-50"
                >
                  {processing ? '...' : (<><CheckCircle2 size={15} /> Onayla</>)}
                </button>
                <button
                  onClick={onReject}
                  disabled={processing}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 py-2.5 text-[0.82rem] font-bold hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  {processing ? '...' : (<><XCircle size={15} /> Reddet</>)}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ChefDoneCard({ req, expanded, onToggle }: { req: ChangeRequest; expanded: boolean; onToggle: () => void }) {
  const requesterName = req.requester ? `${req.requester.first_name} ${req.requester.last_name}` : 'Bilinmiyor';
  const reviewerName = req.reviewer ? `${req.reviewer.first_name} ${req.reviewer.last_name}` : '—';
  const changes = Object.keys(req.changes_json).length;
  const changeEntries = Object.entries(req.changes_json);
  const isApproved = req.status === 'approved';

  return (
    <motion.div layout className="glass-panel overflow-hidden opacity-75">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left hover:bg-[var(--color-soft-bg)] transition-colors">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
            isApproved ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {isApproved ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.82rem] font-medium text-[var(--color-text-high)] truncate">{requesterName}</p>
          <p className="text-[0.65rem] text-[var(--color-text-medium)]">
            {changes} değişiklik · {isApproved ? 'Onaylandı' : 'Reddedildi'}
          </p>
        </div>
        <span className="text-[0.62rem] text-[var(--color-text-medium)]">{formatFullDate(req.created_at)}</span>
        <ChevronRight size={16} className={`text-[var(--color-text-medium)] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              <div className="h-px w-full bg-[var(--color-border)]" />

              <InfoRow label="Durum" value={getStatusLabel(req.status)} />
              <InfoRow label="Talep Zamanı" value={formatFullDate(req.created_at)} />
              <InfoRow label="Karar Zamanı" value={formatFullDate(req.reviewed_at)} />
              <InfoRow label="Karar Veren" value={reviewerName} />

              {req.status === 'rejected' && req.reject_reason && <InfoRow label="Red Sebebi" value={req.reject_reason} />}

              {req.note && (
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <p className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] mb-1">Korist Notu</p>
                  <p className="text-[0.82rem] text-[var(--color-text-medium)] italic">{req.note}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)]">Değişiklik Detayları</p>
                {changeEntries.map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-[var(--color-soft-bg)] p-3">
                    <span className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] block">
                      {FIELD_LABELS[key] || key}
                    </span>
                    <span className="text-[0.85rem] text-[var(--color-text-high)] break-all">{displayValue(key, value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <p className="text-[0.60rem] uppercase tracking-wider text-[var(--color-text-medium)] mb-1">{label}</p>
      <p className="text-[0.82rem] text-[var(--color-text-high)] break-all">{value || '—'}</p>
    </div>
  );
}
