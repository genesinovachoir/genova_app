'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Strikethrough, List, ImageIcon, Loader2 } from 'lucide-react';
import { useRef, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ToastProvider';

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  borderless?: boolean;
}

interface PendingLinkPrompt {
  url: string;
  from: number;
  to: number;
  text: string;
  title: string;
}

// Sanitize: only allow http/https URLs
function sanitizeUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function sanitizeTypedUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withProtocol = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  return sanitizeUrl(withProtocol);
}

function isWwwTypedUrlCandidate(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed.startsWith('www.')) return false;

  const rest = trimmed.slice(4);
  const lastDot = rest.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === rest.length - 1) return false;

  const tld = rest.slice(lastDot + 1);
  return /^[a-z\u00c0-\u024f][a-z0-9\u00c0-\u024f-]*$/i.test(tld);
}

interface LinkCandidate {
  url: string;
  from: number;
  to: number;
  text: string;
}

function findLinkMarkCandidate(editor: Editor): LinkCandidate | null {
  const pos = editor.state.selection.from;
  const $from = editor.state.doc.resolve(pos);
  const parent = $from.parent;
  const startPos = $from.start();
  let offset = 0;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = startPos + offset;
    const childTo = childFrom + child.nodeSize;
    const inChild = pos >= childFrom && pos <= childTo;

    if (inChild && child.isText) {
      const mark = child.marks.find((m) => m.type.name === 'link');
      const href = mark?.attrs?.href;
      if (!mark || typeof href !== 'string') return null;

      let left = i;
      let right = i;
      while (left > 0) {
        const prev = parent.child(left - 1);
        if (!prev.isText) break;
        const prevMark = prev.marks.find((m) => m.type.name === 'link' && m.attrs?.href === href);
        if (!prevMark) break;
        left--;
      }
      while (right < parent.childCount - 1) {
        const next = parent.child(right + 1);
        if (!next.isText) break;
        const nextMark = next.marks.find((m) => m.type.name === 'link' && m.attrs?.href === href);
        if (!nextMark) break;
        right++;
      }

      let fromOffset = 0;
      for (let k = 0; k < left; k++) fromOffset += parent.child(k).nodeSize;
      let toOffset = fromOffset;
      for (let k = left; k <= right; k++) toOffset += parent.child(k).nodeSize;

      const from = startPos + fromOffset;
      const to = startPos + toOffset;
      return {
        url: href,
        from,
        to,
        text: editor.state.doc.textBetween(from, to, ' '),
      };
    }

    offset += child.nodeSize;
  }

  return null;
}

function findTypedUrlCandidate(editor: Editor): LinkCandidate | null {
  const pos = editor.state.selection.from;
  const $from = editor.state.doc.resolve(pos);
  const parent = $from.parent;
  const startPos = $from.start();
  let offset = 0;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = startPos + offset;
    const childTo = childFrom + child.nodeSize;
    const inChild = pos >= childFrom && pos <= childTo;

    if (inChild && child.isText) {
      const text = child.text ?? '';
      const re = /www\.[^\s<>"'`]+/gi;
      let match: RegExpExecArray | null = null;

      while ((match = re.exec(text)) !== null) {
        const raw = match[0];
        const trimmed = raw.replace(/[.,!?;:)\]]+$/g, '');
        if (!trimmed) continue;

        const from = childFrom + match.index;
        const to = from + trimmed.length;
        const within = pos >= from && pos <= to;
        if (!within) continue;

        if (!isWwwTypedUrlCandidate(trimmed)) continue;
        const safeUrl = sanitizeTypedUrl(trimmed);
        if (!safeUrl) continue;

        return { url: safeUrl, from, to, text: trimmed };
      }
    }

    offset += child.nodeSize;
  }

  return null;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Duyuru içeriğini buraya girin... (- yazıp boşluk bırakarak liste başlatabilirsiniz)',
  borderless = false,
}: Props) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [pendingLink, setPendingLink] = useState<PendingLinkPrompt | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: { class: 'text-[var(--color-accent)] underline underline-offset-2', rel: 'noopener noreferrer', target: '_blank' },
        // Validate link before setting
        validate: (href) => !!sanitizeUrl(href),
      }),
      Image.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: { class: 'max-w-full rounded-[var(--radius-panel)] border border-[var(--color-border)] my-4 object-cover max-h-[60vh] bg-black' },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[60px] text-[15px] sm:text-[16px] leading-[1.3] prose-p:my-0.5 text-[var(--color-text-high)] opacity-90',
      },
    },
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    if (content !== currentHtml && content !== '<p></p>') {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const refreshPendingLink = useCallback((instance: Editor) => {
    const candidate = findLinkMarkCandidate(instance) ?? findTypedUrlCandidate(instance);

    if (!candidate) {
      setPendingLink(null);
      return;
    }

    setPendingLink((prev) => {
      if (prev && prev.from === candidate.from && prev.to === candidate.to && prev.url === candidate.url) {
        return prev;
      }
      return { ...candidate, title: '' };
    });
  }, []);

  useEffect(() => {
    if (!editor) return;
    refreshPendingLink(editor);

    const onUpdate = () => refreshPendingLink(editor);
    const onSelectionUpdate = () => refreshPendingLink(editor);

    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelectionUpdate);
    return () => {
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelectionUpdate);
    };
  }, [editor, refreshPendingLink]);

  const confirmLinkTitle = useCallback(() => {
    if (!editor || !pendingLink) return;
    const title = pendingLink.title.trim();
    const label = title || pendingLink.text;

    const endPos = pendingLink.from + label.length + 1;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pendingLink.from, to: pendingLink.to })
      .insertContent([
        {
          type: 'text',
          text: label,
          marks: [{ type: 'link', attrs: { href: pendingLink.url } }],
        },
        { type: 'text', text: ' ' },
      ])
      .setTextSelection(endPos)
      .unsetLink()
      .run();

    setPendingLink(null);
  }, [editor, pendingLink]);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pendingLink) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmLinkTitle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingLink, confirmLinkTitle]);

  const handleImageUpload = async (file: File) => {
    try {
      setUploading(true);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
      if (!allowed.includes(ext)) throw new Error('Desteklenmeyen format');
      if (file.size > 5 * 1024 * 1024) throw new Error('Dosya 5 MB\'dan büyük olamaz');

      const r = Math.random().toString(36).substring(7);
      const path = `${Date.now()}_${r}.${ext}`;
      const { error } = await supabase.storage.from('announcements-images').upload(path, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('announcements-images').getPublicUrl(path);
      editor?.chain().focus().setImage({ src: publicUrl }).run();
    } catch (err: any) {
      console.error('Upload err:', err);
      toast.error(err.message ?? 'Görsel yüklenemedi.', 'Görsel yükleme');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!editor) return null;

  return (
    <div className={`rounded-[var(--radius-panel)] ${borderless ? '' : 'border border-[var(--color-border)]'} bg-[#0A0A0A] overflow-hidden flex flex-col`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--color-border)] bg-[#111] px-2 py-1">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1 rounded-[4px] hover:bg-white/10 transition-colors ${editor.isActive('bold') ? 'bg-white/10 text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'}`}>
          <Bold size={13} strokeWidth={2.5} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1 rounded-[4px] hover:bg-white/10 transition-colors ${editor.isActive('italic') ? 'bg-white/10 text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'}`}>
          <Italic size={13} strokeWidth={2.5} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`p-1 rounded-[4px] hover:bg-white/10 transition-colors ${editor.isActive('strike') ? 'bg-white/10 text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'}`}>
          <Strikethrough size={13} strokeWidth={2.5} />
        </button>

        <div className="w-px h-3.5 bg-[var(--color-border)] mx-1" />

        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1 rounded-[4px] hover:bg-white/10 transition-colors ${editor.isActive('bulletList') ? 'bg-white/10 text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'}`}>
          <List size={13} strokeWidth={2.5} />
        </button>

        <div className="w-px h-3.5 bg-[var(--color-border)] mx-1" />

        {/* Image upload */}
        <label className="p-1 rounded-[4px] hover:bg-white/10 transition-colors text-[var(--color-text-medium)] cursor-pointer flex items-center justify-center">
          <input type="file" accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden" ref={fileInputRef}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
          {uploading ? <Loader2 size={13} className="animate-spin text-[var(--color-accent)]" /> : <ImageIcon size={13} strokeWidth={2.5} />}
        </label>
      </div>

      {/* URL paste prompt */}
      {pendingLink && (
        <div className="border-b border-[var(--color-border)] bg-[#111] px-3 py-2">
          <p className="text-[0.72rem] text-[var(--color-text-medium)] mb-1.5">
            Link algılandı. Başlık eklemek ister misin?
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={pendingLink.title}
              onChange={(e) => setPendingLink((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
              placeholder="Bağlantı başlığı"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-black/30 px-2 py-1.5 text-[13px] text-[var(--color-text-high)] placeholder:text-[var(--color-text-medium)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              onClick={confirmLinkTitle}
              className="rounded-md bg-[var(--color-accent)] px-2.5 py-1.5 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-black transition-opacity hover:opacity-90"
            >
              Onayla
            </button>
          </div>
        </div>
      )}

      {/* Editor Content Area */}
      <div className="p-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
