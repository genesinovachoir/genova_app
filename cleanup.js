const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));

const SUPABASE_URL = envConfig.NEXT_PUBLIC_SUPABASE_URL || 'https://hievmwwctjjlhmssoxsu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('Fetching active photo URLs from choir_members...');
  const { data: members, error: membersError } = await supabase
    .from('choir_members')
    .select('photo_url')
    .not('photo_url', 'is', null);

  if (membersError) {
    console.error('Error fetching members:', membersError);
    return;
  }

  const activePhotoUrls = new Set(members.map((m) => m.photo_url));
  console.log(`Found ${activePhotoUrls.size} active photo URLs in database.`);

  console.log('Listing folders in chorister-profiles/public/...');
  const { data: folders, error: foldersError } = await supabase.storage
    .from('chorister-profiles')
    .list('public', { limit: 1000 });

  if (foldersError) {
    console.error('Error listing folders:', foldersError);
    return;
  }

  let unusedFilesToDelete = [];

  for (const folder of folders || []) {
    if (folder.name === '.emptyFolderPlaceholder') continue;
    
    // Check if it's a directory (usually indicated by having no metadata or just being a folder)
    const { data: files, error: filesError } = await supabase.storage
      .from('chorister-profiles')
      .list(`public/${folder.name}`, { limit: 1000 });

    if (filesError) {
      console.error(`Error listing files in public/${folder.name}:`, filesError);
      continue;
    }

    // It's possible the 'folder' itself is a file (e.g. sakina_huseynli.webp is inside public directly)
    if (files.length === 0 || files[0].name === '.emptyFolderPlaceholder') {
      const filePath = `public/${folder.name}`;
      const fullUrl = `${SUPABASE_URL}/storage/v1/object/public/chorister-profiles/${filePath}`;
      if (!activePhotoUrls.has(fullUrl)) {
        console.log(`Unused file found (direct in public): ${filePath}`);
        unusedFilesToDelete.push(filePath);
      } else {
        console.log(`Active file kept (direct in public): ${filePath}`);
      }
      continue;
    }

    for (const file of files || []) {
      if (file.name === '.emptyFolderPlaceholder') continue;
      
      const filePath = `public/${folder.name}/${file.name}`;
      const fullUrl = `${SUPABASE_URL}/storage/v1/object/public/chorister-profiles/${filePath}`;
      
      if (!activePhotoUrls.has(fullUrl)) {
        console.log(`Unused file found: ${filePath}`);
        unusedFilesToDelete.push(filePath);
      } else {
        console.log(`Active file kept: ${filePath}`);
      }
    }
  }

  // Also check root for files (outside public folder) just in case
  const { data: rootFiles, error: rootFilesError } = await supabase.storage
    .from('chorister-profiles')
    .list('', { limit: 1000 });

  if (rootFilesError) {
    console.error('Error listing root files:', rootFilesError);
  } else {
    for (const file of rootFiles || []) {
      if (file.name === '.emptyFolderPlaceholder' || file.name === 'public') continue;
      
      const filePath = file.name;
      const fullUrl = `${SUPABASE_URL}/storage/v1/object/public/chorister-profiles/${filePath}`;
      
      if (!activePhotoUrls.has(fullUrl)) {
        console.log(`Unused file found (root): ${filePath}`);
        unusedFilesToDelete.push(filePath);
      } else {
        console.log(`Active file kept (root): ${filePath}`);
      }
    }
  }

  console.log(`Total unused files to delete: ${unusedFilesToDelete.length}`);

  if (unusedFilesToDelete.length > 0) {
    console.log('Deleting unused files...');
    const { data, error } = await supabase.storage
      .from('chorister-profiles')
      .remove(unusedFilesToDelete);

    if (error) {
      console.error('Error deleting files:', error);
    } else {
      console.log('Successfully deleted files:', data?.map((f) => f.name));
    }
  } else {
    console.log('No unused files to delete.');
  }
}

run();
