require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  // Gerçek kullanıcıyla giriş yap
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'alidiyarduran35@gmail.com',
    password: 'alidiyar123'
  });

  if (signInError) {
    console.error("Giriş hatası:", signInError.message);
    return;
  }

  console.log("✅ Giriş başarılı! User ID:", signInData.user.id);

  // Kendi profilini çek
  const { data, error } = await supabase
    .from('choir_members')
    .select('*')
    .eq('auth_user_id', signInData.user.id)
    .maybeSingle();

  if (error) {
    console.error("Profil çekme hatası:", error.message);
    return;
  }

  if (!data) {
    console.log("❌ auth_user_id ile eşleşen kayıt bulunamadı!");
    
    // Tüm choir_members'ı çek (email ile eşleştir)
    const { data: allMembers } = await supabase.from('choir_members').select('id, first_name, last_name, email, auth_user_id').limit(10);
    console.log("\nTüm kayıtlar (ilk 10):");
    console.log(JSON.stringify(allMembers, null, 2));
    return;
  }

  console.log("\n=== MEVCUT SÜTUNLAR ===");
  console.log(Object.keys(data).join(', '));
  console.log("\n=== SENİN PROFİL VERİLERİN ===");
  console.log(JSON.stringify(data, null, 2));
}

check();
