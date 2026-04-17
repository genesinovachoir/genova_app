require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// We try to find the user via anon key since no service role is explicitly visible, but maybe anon is enough. 
// If RLS prevents it, let's login using alidiyarduran35@gmail.com
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // Gerçek kullanıcıyla giriş yap (read policies maybe require auth)
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'alidiyarduran35@gmail.com',
    password: 'alidiyar123'
  });

  const { data, error } = await supabase
    .from('choir_members')
    .select('*')
    .ilike('first_name', '%abdu%');
  
  console.log(JSON.stringify(data, null, 2));
  console.error(error);
}
run();
