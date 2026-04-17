import { supabase, RepertoirePdfAnnotationRow } from '@/lib/supabase';
import {
  AnnotationItem,
  AnnotationLayerKey,
  AnnotationLayerType,
  VoiceGroup,
  cloneAnnotationItems,
  makeLayerPageKey,
  parseLayerKey,
} from '@/lib/repertuvar/annotation-types';

interface SaveLayerSnapshotInput {
  songId: string;
  repertoireFileId: string;
  pageNumber: number;
  layerKey: AnnotationLayerKey;
  annotations: AnnotationItem[];
  memberId: string;
}

const MISSING_ANNOTATIONS_TABLE_MESSAGE =
  'PDF notları tablosu Supabase veritabanında kurulu değil. Notları kaydetmek için supabase/migrations/20260416_repertoire_pdf_annotations.sql migration dosyasını remote projeye uygulayın.';

let annotationsTableMissing = false;

function isAnnotationItemArray(value: unknown): value is AnnotationItem[] {
  return Array.isArray(value);
}

function isMissingAnnotationsTableError(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === 'PGRST205' ||
        error.message?.includes("Could not find the table 'public.repertoire_pdf_annotations'") ||
        error.message?.includes("Could not find the table 'repertoire_pdf_annotations'")),
  );
}

function isRowLevelSecurityError(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === '42501' ||
        error.message?.toLowerCase().includes('row-level security policy')),
  );
}

function getAnnotationErrorMessage(error: { code?: string; message?: string } | null) {
  if (isMissingAnnotationsTableError(error)) {
    annotationsTableMissing = true;
    return MISSING_ANNOTATIONS_TABLE_MESSAGE;
  }

  if (isRowLevelSecurityError(error)) {
    return 'Bu PDF not katmanına kaydetme izni alınamadı. Supabase RLS policy güncellemesini uygulayın ve doğru kullanıcıyla giriş yaptığınızdan emin olun.';
  }

  return error?.message || 'PDF notu kaydedilemedi.';
}

function rowToLayerKey(row: RepertoirePdfAnnotationRow): AnnotationLayerKey {
  if (row.layer_type === 'personal') {
    return 'personal';
  }

  if (row.layer_type === 'shared_all') {
    return 'shared_all';
  }

  return `shared_voice_group:${row.target_voice_group as VoiceGroup}`;
}

function applyLayerFilters(
  query: any,
  layerType: AnnotationLayerType,
  targetVoiceGroup: VoiceGroup | null,
  memberId: string,
) {
  query.eq('layer_type', layerType);

  if (layerType === 'personal') {
    query.eq('owner_member_id', memberId);
    query.is('target_voice_group', null);
    return query;
  }

  query.is('owner_member_id', null);

  if (layerType === 'shared_voice_group') {
    query.eq('target_voice_group', targetVoiceGroup);
    return query;
  }

  query.is('target_voice_group', null);
  return query;
}

export async function loadAnnotationsForFile(repertoireFileId: string): Promise<Record<string, AnnotationItem[]>> {
  if (annotationsTableMissing) {
    throw new Error(MISSING_ANNOTATIONS_TABLE_MESSAGE);
  }

  const { data, error } = await supabase
    .from('repertoire_pdf_annotations')
    .select(`
      id,
      song_id,
      repertoire_file_id,
      page_number,
      layer_type,
      owner_member_id,
      target_voice_group,
      annotations_json,
      schema_version,
      created_by,
      updated_by,
      created_at,
      updated_at
    `)
    .eq('repertoire_file_id', repertoireFileId)
    .order('page_number', { ascending: true })
    .order('updated_at', { ascending: true });

  if (error) {
    throw new Error(getAnnotationErrorMessage(error));
  }

  const layerMap: Record<string, AnnotationItem[]> = {};

  (data as RepertoirePdfAnnotationRow[] | null | undefined)?.forEach((row) => {
    const layerKey = rowToLayerKey(row);
    const layerPageKey = makeLayerPageKey({
      fileId: row.repertoire_file_id,
      pageNumber: row.page_number,
      layerKey,
    });

    layerMap[layerPageKey] = isAnnotationItemArray(row.annotations_json)
      ? cloneAnnotationItems(row.annotations_json)
      : [];
  });

  return layerMap;
}

export async function saveLayerSnapshot({
  songId,
  repertoireFileId,
  pageNumber,
  layerKey,
  annotations,
  memberId,
}: SaveLayerSnapshotInput): Promise<void> {
  if (annotationsTableMissing) {
    throw new Error(MISSING_ANNOTATIONS_TABLE_MESSAGE);
  }

  const { layerType, targetVoiceGroup } = parseLayerKey(layerKey);
  const baseQuery = supabase
    .from('repertoire_pdf_annotations')
    .select('id')
    .eq('repertoire_file_id', repertoireFileId)
    .eq('page_number', pageNumber);

  const filteredQuery = applyLayerFilters(baseQuery, layerType, targetVoiceGroup, memberId);
  const { data: existingRow, error: existingError } = await filteredQuery.maybeSingle();

  if (existingError) {
    throw new Error(getAnnotationErrorMessage(existingError));
  }

  if (annotations.length === 0) {
    if (existingRow?.id) {
      const { error: deleteError } = await supabase
        .from('repertoire_pdf_annotations')
        .delete()
        .eq('id', existingRow.id);

      if (deleteError) {
        throw new Error(getAnnotationErrorMessage(deleteError));
      }
    }

    return;
  }

  const payload = {
    song_id: songId,
    repertoire_file_id: repertoireFileId,
    page_number: pageNumber,
    layer_type: layerType,
    owner_member_id: layerType === 'personal' ? memberId : null,
    target_voice_group: layerType === 'shared_voice_group' ? targetVoiceGroup : null,
    annotations_json: cloneAnnotationItems(annotations),
    schema_version: 1,
  };

  if (existingRow?.id) {
    const { error: updateError } = await supabase
      .from('repertoire_pdf_annotations')
      .update(payload)
      .eq('id', existingRow.id);

    if (updateError) {
      throw new Error(getAnnotationErrorMessage(updateError));
    }

    return;
  }

  const { error: insertError } = await supabase
    .from('repertoire_pdf_annotations')
    .insert(payload);

  if (insertError) {
    throw new Error(getAnnotationErrorMessage(insertError));
  }
}
