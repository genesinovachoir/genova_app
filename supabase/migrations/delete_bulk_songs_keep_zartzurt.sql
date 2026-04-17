-- ============================================================
-- zartzurt dışındaki TÜM şarkıları sil
-- Supabase Dashboard > SQL Editor'da çalıştır
-- ============================================================

-- Önce hangi kayıtlar silineceğini gör:
SELECT id, title FROM repertoire WHERE lower(title) NOT LIKE '%zartzurt%';

-- Dosyaları sil (cascade yoksa elle sil):
DELETE FROM repertoire_files
WHERE song_id IN (
  SELECT id FROM repertoire WHERE lower(title) NOT LIKE '%zartzurt%'
);

-- Korist atamalarını sil:
DELETE FROM song_assignments
WHERE song_id IN (
  SELECT id FROM repertoire WHERE lower(title) NOT LIKE '%zartzurt%'
);

-- Ana kayıtları sil:
DELETE FROM repertoire
WHERE lower(title) NOT LIKE '%zartzurt%';

-- Kontrol:
SELECT id, title FROM repertoire;
