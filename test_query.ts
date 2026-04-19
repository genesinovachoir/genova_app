import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

async function run() {
  const { data, error } = await supabase
    .from('assignment_submissions')
    .select(`
      id,
      reviewer:choir_members!assignment_submissions_approved_by_fkey(first_name, photo_url)
    `)
    .limit(1);
    
  console.log(data, error);
}
run();
