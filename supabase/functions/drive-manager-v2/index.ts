// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const jsonHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json',
};

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get('DRIVE_CLIENT_ID')!;
  const clientSecret = Deno.env.get('DRIVE_CLIENT_SECRET')!;
  const refreshToken = Deno.env.get('DRIVE_REFRESH_TOKEN')!;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`OAuth2 token hatası: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const STORAGE_LINK_PREFIX = 'storage://';

async function createFolder(token: string, name: string, parentId: string) {
  const res = await fetch(DRIVE_FILES_API + '?fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  if (!res.ok) throw new Error(`Klasör oluşturma hatası: ${await res.text()}`);
  return res.json();
}

async function uploadFileMultipart(token: string, fileData: Uint8Array, metadata: any) {
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const metaPart = `${delimiter}Content-Type: application/json\r\n\r\n${JSON.stringify(metadata)}`;
  const dataPart = `${delimiter}Content-Type: ${metadata.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
  const metaBytes = new TextEncoder().encode(metaPart);
  const dataHeaderBytes = new TextEncoder().encode(dataPart);
  const base64Bytes = new TextEncoder().encode(uint8ArrayToBase64(fileData));
  const closeBytes = new TextEncoder().encode(closeDelimiter);
  const body = new Uint8Array(metaBytes.length + dataHeaderBytes.length + base64Bytes.length + closeBytes.length);
  let offset = 0;
  body.set(metaBytes, offset); offset += metaBytes.length;
  body.set(dataHeaderBytes, offset); offset += dataHeaderBytes.length;
  body.set(base64Bytes, offset); offset += base64Bytes.length;
  body.set(closeBytes, offset);
  const res = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,webViewLink,webContentLink,size`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
    body,
  });
  if (!res.ok) throw new Error(`Dosya yükleme hatası: ${await res.text()}`);
  return res.json();
}

async function setFilePublicReadable(token: string, fileId: string) {
  await fetch(`${DRIVE_FILES_API}/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_').trim();
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = encodeURIComponent(`name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(`${DRIVE_FILES_API}?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;
  const folder = await createFolder(token, name, parentId);
  return folder.id;
}

function parseStorageLocation(rawValue: string | null | undefined): { bucket: string; path: string } | null {
  if (!rawValue || !rawValue.startsWith(STORAGE_LINK_PREFIX)) {
    return null;
  }

  const withoutPrefix = rawValue.slice(STORAGE_LINK_PREFIX.length);
  const firstSlash = withoutPrefix.indexOf('/');
  if (firstSlash <= 0 || firstSlash === withoutPrefix.length - 1) {
    return null;
  }

  const bucket = withoutPrefix.slice(0, firstSlash);
  const path = withoutPrefix.slice(firstSlash + 1);
  if (!bucket || !path) {
    return null;
  }

  return { bucket, path };
}

async function upsertAssignmentSubmission(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  token: string;
  assignmentId: string;
  memberId: string;
  memberFirstName: string;
  memberLastName: string;
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
  submissionNote?: string | null;
}) {
  const {
    supabaseAdmin,
    token,
    assignmentId,
    memberId,
    memberFirstName,
    memberLastName,
    fileName,
    mimeType,
    fileBytes,
    submissionNote,
  } = params;

  const { data: assignment } = await supabaseAdmin
    .from('assignments')
    .select('drive_folder_id')
    .eq('id', assignmentId)
    .single();
  if (!assignment?.drive_folder_id) {
    throw new Error('Ödev klasörü bulunamadı');
  }

  const memberFolderId = await findOrCreateFolder(token, `${memberFirstName}_${memberLastName}`, assignment.drive_folder_id);
  const { data: oldSub } = await supabaseAdmin
    .from('assignment_submissions')
    .select('drive_file_id')
    .eq('assignment_id', assignmentId)
    .eq('member_id', memberId)
    .maybeSingle();

  if (oldSub?.drive_file_id && !String(oldSub.drive_file_id).startsWith('sb_')) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${oldSub.drive_file_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  const uploaded = await uploadFileMultipart(token, fileBytes, { name: fileName, mimeType, parents: [memberFolderId] });
  const uploadedSize = Number.parseInt(String(uploaded.size ?? ''), 10);
  const uploadedAt = new Date().toISOString();
  const { data: sub } = await supabaseAdmin
    .from('assignment_submissions')
    .upsert({
      assignment_id: assignmentId,
      member_id: memberId,
      drive_file_id: uploaded.id,
      drive_web_view_link: uploaded.webViewLink,
      drive_download_link: uploaded.webContentLink ?? null,
      file_name: fileName,
      mime_type: mimeType,
      file_size_bytes: Number.isFinite(uploadedSize) ? uploadedSize : null,
      drive_member_folder_id: memberFolderId,
      submitted_at: uploadedAt,
      updated_at: uploadedAt,
      status: 'pending',
      reviewer_note: null,
      approved_at: null,
      approved_by: null,
      submission_note: submissionNote ?? null,
    }, { onConflict: 'assignment_id,member_id' })
    .select()
    .single();

  if (!sub) {
    throw new Error('Submission kaydedilemedi');
  }

  return sub;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Yetkilendirme eksik' }), { status: 401, headers: jsonHeaders });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Geçersiz oturum' }), { status: 401, headers: jsonHeaders });

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: member } = await supabaseAdmin.from('choir_members').select('id, first_name, last_name, voice_group, choir_member_roles(roles(name))').eq('auth_user_id', user.id).maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: 'Üye kaydı bulunamadı' }), { status: 403, headers: jsonHeaders });
    const roles = (member.choir_member_roles as any[]).map(r => r.roles?.name);
    const userRole = roles.includes('Şef') ? 'Şef' : roles.includes('Partisyon Şefi') ? 'Partisyon Şefi' : 'Korist';

    const body = await req.json();
    const { action } = body;
    const rootFolderId = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')!;
    const token = await getAccessToken();

    switch (action) {
      case 'init_song_folder': {
        if (userRole !== 'Şef') throw new Error('Yetkisiz');
        const { song_title, song_id } = body;
        const repertuvarId = await findOrCreateFolder(token, 'Repertuvar', rootFolderId);
        const folder = await createFolder(token, sanitizeFolderName(song_title), repertuvarId);
        await supabaseAdmin.from('repertoire').update({ drive_folder_id: folder.id }).eq('id', song_id);
        return new Response(JSON.stringify({ folder_id: folder.id, web_view_link: folder.webViewLink }), { headers: jsonHeaders });
      }
      case 'upload_song_file': {
        if (userRole !== 'Şef') throw new Error('Yetkisiz');
        const { song_id, drive_folder_id, file_name, mime_type, file_data_base64, file_type, partition_label } = body;
        const fileBytes = Uint8Array.from(atob(file_data_base64), c => c.charCodeAt(0));
        const uploaded = await uploadFileMultipart(token, fileBytes, { name: file_name, mimeType: mime_type, parents: [drive_folder_id] });
        await setFilePublicReadable(token, uploaded.id);
        const { data: fileRecord } = await supabaseAdmin.from('repertoire_files').insert({
          song_id, file_name, file_type, partition_label, drive_file_id: uploaded.id,
          drive_web_view_link: uploaded.webViewLink, mime_type, file_size_bytes: parseInt(uploaded.size),
          uploaded_by: member.id
        }).select().single();
        return new Response(JSON.stringify({ file: fileRecord }), { headers: jsonHeaders });
      }
      case 'init_assignment_folder': {
        if (!['Şef', 'Partisyon Şefi'].includes(userRole)) throw new Error('Yetkisiz');
        const { assignment_id, assignment_title } = body;
        const odevlerId = await findOrCreateFolder(token, 'Ödevler', rootFolderId);
        const creatorId = await findOrCreateFolder(token, `${member.first_name}_${member.last_name}`, odevlerId);
        const folder = await createFolder(token, sanitizeFolderName(assignment_title), creatorId);
        await supabaseAdmin.from('assignments').update({ drive_folder_id: folder.id }).eq('id', assignment_id);
        return new Response(JSON.stringify({ folder_id: folder.id }), { headers: jsonHeaders });
      }
      case 'upload_submission': {
        const { assignment_id, file_name, mime_type, file_data_base64, submission_note } = body;
        if (!assignment_id || !file_name || !file_data_base64) {
          throw new Error('Eksik submission verisi');
        }

        const mimeType = typeof mime_type === 'string' && mime_type.length > 0
          ? mime_type
          : 'application/octet-stream';
        const fileBytes = Uint8Array.from(atob(file_data_base64), c => c.charCodeAt(0));
        const sub = await upsertAssignmentSubmission({
          supabaseAdmin,
          token,
          assignmentId: assignment_id,
          memberId: member.id,
          memberFirstName: member.first_name,
          memberLastName: member.last_name,
          fileName: file_name,
          mimeType,
          fileBytes,
          submissionNote: submission_note ?? null,
        });
        return new Response(JSON.stringify({ submission: sub }), { headers: jsonHeaders });
      }
      case 'upload_submission_from_storage': {
        const {
          assignment_id,
          storage_bucket,
          storage_path,
          file_name,
          mime_type,
          submission_note,
        } = body;

        if (!assignment_id || !storage_bucket || !storage_path || !file_name) {
          throw new Error('Eksik storage submission verisi');
        }

        const mimeType = typeof mime_type === 'string' && mime_type.length > 0
          ? mime_type
          : 'application/octet-stream';

        const { data: storageFile, error: storageDownloadError } = await supabaseAdmin.storage
          .from(storage_bucket)
          .download(storage_path);
        if (storageDownloadError || !storageFile) {
          throw new Error(storageDownloadError?.message || 'Storage dosyası indirilemedi');
        }

        const fileBytes = new Uint8Array(await storageFile.arrayBuffer());
        const sub = await upsertAssignmentSubmission({
          supabaseAdmin,
          token,
          assignmentId: assignment_id,
          memberId: member.id,
          memberFirstName: member.first_name,
          memberLastName: member.last_name,
          fileName: file_name,
          mimeType,
          fileBytes,
          submissionNote: submission_note ?? null,
        });
        return new Response(JSON.stringify({ submission: sub }), { headers: jsonHeaders });
      }
      case 'migrate_submission_from_storage': {
        if (userRole !== 'Şef') {
          throw new Error('Yetkisiz');
        }

        const { submission_id, assignment_id, storage_bucket, storage_path, file_name, mime_type, submission_note } = body;
        if (!submission_id) {
          throw new Error('submission_id zorunlu');
        }

        const { data: existingSubmission } = await supabaseAdmin
          .from('assignment_submissions')
          .select('id, assignment_id, member_id, file_name, mime_type, submission_note, drive_download_link')
          .eq('id', submission_id)
          .single();
        if (!existingSubmission) {
          throw new Error('Submission kaydı bulunamadı');
        }

        const assignmentId = assignment_id ?? existingSubmission.assignment_id;
        const fileName = file_name ?? existingSubmission.file_name;
        const mimeType = typeof (mime_type ?? existingSubmission.mime_type) === 'string' && (mime_type ?? existingSubmission.mime_type)
          ? (mime_type ?? existingSubmission.mime_type)
          : 'application/octet-stream';
        const submissionNote = submission_note ?? existingSubmission.submission_note ?? null;

        const storageLocation = (
          storage_bucket && storage_path
            ? { bucket: storage_bucket, path: storage_path }
            : parseStorageLocation(existingSubmission.drive_download_link)
        );
        if (!storageLocation) {
          throw new Error('Storage yolu bulunamadı');
        }

        const { data: targetMember } = await supabaseAdmin
          .from('choir_members')
          .select('id, first_name, last_name')
          .eq('id', existingSubmission.member_id)
          .single();
        if (!targetMember) {
          throw new Error('Korist bulunamadı');
        }

        const { data: storageFile, error: storageDownloadError } = await supabaseAdmin.storage
          .from(storageLocation.bucket)
          .download(storageLocation.path);
        if (storageDownloadError || !storageFile) {
          throw new Error(storageDownloadError?.message || 'Storage dosyası indirilemedi');
        }

        const fileBytes = new Uint8Array(await storageFile.arrayBuffer());
        const sub = await upsertAssignmentSubmission({
          supabaseAdmin,
          token,
          assignmentId,
          memberId: targetMember.id,
          memberFirstName: targetMember.first_name,
          memberLastName: targetMember.last_name,
          fileName,
          mimeType,
          fileBytes,
          submissionNote,
        });

        return new Response(JSON.stringify({ submission: sub }), { headers: jsonHeaders });
      }
      case 'delete_file': {
        if (userRole !== 'Şef') throw new Error('Yetkisiz');
        const { drive_file_id, repertoire_file_id } = body;
        await fetch(`https://www.googleapis.com/drive/v3/files/${drive_file_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        if (repertoire_file_id) await supabaseAdmin.from('repertoire_files').delete().eq('id', repertoire_file_id);
        return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
      }
      case 'list_files': {
        const { folder_id } = body;
        const q = encodeURIComponent(`'${folder_id}' in parents and trashed = false`);
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink,webContentLink,size)`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        return new Response(JSON.stringify({ files: data.files ?? [] }), { headers: jsonHeaders });
      }
      default: return new Response(JSON.stringify({ error: 'Gecersiz action' }), { status: 400, headers: jsonHeaders });
    }
  } catch (err) { return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders }); }
});
