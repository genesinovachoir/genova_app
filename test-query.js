const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  const { data, error } = await supabase
    .from('choir_members')
    .select('id, favorite_song_id, repertoire:favorite_song_id(title, composer)')
    .not('favorite_song_id', 'is', null)
    .limit(1);
    
  console.log('Result:', JSON.stringify({ data, error }, null, 2));
}

test();
