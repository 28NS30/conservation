-- A refresh of our copy of TaiCOL, made safe before it is applied.
--
-- Our copy of TaiCOL was taken before its 12 August 2026 update. A snapshot of
-- 29 September 2026 (136,680 taxa; ours has 125,438) brings 175 corrected
-- scientific names, 288 Chinese names, 55 changes of status and 33 of rank,
-- among them 20 names that hold records (珠頸斑鳩 Spilopelia → Streptopelia,
-- 326 records; 黃頭鷺 raised to the species Ardea coromanda), 藍喉太陽鳥 no
-- longer invasive, and 11,242 taxa we did not have.
--
-- It would also weaken 37 ratings. The roadmap's rule for a refresh: any
-- rating that would get weaker is held at the old level until the owner
-- decides. Four are held already, by 0014's floors (黃魚鴞, 熊鷹, 黃鸝 at 50 km
-- and 花翅山椒鳥 at 10 km). The other 33, all plants and none with a record,
-- get floors here, before the refresh is applied, and so do three rows the
-- refresh itself adds or leaves unrated beside a rated retired twin (酒紅朱雀 and
-- two orchids): 31 orchids and ferns whose
-- 輕度 rating TaiCOL withdrew, and two plants that lose a Red List category.
-- Reasons are in scripts/taxa-overrides.csv. Floors only ever tighten (0014).
--
-- And one column. TaiCOL gives a single alien_type for Taiwan, Kinmen and
-- Matsu together, and says the rest in alien_status_note ("臺灣: 引進種" for a
-- bird native to the islands and introduced on the main island). The import
-- threw it away; from here it keeps it.
--
-- The refresh itself is data, not schema: scripts/import-taicol.ts --from the
-- snapshot locally, and scripts/taicol-sql.ts for production.

set local lock_timeout = '5s';

alter table taxa add column if not exists alien_status_note text;

insert into taxon_precision_floors (taicol_id, min_precision, reason) values
  ('t0026879', 'coarse_10km',
   '革舌蕨 Scleroglossum sulcatum. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating and its Red List category NVU. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0049257', 'coarse_10km',
   '臺灣凡尼蘭 Vanilla somae. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0052603', 'coarse_10km',
   '圓瓣無葉蘭 Aphyllorchis simplex. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0052760', 'coarse_10km',
   '圓唇雙花豆蘭 Bulbophyllum hymenanthum. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053328', 'coarse_10km',
   '世富暫花蘭 Dendrobium parietiforme. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053330', 'coarse_10km',
   '淺黃暫花蘭 Dendrobium xantholeucum. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053374', 'coarse_10km',
   '小鬼蘭 Didymoplexis micradenia. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053545', 'coarse_10km',
   '無葉上鬚蘭 Epipogium aphyllum. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053777', 'coarse_10km',
   '白赤箭 Gastrodia albida. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053779', 'coarse_10km',
   '緋赤箭 Gastrodia callosa. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053780', 'coarse_10km',
   '閉花赤箭 Gastrodia clausa. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053788', 'coarse_10km',
   '南投赤箭 Gastrodia nantoensis. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053793', 'coarse_10km',
   '短柱赤箭 Gastrodia theana. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053794', 'coarse_10km',
   '烏來赤箭 Gastrodia uraiensis. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053892', 'coarse_10km',
   '蔡氏玉鳳蘭 Habenaria tsaiana. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0053901', 'coarse_10km',
   '全唇早田蘭 Hayata merrillii. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0054187', 'coarse_10km',
   '士賢皿柱蘭 Lecanorchis latens. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0054337', 'coarse_10km',
   '呂氏金釵蘭 Luisia lui. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0054575', 'coarse_10km',
   '四重溪脈葉蘭 Nervilia crociformis. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0054606', 'coarse_10km',
   '圓唇莪白蘭 Oberonia linguae. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0054616', 'coarse_10km',
   '南嶺齒唇蘭 Odontochilus nanlingensis. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0054874', 'coarse_10km',
   '千鳥粉蝶蘭 Platanthera ophrydioides. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0054878', 'coarse_10km',
   '臺灣蜻蛉蘭 Platanthera taiwanensis. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0069849', 'coarse_10km',
   '屏東線柱蘭 Zeuxine flava var. pingtungensis. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0074506', 'coarse_10km',
   '杉野氏皿蘭 Lecanorchis suginoana. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0074931', 'coarse_10km',
   '寬唇脈葉蘭 Nervilia purpureotincta. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0086660', 'coarse_10km',
   '松田氏根節蘭 Calanthe davidii var. matsudae. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0086673', 'coarse_10km',
   '淺黃肖頭蕊蘭 Cephalantheropsis obcordata var. alboflavescens. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0086782', 'coarse_10km',
   '南投鬼蘭 Didymoplexis pallens var. nantouensis. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0087355', 'coarse_10km',
   '無毛捲瓣蘭 Bulbophyllum hirundinis var. calvum. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0102284', 'coarse_10km',
   '擬八代赤箭 Gastrodia confusoides var. confusoides. TaiCOL''s 29 September 2026 refresh removes its 輕度 sensitivity rating. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0103277', 'coarse_10km',
   '臺灣萍蓬草 Nuphar pumila. TaiCOL''s 29 September 2026 refresh removes its Red List category NCR. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  ('t0103284', 'coarse_10km',
   '純頭落芒草 Piptatherum kuoi. TaiCOL''s 29 September 2026 refresh removes its Red List category NCR. Held at 10 km, the level it had before the refresh, until the owner decides otherwise. No record.'),
  -- Rows the snapshot adds whose rating TaiCOL keeps only on a retired twin,
  -- found by 0014's retired-twin check (RETIRED_TWINS_SQL) run on the refresh.
  ('t0136250', 'coarse_10km',
   '酒紅朱雀 Carpodacus vinaceus, a species row new in TaiCOL''s 29 September 2026 snapshot. TaiCOL rates the bird 輕度 only on a deleted row, t0103442 (Carpodacus vinaceus vinaceus, 酒紅朱雀); the accepted rows are unrated. Carried over (10 km) so naming it blurs it as the retired row did; covers the subspecies t0085392 too. No record.'),
  ('t0103360', 'coarse_10km',
   '全唇皿蘭 Lecanorchis nigricans var. nigricans. TaiCOL rates this plant 輕度 only on a deleted row with the same name, t0086880; the accepted row is unrated. Carried over (10 km). Found by the retired-twin check after the 29 September 2026 refresh. No record.'),
  ('t0136634', 'coarse_10km',
   '奇萊喜普鞋蘭 Cypripedium macranthos var. taiwanianum, new in TaiCOL''s 29 September 2026 snapshot. TaiCOL rates it 輕度 and Nationally Endangered only on the deleted Cypripedium macranthos (t0102280, 奇萊喜普鞋蘭); the accepted row is unrated. Carried over (10 km). No record.')
on conflict (taicol_id) do nothing;
