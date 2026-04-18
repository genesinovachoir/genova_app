'use client';

import { useEffect, useRef } from 'react';

import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/ToastProvider';
import { supabase } from '@/lib/supabase';

type RequestStatus = 'pending' | 'approved' | 'rejected';

interface ProfileChangeRealtimeRecord {
  id: string;
  status: RequestStatus;
  reject_reason: string | null;
  reviewed_at: string | null;
}

function buildToastContent(record: ProfileChangeRealtimeRecord) {
  if (record.status === 'approved') {
    return {
      title: 'Profil Talebi',
      description: 'Profil değişiklik talebin onaylandı.',
    };
  }

  const reason = record.reject_reason?.trim();
  return {
    title: 'Profil Talebi',
    description: reason
      ? `Profil değişiklik talebin reddedildi. Sebep: ${reason}`
      : 'Profil değişiklik talebin reddedildi.',
  };
}

function showForegroundNotification(record: ProfileChangeRealtimeRecord) {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  const content = buildToastContent(record);
  const notification = new Notification(content.title, {
    body: content.description,
    tag: `profile-change-request-${record.id}-${record.status}`,
    data: { url: '/profil/degisiklikler' },
  });

  notification.onclick = () => {
    window.focus();
    window.location.href = '/profil/degisiklikler';
  };
}

export function ProfileChangeRequestNotifier() {
  const { member, isChorist } = useAuth();
  const toast = useToast();
  const handledEventKeysRef = useRef<Set<string>>(new Set());
  const choristView = isChorist();

  useEffect(() => {
    if (!member?.id || !choristView) {
      return;
    }

    const channel = supabase
      .channel(`profile-change-requests:${member.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profile_change_requests',
          filter: `member_id=eq.${member.id}`,
        },
        (payload) => {
          const nextRecord = payload.new as ProfileChangeRealtimeRecord;
          const prevRecord = payload.old as ProfileChangeRealtimeRecord;

          if (!nextRecord || (nextRecord.status !== 'approved' && nextRecord.status !== 'rejected')) {
            return;
          }

          if (!prevRecord || prevRecord.status !== 'pending') {
            return;
          }

          const eventKey = `${nextRecord.id}:${nextRecord.status}:${nextRecord.reviewed_at ?? ''}`;
          if (handledEventKeysRef.current.has(eventKey)) {
            return;
          }

          handledEventKeysRef.current.add(eventKey);
          if (handledEventKeysRef.current.size > 100) {
            const [firstKey] = handledEventKeysRef.current;
            if (firstKey) {
              handledEventKeysRef.current.delete(firstKey);
            }
          }

          const content = buildToastContent(nextRecord);
          toast.info(content.description, content.title);
          showForegroundNotification(nextRecord);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [choristView, member?.id, toast]);

  return null;
}
