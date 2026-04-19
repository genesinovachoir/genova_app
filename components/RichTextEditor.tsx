'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { markInputRule, markPasteRule } from '@tiptap/core';
import TiptapBold from '@tiptap/extension-bold';
import TiptapItalic from '@tiptap/extension-italic';
import TiptapStrike from '@tiptap/extension-strike';
import NextImage from 'next/image';

const CustomBold = TiptapBold.extend({
  addInputRules() {
    return [
      markInputRule({ find: /(?:^|\s)((?:\*\*)([^*]+)(?:\*\*))$/u, type: this.type }),
      markInputRule({ find: /(?:^|\s)((?:__)([^_]+)(?:__))$/u, type: this.type })
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({ find: /(?:^|\s)((?:\*\*)([^*]+)(?:\*\*))/g, type: this.type }),
      markPasteRule({ find: /(?:^|\s)((?:__)([^_]+)(?:__))/g, type: this.type })
    ];
  }
});

const CustomItalic = TiptapItalic.extend({
  addInputRules() {
    return [
      markInputRule({ find: /(?:^|\s)((?:\*)([^*]+)(?:\*))$/u, type: this.type }),
      markInputRule({ find: /(?:^|\s)((?:_)([^_]+)(?:_))$/u, type: this.type })
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({ find: /(?:^|\s)((?:\*)([^*]+)(?:\*))/g, type: this.type }),
      markPasteRule({ find: /(?:^|\s)((?:_)([^_]+)(?:_))/g, type: this.type })
    ];
  }
});

const CustomStrike = TiptapStrike.extend({
  addInputRules() {
    return [
      markInputRule({ find: /(?:^|\s)((?:~~)([^~]+)(?:~~))$/u, type: this.type })
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({ find: /(?:^|\s)((?:~~)([^~]+)(?:~~))/g, type: this.type })
    ];
  }
});
import { Bold, Italic, Strikethrough, List, ImageIcon, Loader2 } from 'lucide-react';
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ToastProvider';
import {
  createSlugLookup,
  getAssignmentPath,
  getLastPageLabel,
  getRepertoirePath,
  normalizeInternalPath,
} from '@/lib/internalPageLinks';

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

interface LinkCandidate {
  url: string;
  from: number;
  to: number;
  text: string;
}

interface TextRangeCandidate {
  from: number;
  to: number;
  text: string;
}

interface InternalPageOption {
  path: string;
  label: string;
  parentPath: string | null;
  hasChildren: boolean;
}

interface SlashMenuState extends TextRangeCandidate {
  contextRoot: string | null;
  items: InternalPageOption[];
}

interface SlashMenuLayout {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  listMaxHeight: number;
}

const ROOT_PAGE_OPTIONS: InternalPageOption[] = [
  { path: '/', label: 'Ana Sayfa', parentPath: null, hasChildren: false },
  { path: '/profil', label: 'Profil', parentPath: null, hasChildren: true },
  { path: '/repertuvar', label: 'Repertuvar', parentPath: null, hasChildren: true },
  { path: '/odevler', label: 'Ödevler', parentPath: null, hasChildren: true },
];

const PROFILE_CHILD_OPTIONS: InternalPageOption[] = [
  { path: '/profil/duzenle', label: 'Profil Düzenle', parentPath: '/profil', hasChildren: false },
  { path: '/profil/degisiklikler', label: 'Profil Değişiklikler', parentPath: '/profil', hasChildren: false },
];

function sanitizeInternalPath(url: string): string | null {
  return normalizeInternalPath(url);
}

function isInternalPath(url: string): boolean {
  return Boolean(sanitizeInternalPath(url));
}

// Sanitize: only allow http/https URLs and internal app paths
function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const internal = sanitizeInternalPath(trimmed);
  if (internal) return internal;

  try {
    const u = new URL(trimmed);
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

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
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

function findSlashTokenCandidate(editor: Editor): TextRangeCandidate | null {
  const selection = editor.state.selection;
  if (!selection.empty) return null;

  const pos = selection.from;
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
      const cursorIndex = Math.max(0, Math.min(pos - childFrom, text.length));

      let start = cursorIndex - 1;
      while (start >= 0 && !/\s/.test(text[start] ?? '')) start--;
      start += 1;

      const token = text.slice(start, cursorIndex);
      if (!token.startsWith('/')) return null;

      return {
        from: childFrom + start,
        to: childFrom + cursorIndex,
        text: token,
      };
    }

    offset += child.nodeSize;
  }

  return null;
}

function findSpaceTerminatedSlashCandidate(editor: Editor): TextRangeCandidate | null {
  const selection = editor.state.selection;
  if (!selection.empty) return null;

  const pos = selection.from;
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
      const cursorIndex = Math.max(0, Math.min(pos - childFrom, text.length));
      if (cursorIndex === 0) return null;

      const charBeforeCursor = text[cursorIndex - 1] ?? '';
      if (!/\s/.test(charBeforeCursor)) return null;

      let tokenEnd = cursorIndex - 1;
      while (tokenEnd >= 0 && /\s/.test(text[tokenEnd] ?? '')) tokenEnd--;
      if (tokenEnd < 0) return null;

      let tokenStart = tokenEnd;
      while (tokenStart >= 0 && !/\s/.test(text[tokenStart] ?? '')) tokenStart--;
      tokenStart += 1;

      const token = text.slice(tokenStart, tokenEnd + 1);
      if (!token.startsWith('/')) return null;

      return {
        from: childFrom + tokenStart,
        to: childFrom + cursorIndex,
        text: token,
      };
    }

    offset += child.nodeSize;
  }

  return null;
}

function resolveSlashSuggestions(
  rawToken: string,
  rootPages: InternalPageOption[],
  childrenByRoot: Record<string, InternalPageOption[]>,
): { contextRoot: string | null; items: InternalPageOption[] } | null {
  if (!rawToken.startsWith('/')) return null;

  const lowered = rawToken.toLowerCase();
  const hasTrailingSlash = lowered.length > 1 && lowered.endsWith('/');
  const segments = lowered.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { contextRoot: null, items: rootPages };
  }

  if (segments.length === 1 && !hasTrailingSlash) {
    const query = segments[0];
    const items = rootPages.filter((page) => {
      if (page.path === '/') return 'anasayfa'.includes(query) || 'home'.includes(query);
      const pageSegment = page.path.slice(1).toLowerCase();
      return pageSegment.startsWith(query) || page.label.toLowerCase().includes(query);
    });
    return { contextRoot: null, items };
  }

  const rootPath = `/${segments[0]}`;
  const children = childrenByRoot[rootPath] ?? [];
  const childQuery = hasTrailingSlash ? '' : segments.slice(1).join('/');

  const items = children.filter((entry) => {
    if (!childQuery) return true;
    const childPath = entry.path.slice(rootPath.length + 1).toLowerCase();
    return childPath.startsWith(childQuery) || entry.label.toLowerCase().includes(childQuery);
  });

  return { contextRoot: rootPath, items };
}

export function RichTextEditor({
  content,
  onChange,
  borderless = false,
}: Props) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [pendingLink, setPendingLink] = useState<PendingLinkPrompt | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [slashMenuLayout, setSlashMenuLayout] = useState<SlashMenuLayout | null>(null);
  const [dynamicChildrenByRoot, setDynamicChildrenByRoot] = useState<Record<string, InternalPageOption[]>>({
    '/profil': PROFILE_CHILD_OPTIONS,
    '/repertuvar': [],
    '/odevler': [],
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const isApplyingSlashTokenRef = useRef(false);

  const childrenByRoot = useMemo(
    () => ({
      '/profil': PROFILE_CHILD_OPTIONS,
      '/repertuvar': dynamicChildrenByRoot['/repertuvar'] ?? [],
      '/odevler': dynamicChildrenByRoot['/odevler'] ?? [],
    }),
    [dynamicChildrenByRoot],
  );

  const allInternalPages = useMemo(() => {
    const collected: InternalPageOption[] = [...ROOT_PAGE_OPTIONS];
    const seen = new Set(ROOT_PAGE_OPTIONS.map((item) => item.path));

    for (const entries of Object.values(childrenByRoot)) {
      for (const entry of entries) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        collected.push(entry);
      }
    }

    return collected;
  }, [childrenByRoot]);

  const internalPathMap = useMemo(() => {
    const map = new Map<string, InternalPageOption>();
    for (const page of allInternalPages) {
      const normalized = normalizeInternalPath(page.path);
      if (normalized) {
        map.set(normalized, page);
      }
    }
    return map;
  }, [allInternalPages]);

  const internalPathMapRef = useRef(internalPathMap);
  useEffect(() => {
    internalPathMapRef.current = internalPathMap;
  }, [internalPathMap]);

  useEffect(() => {
    let cancelled = false;

    const loadDynamicPages = async () => {
      try {
        const [songsRes, assignmentsRes] = await Promise.all([
          supabase.from('repertoire').select('id, title, created_at').order('title'),
          supabase.from('assignments').select('id, title, created_at').order('title'),
        ]);

        if (cancelled) return;

        const repertoireChildren: InternalPageOption[] = [];
        if (!songsRes.error) {
          const songs = (songsRes.data ?? []) as Array<{ id: string; title: string | null; created_at: string | null }>;
          const lookup = createSlugLookup(songs, 'sarki');
          for (const entry of lookup.entries) {
            const path = getRepertoirePath(entry.item, lookup.slugById);
            repertoireChildren.push({
              path,
              label: entry.item.title?.trim() || getLastPageLabel(path),
              parentPath: '/repertuvar',
              hasChildren: false,
            });
          }
        }

        const assignmentChildren: InternalPageOption[] = [];
        if (!assignmentsRes.error) {
          const assignments = (assignmentsRes.data ?? []) as Array<{ id: string; title: string | null; created_at: string | null }>;
          const lookup = createSlugLookup(assignments, 'odev');
          for (const entry of lookup.entries) {
            const path = getAssignmentPath(entry.item, lookup.slugById);
            assignmentChildren.push({
              path,
              label: entry.item.title?.trim() || getLastPageLabel(path),
              parentPath: '/odevler',
              hasChildren: false,
            });
          }
        }

        setDynamicChildrenByRoot({
          '/profil': PROFILE_CHILD_OPTIONS,
          '/repertuvar': repertoireChildren,
          '/odevler': assignmentChildren,
        });
      } catch {
        if (cancelled) return;
        setDynamicChildrenByRoot((prev) => ({
          '/profil': PROFILE_CHILD_OPTIONS,
          '/repertuvar': prev['/repertuvar'] ?? [],
          '/odevler': prev['/odevler'] ?? [],
        }));
      }
    };

    void loadDynamicPages();
    return () => {
      cancelled = true;
    };
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        bold: false,
        italic: false,
        strike: false,
      }),
      CustomBold,
      CustomItalic,
      CustomStrike,
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: {
          class: 'text-[var(--color-accent)] underline underline-offset-2',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
        validate: (href) => !!sanitizeUrl(href),
      }),
      Image.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: {
          class: 'max-w-full rounded-[var(--radius-panel)] border border-[var(--color-border)] my-4 object-cover max-h-[60vh] bg-[var(--color-surface-solid)]',
        },
      }),
      Placeholder.configure({
        placeholder: '',
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class:
          'prose max-w-none focus:outline-none min-h-[60px] text-[15px] sm:text-[16px] leading-[1.3] prose-p:my-0.5 text-[var(--color-text-high)] opacity-90 [--tw-prose-body:var(--color-text-high)] [--tw-prose-headings:var(--color-text-high)] [--tw-prose-links:var(--color-accent)] [--tw-prose-bold:var(--color-text-high)] [--tw-prose-bullets:var(--color-text-medium)] [--tw-prose-quotes:var(--color-text-high)] [--tw-prose-code:var(--color-text-high)] [--tw-prose-hr:var(--color-border)]',
      },
    },
    immediatelyRender: false,
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    if (content !== currentHtml && content !== '<p></p>') {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const applyInternalPageToken = useCallback(
    (instance: Editor, page: InternalPageOption, from: number, to: number) => {
      const tokenLabel = page.label;
      const endPos = from + tokenLabel.length + 1;

      isApplyingSlashTokenRef.current = true;
      instance
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .insertContent([
          {
            type: 'text',
            text: tokenLabel,
            marks: [
              { type: 'bold' },
              { type: 'link', attrs: { href: page.path } },
            ],
          },
          { type: 'text', text: ' ' },
        ])
        .setTextSelection(endPos)
        .unsetLink()
        .run();

      setPendingLink(null);
      setSlashMenu(null);
      requestAnimationFrame(() => {
        isApplyingSlashTokenRef.current = false;
      });
    },
    [],
  );

  const refreshPendingLink = useCallback((instance: Editor) => {
    const candidate = findLinkMarkCandidate(instance) ?? findTypedUrlCandidate(instance);

    if (!candidate || isInternalPath(candidate.url)) {
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

  const refreshSlashMenu = useCallback(
    (instance: Editor) => {
      if (isApplyingSlashTokenRef.current) {
        setSlashMenu(null);
        return;
      }

      const candidate = findSlashTokenCandidate(instance);
      if (!candidate) {
        setSlashMenu(null);
        return;
      }

      const next = resolveSlashSuggestions(candidate.text, ROOT_PAGE_OPTIONS, childrenByRoot);
      if (!next) {
        setSlashMenu(null);
        return;
      }

      setSlashMenu({
        ...candidate,
        contextRoot: next.contextRoot,
        items: next.items,
      });
    },
    [childrenByRoot],
  );

  const maybeAutoConvertTrailingSlashLink = useCallback(
    (instance: Editor) => {
      if (isApplyingSlashTokenRef.current) return false;

      const candidate = findSpaceTerminatedSlashCandidate(instance);
      if (!candidate) return false;

      const normalizedPath = normalizeInternalPath(candidate.text);
      if (!normalizedPath) return false;

      const page = internalPathMapRef.current.get(normalizedPath);
      if (!page) return false;

      applyInternalPageToken(instance, page, candidate.from, candidate.to);
      return true;
    },
    [applyInternalPageToken],
  );

  useEffect(() => {
    if (!editor) return;

    refreshPendingLink(editor);
    refreshSlashMenu(editor);

    const onUpdate = () => {
      if (maybeAutoConvertTrailingSlashLink(editor)) {
        return;
      }
      refreshPendingLink(editor);
      refreshSlashMenu(editor);
    };

    const onSelectionUpdate = () => {
      refreshPendingLink(editor);
      refreshSlashMenu(editor);
    };

    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelectionUpdate);
    return () => {
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelectionUpdate);
    };
  }, [editor, maybeAutoConvertTrailingSlashLink, refreshPendingLink, refreshSlashMenu]);

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

  const handleSlashOptionClick = useCallback(
    (page: InternalPageOption) => {
      if (!editor || !slashMenu) return;

      if (page.parentPath === null && page.hasChildren) {
        const nextQuery = `${page.path}/`;
        const nextPos = slashMenu.from + nextQuery.length;
        editor
          .chain()
          .focus()
          .setTextSelection({ from: slashMenu.from, to: slashMenu.to })
          .insertContent(nextQuery)
          .setTextSelection(nextPos)
          .run();
        return;
      }

      applyInternalPageToken(editor, page, slashMenu.from, slashMenu.to);
    },
    [applyInternalPageToken, editor, slashMenu],
  );

  const updateSlashMenuLayout = useCallback(() => {
    if (!editor || !slashMenu) {
      setSlashMenuLayout(null);
      return;
    }

    const viewportPadding = 12;
    const anchorGap = 8;
    const minMenuHeight = 120;
    const maxAvailableWidth = Math.max(180, window.innerWidth - viewportPadding * 2);
    const menuWidth = Math.min(320, maxAvailableWidth);
    const menuHeight = slashMenuRef.current?.offsetHeight ?? minMenuHeight;

    let coords: { top: number; bottom: number; left: number };
    try {
      coords = editor.view.coordsAtPos(slashMenu.to);
    } catch {
      setSlashMenuLayout(null);
      return;
    }

    const spaceBelow = window.innerHeight - coords.bottom - viewportPadding - anchorGap;
    const spaceAbove = coords.top - viewportPadding - anchorGap;
    const placeBelow = spaceBelow >= minMenuHeight || spaceBelow >= spaceAbove;

    const maxHeight = Math.max(
      minMenuHeight,
      placeBelow ? spaceBelow : spaceAbove,
    );

    const effectiveHeight = Math.min(menuHeight, maxHeight);
    const rawTop = placeBelow
      ? coords.bottom + anchorGap
      : coords.top - anchorGap - effectiveHeight;
    const top = clamp(rawTop, viewportPadding, window.innerHeight - effectiveHeight - viewportPadding);
    const left = clamp(
      coords.left - 24,
      viewportPadding,
      window.innerWidth - menuWidth - viewportPadding,
    );
    const listMaxHeight = Math.max(82, maxHeight - 38);

    setSlashMenuLayout((prev) => {
      const next: SlashMenuLayout = {
        left,
        top,
        width: menuWidth,
        maxHeight,
        listMaxHeight,
      };
      if (
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight &&
        prev.listMaxHeight === next.listMaxHeight
      ) {
        return prev;
      }
      return next;
    });
  }, [editor, slashMenu]);

  useEffect(() => {
    if (!slashMenu || !editor) {
      setSlashMenuLayout(null);
      return;
    }

    const syncMenuLayout = () => {
      requestAnimationFrame(() => {
        updateSlashMenuLayout();
      });
    };

    syncMenuLayout();
    window.addEventListener('resize', syncMenuLayout);
    window.addEventListener('scroll', syncMenuLayout, true);
    return () => {
      window.removeEventListener('resize', syncMenuLayout);
      window.removeEventListener('scroll', syncMenuLayout, true);
    };
  }, [editor, slashMenu, updateSlashMenuLayout]);

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
      const {
        data: { publicUrl },
      } = supabase.storage.from('announcements-images').getPublicUrl(path);
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
    <div className={`rounded-[var(--radius-panel)] ${borderless ? '' : 'border border-[var(--color-border)]'} bg-[var(--color-surface-solid)] overflow-hidden flex flex-col`}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--color-border)] bg-[var(--color-surface-strong)] px-2 py-1">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1 rounded-[4px] hover:bg-[var(--color-soft-bg-hover)] transition-colors ${editor.isActive('bold') ? 'bg-[var(--color-soft-bg)] text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'}`}
        >
          <Bold size={13} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1 rounded-[4px] hover:bg-[var(--color-soft-bg-hover)] transition-colors ${editor.isActive('italic') ? 'bg-[var(--color-soft-bg)] text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'}`}
        >
          <Italic size={13} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`p-1 rounded-[4px] hover:bg-[var(--color-soft-bg-hover)] transition-colors ${editor.isActive('strike') ? 'bg-[var(--color-soft-bg)] text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'}`}
        >
          <Strikethrough size={13} strokeWidth={2.5} />
        </button>

        <div className="w-px h-3.5 bg-[var(--color-border)] mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1 rounded-[4px] hover:bg-[var(--color-soft-bg-hover)] transition-colors ${editor.isActive('bulletList') ? 'bg-[var(--color-soft-bg)] text-[var(--color-accent)]' : 'text-[var(--color-text-medium)]'}`}
        >
          <List size={13} strokeWidth={2.5} />
        </button>

        <div className="w-px h-3.5 bg-[var(--color-border)] mx-1" />

        <label className="p-1 rounded-[4px] hover:bg-[var(--color-soft-bg-hover)] transition-colors text-[var(--color-text-medium)] cursor-pointer flex items-center justify-center">
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImageUpload(f);
            }}
          />
          {uploading ? <Loader2 size={13} className="animate-spin text-[var(--color-accent)]" /> : <ImageIcon size={13} strokeWidth={2.5} />}
        </label>
      </div>

      {pendingLink && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-2">
          <p className="text-[0.72rem] text-[var(--color-text-medium)] mb-1.5">Link algılandı. Başlık eklemek ister misin?</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={pendingLink.title}
              onChange={(e) => setPendingLink((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
              placeholder="Bağlantı başlığı"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-input-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text-high)] placeholder:text-[var(--color-text-medium)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              onClick={confirmLinkTitle}
              className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-accent)] px-2.5 py-1.5 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#1f170b] transition-opacity hover:opacity-90"
            >
              Onayla
            </button>
          </div>
        </div>
      )}

      <div className="relative p-3">
        {slashMenu && (
          <div
            ref={slashMenuRef}
            className="fixed z-[90] overflow-hidden rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-surface-solid)]/95 shadow-xl backdrop-blur"
            style={{
              left: `${slashMenuLayout?.left ?? 12}px`,
              top: `${slashMenuLayout?.top ?? 12}px`,
              width: `${slashMenuLayout?.width ?? 320}px`,
              maxHeight: `${slashMenuLayout?.maxHeight ?? 220}px`,
            }}
          >
            <div className="border-b border-[var(--color-border)] px-2.5 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-medium)]">
              {slashMenu.contextRoot ? `${slashMenu.contextRoot} alt sayfalar` : 'Sayfa referansı'}
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: `${slashMenuLayout?.listMaxHeight ?? 136}px` }}>
              {slashMenu.items.length === 0 ? (
                <p className="px-2.5 py-3 text-[0.72rem] text-[var(--color-text-medium)]">Eşleşen sayfa bulunamadı.</p>
              ) : (
                slashMenu.items.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSlashOptionClick(item)}
                    className="flex h-10 w-full items-center gap-2.5 px-2.5 text-left transition-colors hover:bg-[var(--color-soft-bg-hover)]"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-[var(--color-border)] bg-[var(--color-soft-bg)] text-[var(--color-accent)]">
                      <NextImage src="/icons/dosya.png" alt="" width={12} height={12} className="h-3 w-3 object-contain" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.74rem] font-normal text-[var(--color-text-high)]">{item.label}</span>
                      <span className="block truncate text-[0.64rem] text-[var(--color-text-medium)]">{item.path}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
