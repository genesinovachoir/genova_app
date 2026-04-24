require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const testEmail = process.env.TEST_USER_EMAIL;
const testPassword = process.env.TEST_USER_PASSWORD;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  if (!testEmail || !testPassword) {
    console.error('TEST_USER_EMAIL ve TEST_USER_PASSWORD ortam değişkenlerini ayarlayın.');
    return;
  }

  // Gerçek kullanıcıyla giriş yap (read policies maybe require auth)
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  const { data, error } = await supabase
    .from('choir_members')
    .select('*')
    .ilike('first_name', '%abdu%');
  
  console.log(JSON.stringify(data, null, 2));
  console.error(error);
}
run();
