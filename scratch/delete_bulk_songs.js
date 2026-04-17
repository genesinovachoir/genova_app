// zartzurt dışındaki tüm repertoire kayıtlarını sil
// ve repertoire_tags migration'ını çalıştır

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://hievmwwctjjlhmssoxsu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpZXZtd3djdGpqbGhtc3NveHN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMDc3NTIsImV4cCI6MjA4NjY4Mzc1Mn0.4GQLx3_rMYJzsvIW8GfzeJdaNxVtz_NE-aSuYX7qGno'
);

async function main() {
  // Önce tüm şarkıları listele
  const { data: allSongs, error: listErr } = await supabase
    .from('repertoire')
    .select('id, title');

  if (listErr) {
    console.error('Liste alınamadı:', listErr.message);
    process.exit(1);
  }

  console.log('Mevcut şarkılar:');
  allSongs.forEach(s => console.log(` - [${s.id}] ${s.title}`));

  // zartzurt'u bul (title içinde case-insensitive)
  const zartzurt = allSongs.find(s => s.title.toLowerCase().includes('zartzurt'));
  if (!zartzurt) {
    console.warn('\n⚠️  "zartzurt" adlı şarkı bulunamadı! Hiçbir şey silinmedi.');
    process.exit(0);
  }

  console.log(`\n✅ Korunacak: [${zartzurt.id}] ${zartzurt.title}`);

  // zartzurt dışındakileri sil
  const toDelete = allSongs.filter(s => s.id !== zartzurt.id);
  if (toDelete.length === 0) {
    console.log('Silinecek başka şarkı yok.');
    process.exit(0);
  }

  const idsToDelete = toDelete.map(s => s.id);
  console.log(`\n🗑️  Silinecek (${idsToDelete.length} adet):`);
  toDelete.forEach(s => console.log(` - ${s.title}`));

  // repertoire_files önce silinir (cascade yoksa)
  const { error: filesErr } = await supabase
    .from('repertoire_files')
    .delete()
    .in('song_id', idsToDelete);

  if (filesErr) {
    console.warn('Dosyalar silinirken hata (devam ediliyor):', filesErr.message);
  }

  const { error: delErr } = await supabase
    .from('repertoire')
    .delete()
    .in('id', idsToDelete);

  if (delErr) {
    console.error('Silme başarısız:', delErr.message);
    process.exit(1);
  }

  console.log('\n✅ Silme tamamlandı. Sadece zartzurt kaldı.');
}

main();
