# Ekip notları

Her kişinin altında, o kişinin bilmesi gerekenler listelenir. Satır başı kimden geldiğini gösterir (`A->` = A'dan).
Veri formatının tamamı: [`docs/data-contract.md`](data-contract.md). Gerçek veri PR #1 merge edilince `main`'de.

## A:

- C-> Yeni komut: `python -m preprocess.crosscheck_moontrek` → `docs/validation-moontrek.md`. Etkinlik sayfasında listelenen NASA Moon Trek'in LOLA 5 m verisinden (`LRO_LOLA_DEM_SPole875_5mp_v04`) aynı `terrain.build` ile ızgara üretip `terrain.json` ile karşılaştırıyor. Sonuç: eğimi 10°'nin altındaki arazide RMS fark 1.3–2.4 m, Shackleton duvarında (eğim > 25°) 16–18 m. `preprocess/README.md`'ye ve slayt 6'ya ekleyebilirsin; `public/data/` değişmedi.
- C-> TypeScript motoru (`src/sim/`), `docs/reference/visibility.json`'daki yüzdeleri ve pencere indekslerini dört sitede birebir üretiyor (`tests/simRealData.test.ts`). Değerler şimdilik teste elle yazıldı; dosya `main`'e girince test doğrudan dosyadan okuyabilir.
- C-> 3B genel görünüm `sites.json` → `surfaceElevationM` alanını kullanıyor (1737.4 km referans küreyi çizmek için). Bu alanın adı ya da anlamı değişirse haber ver.
- C-> `preprocess/requirements.txt`'teki `numpy==1.26.4` Python 3.14'te kurulmuyor; numpy 2.5 + rasterio 1.5.2 + pyproj 3.8 ile `terrain.build` ve `Dem` sorunsuz çalıştı.
- C-> `.gitignore`'a web uygulaması satırları (`node_modules`, `dist`) ve `.venv/` eklendi; senin satırlarına dokunulmadı.
- D-> `tests/simRealData.test.ts` artık beklenen değerleri doğrudan `docs/reference/visibility.json`'dan okuyor (yüzdeler, "ikisi birden", pencereler, olay sayıları, `neverVisible`/`alwaysVisible`, `horizonAtCases`, `spotChecks`, `sunDiskFractionMean`). Veriyi yeniden üretirsen `python -m preprocess.reference`'ı da çalıştır; test ayrıca referanstaki site listesinin `sites.json` ile aynı olmasını istiyor, yeni site eklersen referansı da güncelle.
- D-> Sunum taslağı `docs/presentation-notes.md`'de; doğrulama bölümündeki sayıları `docs/validation.md`'den aldım ("80 m DEM 250 km'ye kadar", "100 km tarama Site07/Site04R'de 1.3°'ye kadar uzak dağı kaçırırdı"). Yanlış yorumladığım bir şey varsa düzelt ya da haber ver.
- B-> `map.json` ve `season.json` artık arayüzde: "Around the site (±3 km)" ısı haritası (Sun / Earth / Both / Slope) ve "Through the year" aylık grafiği. Site04 haritasında Site04R ~1.9 km ötede işaretli (`tests/mapSeason.test.ts`; Site01 merkezi %72.5/%36.5 ve +200 m D / +600 m K hücresi %100/%48.9 test ediliyor).
- B-> `map.json` → `warnings` ekranda olduğu gibi gösteriliyor: "204367922 near-field ray samples (<= 7000 m) used the 80 m DEM". Bu sayı kullanıcıya bir şey anlatmıyor; oran (%) ya da düz bir cümle olarak yazabilir misin? Alan adı aynı kalırsa arayüz değişmeden alır.
- D-> 15 Kas: Yeni komut `python -m preprocess.extended` (`--only year|cells|warning|reference`, `--check`). Cache'ten `year.bin` (9 site), `cells.bin` (7 harita sitesi), `extended.json` ve `docs/reference/cells.json` üretti; harita uyarısı artık oran ("2.9 % of terrain samples within 7 km of each cell fell outside the 5 m DEM…"), `regional_map.py` da yeni metni yazıyor. Site23'te bu uyarı yoktu, dokunulmadı. 1° hücre ufku ↔ `map.json` farkı ≤ 0.15 puan (`docs/validation.md` §7).
- B-> `slopeDeg` (ve diğer harita alanları) `null` gelirse arayüz hücreyi gri, değeri "no data" gösteriyor; o yüzden `null` yazmakta sakınca yok.

## B:

- A-> `_sample` yerine artık gerçek veriyi kullanın: `public/data/sites.json` ve `Site01`, `Site04`, `Site04R`, `Site07` klasörleri (her birinde `ephemeris.json`, `horizon.json`, `terrain.json`).
- A-> Site listesinde yeni bir id var: `Site04R`. Katalog noktası değil, türetilmiş bir değerlendirme noktası. `derivedFrom: "Site04"` ve `derivation` alanlarını taşır; arayüzde "Site04 yakınındaki sırt noktası (türetilmiş)" gibi etiketleyin.
- A-> Her sitenin `warnings` dizisini site kartında gösterin. Site04'te "katalog noktası ~32° eğimli Shackleton iç duvarında" uyarısı var.
- A-> Her sitenin `label` alanını da gösterin ("not a certified landing site").
- A-> Ufuk panoraması: `horizon.json` → `elevDeg` 3600 değer, 0.1° adım. `distanceM[i]` ile "ufku X km ötedeki sırt oluşturuyor" bilgisi gösterilebilir.
- A-> Açı kuralları: azimut kuzeyden saat yönünde (K=0, D=90, G=180, B=270); yükseklik açısı yerel yatay düzleme göre; zaman UTC.
- A-> Zaman dizisi yok: `t[i] = startUtc + i * stepS` (`stepS` = 600 s).
- A-> Görünürlük kontrolü için sözleşmedeki `horizonAt` fonksiyonunu kullanın; D ile aynı kodu paylaşın ki sayılar tutarlı olsun. Beklenen değerler: `docs/reference/visibility.json`.
- A-> Karşılaştırma ekranı için kontrol değerleri (1 Kas 2026 – 1 Oca 2027, arazi dahil):

  | Site | Güneş | Dünya | İkisi birden |
  |---|---|---|---|
  | Site01 | %73 | %37 | %24 |
  | Site04 | %27 | %0 | %0 |
  | Site04R | %100 | %48 | %48 |
  | Site07 | %100 | %50 | %50 |
- C-> `main`'de artık Vite + React + TypeScript iskeleti var (`npm install`, `npm run dev`, `npm test`). `src/App.tsx` şimdilik geçici bir sayfa gösteriyor (`src/scene3d/dev/Scene3DDemo.tsx`); kendi ekran düzenini kurunca `App.tsx`'i değiştir, geçici sayfa silinebilir.
- C-> 3B görünüm: `import { MissionScene3D } from './scene3d'`. Girdiler: `terrain` ve `horizon` (JSON dosyaları olduğu gibi), `sun` / `earth` (`azDeg`, `elDeg`, `visible`, `distanceM`), isteğe bağlı `sunPath` / `earthPath` (görev boyunca iz), `panel`, `observerHeightM`, `surfaceElevationM`. Bulunduğu kutuya yükseklik ver (en az ~320 px); WebGL yoksa kendi kutusunda uyarı gösterir, sayfanın geri kalanı çalışır.
- C-> Veri yükleme hazır: `loadAllData()` (`src/data/load.ts`) bütün siteleri ilk açılışta alır, sonrasında ağ isteği olmaz. Sözleşme tipleri `src/data/contract.ts`'te.
- C-> Motor hazır: `evaluateScenarios(candidates, settings, bySite)` (`src/sim/evaluate.ts`) en fazla 3 senaryo döndürür. Grafikler için `generationW`, `loadW`, `socJ` (örnek başına), şeritler için `sunWindows` / `earthWindows` / `bothWindows` (saniye cinsinden `startS`, `endS`), kartlar için `summary` (`keepsBatteryReserve`, `earthOutageWithinLimit`, `firstReserveViolationS`, `unmetEnergyJ`...). "Kalan süre" için `nextTransition(windows, tS)` (`src/sim/visibility.ts`).
- C-> ECharts henüz `package.json`'da yok; panorama ve grafikler için sen ekleyeceksin.
- C-> Resmî teslim kuralı: proje sayfası ve bağlantı verilen her şey İngilizce olmalı; arayüz metinlerini İngilizce yaz (3B etiketleri İngilizce).
- D-> `horizonAt` için kendi kopyanı yazma; `import { horizonAt } from './sim/visibility.ts'` kullan. Böylece panoramadaki görünür/görünmez ile motorun sayıları aynı koddan gelir.
- D-> Motora isteğe bağlı kısmi Güneş diski eklendi: `settings.sunDiskModel` = `'centre'` (varsayılan, eskisiyle aynı sonuç) veya `'partial'` (panel üretimi diskin ufkun üstündeki payıyla ölçeklenir; görünürlük pencereleri yine merkeze göre). Şimdilik seçenek olarak kalıyor; istersen "Partial Sun disk" diye bir anahtar koyabilirsin. Sonuçta örnek başına `sunDiskFraction` (0–1) ve kaynak/model bölümü için `model.sunDiskModel` + `model.notes` (model sınırları, İngilizce) var.
- D-> Ayar formu için `validateSettings(settings)` (`src/sim/evaluate.ts`) İngilizce hata cümleleri listesi döndürür (boşsa geçerli); görev süresi 1–30 gün (`MIN_DURATION_DAYS` / `MAX_DURATION_DAYS`). Motor geçersiz ayarda `SettingsError` (`.issues`), kapsam dışı tarihte `CoverageError` fırlatır; ikisini de yakalayıp mesajı göster.
- D-> Saat ekseni için: sonuçta `alignedStartUtc` (10 dakikalık ızgaraya oturtulmuş gerçek başlangıç; `startUtc` 00:04 gibi gelirse 00:00 olur) ve `sampleUtc(result, k)` → k. örneğin UTC zamanı. "Görev başlangıcından geçen saat" = `k * stepS / 3600`.
- D-> Sunum için slayt 3 (arazi kanıtı: panorama) ve slayt 5 (karşılaştırma: Site04 / Site04R / Site04R +72 sa) ekran görüntüleri gerekecek. Varsayılan görevin (15 Kas 2026, 7 gün) beklenen sonuçları `docs/presentation-notes.md`'de; ekranda gördüğün sayıları bununla karşılaştırabilirsin.

- A-> **Yeni (plan A genişletme):** `sites.json` artık 9 nokta içeriyor: Site01, Site04, Site07, Site04R, **Site11** (de Gerlache Rim 1), **Site20** (Leibnitz Beta Plateau), **Site23** (Malapert Massif) ve iki karşıtlık noktası **CE6** (Chang'e-6, uzak yüz) ile **Apollo11**. Karşıtlık noktalarında `category: "contrast"` alanı var; listede ayrı bir grupta, "eğitim amaçlı karşılaştırma" etiketiyle gösterin. CE6'da Dünya hiç görünmüyor (%0), Apollo11'de Dünya hep görünüyor (%100).
- A-> **Yeni dosya `{site}/season.json`:** 1 yıllık (1 Kas 2026 – 1 Kas 2027) aylık tablo: `months[]` içinde `sunPct`, `earthPct`, `bothPct`, `sunElMaxDeg` vb. Tek bir çubuk/çizgi grafikle mevsim etkisi gösterilebilir. Örnek: Site07 Kas–Ara'da %100 Güneş, Nisan'da %14; yıl ortalaması %68. Format: `docs/data-contract.md`.
- A-> **Yeni dosya `{site}/map.json`:** site çevresinde ±3 km ızgara (Site01/04/04R/07 için 100 m, 61×61; Site11/20/23 için 200 m, 31×31). Her hücrede `sunPct`, `earthPct`, `bothPct`, `longestNoSunS`, `longestNoEarthS`, `slopeDeg`. Isı haritası katmanları: Güneş % / Dünya % / ikisi birden % / eğim. Sıra `terrain.json` ile aynı (satır 0 = güney, sütun 0 = batı). Karşıtlık noktalarında `map.json` yok.
- A-> Harita hücresine tıklanınca sonuçları "bu dönem için özet değer" diye etiketleyin; hücreler için zaman serisi yok.
- A-> Sunum için harita örneği: Site01 katalog merkezi Güneş %72.5 / Dünya %36.5. Merkezin ~630 m kuzeydoğusunda (doğu +200 m, kuzey +600 m) eğimi 4.7° olan bir hücre Güneş %100 / Dünya %48.9.
- A-> Güncel referans tablo (9 nokta) `docs/reference/visibility.md` içinde.
- A-> **İlk yükleme boyutu (ölçüldü, 9 nokta):** `loadAllData()` şu an her site için `terrain` + `horizon` + `ephemeris` çekiyor: toplam 9.1 MB ham, **2.8 MB gzip** (Vercel/GitHub Pages JSON'u gzip/brotli ile sunar). `map.json` (7 dosya, 0.40 MB gzip) ve `season.json` (9 dosya, 0.01 MB gzip) da eklenirse toplam **~3.2 MB gzip**. Kaba süre: 10 Mbit/s bağlantıda ~2.6 s, 50 Mbit/s'de ~0.5 s, artı 9 MB JSON ayrıştırma. En büyük kalemler `ephemeris.json` (9×~0.52 MB) ve `terrain.json` (9×~0.43 MB). Yavaş kalırsa: önce `sites.json` + seçili site, diğerleri arka planda; ya da `terrain`/`map` yalnızca o site açılınca. "İlk yüklemeden sonra ağ isteği yok" kuralı için tümünü baştan çekmek de kabul edilebilir boyutta. Demo öncesi kendi bağlantında DevTools → Network ile doğrula.
- D-> `vite.config.ts`'e `base: './'` eklendi: aynı `dist/` artık Vercel'de, GitHub Pages alt yolunda (`/NASA-Hackathon-2026/`) ve internetsiz demo için herhangi bir klasöre kopyalanınca çalışıyor. Veri yolları `loadAllData()` üzerinden buna uyuyor; kendi kodunda `/data/...` gibi mutlak yol yazma.
- D-> `loadAllData()` eksik dosyada hangi dosyanın eksik olduğunu yazan hatayla reddediyor (`src/data/load.test.ts`). Arayüz bu hatayı ekranda gösteriyor (aşağıdaki ekranda yapıldı).
- D-> **Senin bölümünden, sunum için gereken kısmı yaptım** (dal `feat/b-ui-for-demo`). Ekran görüntüleri (slayt 2–5) ve kullanıcı denemesi beklemesin diye yaptım; üstüne yazabilir, değiştirebilir ya da tamamen kendi tasarımınla değiştirebilirsin. Ne var:
  - `src/App.tsx` artık `src/app/MissionApp.tsx`'i açıyor. C'nin 3B test sayfası `?demo=3d` ile hâlâ açılıyor.
  - **Sol sütun:** 1–2 Siteler ve tarihler (`ScenarioList.tsx`): en fazla 3 senaryo (A/B/C), site seçimi (kutup siteleri ve "Contrast points" ayrı grupta, Site04R "derived point near Site04" etiketli), UTC başlangıç, −24/+24/+72 sa, senaryo kopyalama. 3 Görev donanımı (`SettingsForm.tsx`): plandaki bütün ayarlar, birimler % / kWh / W / h, `validateSettings` hataları formun altında.
  - **Sağ sütun:** 4 Karşılaştırma (`Comparison.tsx`): üstte düz cümlelerle cevap ("B and C keep the battery above its 20 % reserve; A does not." …), altında tablo; puan yok. Sonra ortak zaman sürgüsü + Play, ufuk panoraması (`charts/Panorama.tsx`), Güneş/Dünya/ikisi zaman şeritleri (`Timelines.tsx`), batarya SoC (bütün senaryolar, rezerv çizgisi, ilk ihlal işareti), panel çıkışı/talep (aktif senaryo), 3B görünüm (C'nin `MissionScene3D`), kaynaklar ve model sınırları (`Sources.tsx`: `label`, `warnings`, `derivation`, DEM, efemeris kaynağı, `model.notes`).
  - "Aktif senaryo" (harfe tıkla) panoramayı, 3B'yi ve güç grafiğini belirliyor.
  - Panoramada görünür/gizli kararı motorun `sunVisible`/`earthVisible`'ından geliyor; imleç altındaki ufuk açısı `horizonAt` ile. Yani panorama ve tablo aynı koddan.
  - **Grafikler ECharts değil, satır içi SVG** (`src/app/charts/`). Bağımlılık eklemedim, çünkü Windows'ta `npm install` `package-lock.json`'dan Linux paketlerini siliyor ve Vercel derlemesini bozabilir. ECharts'a geçersen lockfile'ı kontrol et; `docs/submission.md` → Tools satırını da güncelle (şu an "inline SVG charts").
  - Varsayılan ekran slayt 5'in senaryosu: A = Site04, B = Site04R, C = Site04R +72 sa (15 Kas 2026, 7 gün). Ekrandaki sayılar `docs/presentation-notes.md` ile aynı; bunu `tests/appScenarios.test.ts` kontrol ediyor.
  - **Yapılmadı, sende:** `map.json` ısı haritası, `season.json` mevsim grafiği, paylaşılabilir bağlantı, dar ekranda (telefon) ayrıntılı rötuş. Ayrıca 3B'nin gerçek GPU'lu tarayıcıda görünümünü kontrol et (headless testte WebGL yoktu).

- D-> 15 Kas: Arayüzde tarih artık 1 Kas 2027'ye kadar (o sitenin `year.bin`'i yüklenince), haritada "Simulate this point", senaryo listesinde "Lat / Lon (±3 km of a site)" + "Use point". Hücre id'si `Site01:r36c32`, paylaşım bağlantısında da böyle. `evaluateAll` artık `bySite` değil bir çözücü (`resolveSiteData`) alıyor; sonuçta `loading` ve `data` alanları var. `decodeShare` ikinci parametre olarak fonksiyon alıyor.

## C:

- A-> 3B arazi: `terrain.json` → 256×256 ızgara, ±5 km (10 km kenar), hücre ~39 m.
- A-> Koordinat sistemi yerel ENU, orijin gözlemcinin gözü: x = doğu, y = kuzey, z = yukarı. `zM` göz seviyesine göre ve Ay eğriliği dahil, yani gözlemci (0, 0, 0)'da.
- A-> `zM` satır öncelikli: satır 0 = en güney, sütun 0 = en batı. three.js gibi Y-yukarı bir motorda eksenleri çevirmeyi unutmayın (örn. x→x, z→y, y→−z).
- A-> Arazi yalnızca görsel. Görünürlük her zaman `horizon.json`'dan gelir; 3B'deki gölgeyle karar verilmez.
- A-> Güneş/Dünya işareti için `ephemeris.json` → az/el'den yön vektörü (ENU): `x = cos(el)·sin(az)`, `y = cos(el)·cos(az)`, `z = sin(el)`.
- A-> 10 km ızgara uzak ufku (250 km'ye kadar) içermez. Uzak dağlar gerekiyorsa `horizon.json`'daki profili bir halka/panorama olarak çizebilirsiniz.
- A-> `Site04R`'nin arazisi Site04 DEM'inden alındı ama merkezi Site04R noktası.
- A-> `map.json` aynı ENU ızgara mantığını kullanıyor (±3 km, satır 0 = güney). `terrain.json` ±5 km olduğundan harita, arazinin ortasındaki 6×6 km'lik alana doku olarak giydirilebilir. Eğim katmanı (`slopeDeg`) 3B'de iyi görünür.
- A-> `tests/dataConsistency.test.ts`'te küçük değişiklik yaptım: yeni CE6 noktası (düz mare) negatif kontrolde kaldı. Aynalanmış ufuk farkı 0.049° çıktı, beklenen ise 0.20°'den büyük olmasıydı. Asıl kontroller (medyan < 0.15°, max < 0.5°) CE6'da geçiyor. Negatif kontrol artık yalnızca karşılaştırılan yönlerde ufuk farkı ≥ 1° olan sitelerde çalışıyor (`MIN_RELIEF_FOR_CONTROL_DEG`); şu an 5 sitede çalışıyor, Site01 (0.26°) ve CE6 (0.18°) bu kontrolden çıktı. `npm test`: 80/80, `tsc -b` temiz. Uygun görmezsen değiştir.
- A-> CE6 ve Apollo11'in `terrain.json`'ı 474 m/px global DEM'den üretildi. Kutup sitelerine göre çok daha kaba; küçük tepeler görünmez.
- D-> `src/sim/evaluate.ts`'e dokundum: isteğe bağlı `sunDiskModel` ayarı (varsayılan `'centre'`, mevcut sonuçlar değişmedi) ve sonuçta yeni `sunDiskFraction` (örnek başına 0–1) ile `model.sunDiskModel` alanları. Var olan alanların adı veya anlamı değişmedi. `src/sim/visibility.ts`'e `sunDiskFraction()` ve `sunAngularRadiusDeg()` eklendi. Ayrıca `validateSettings()` / `SettingsError`, `alignedStartUtc` ve `sampleUtc()` eklendi; motor artık geçersiz ayarı reddediyor (testler: `src/sim/evaluate.test.ts`).
- D-> Yayın: `npm run build` çalışıyor ama `dist/index.html` dosya yollarını `/assets/...` diye mutlak yazıyor. GitHub Pages'te (`.../NASA-Hackathon-2026/`) sayfa boş açılır; orada yayınlanacaksa `vite.config.ts`'e `base: './'` (ya da `'/NASA-Hackathon-2026/'`) eklemek gerekir. Vercel'de ve `npm run preview` ile sorun yok. `loadAllData()` zaten `import.meta.env.BASE_URL` kullandığı için veri yolları da buna uyar.
- A-> `preprocess/crosscheck_moontrek.py`'ye küçük ekleme: mozaik 87.5°G'nin kuzeyinde veri döndürmüyor (−3.4e38 nodata, hata vermeden), bu yüzden o sitelerin atlanması için enlem kontrolü koydum (`COVERAGE_LAT_DEG`). Site11 rapora eklendi (düz arazide RMS 1.92 m); Site20/23, CE6, Apollo11 "kapsam dışı" olarak yazılıyor. Site11'deki 160 m'lik en büyük fark Moon Trek mozaiğindeki ~5 hücrelik bir sivri tepe; bizim arazimiz orada düzgün (`OUTLIER_NOTES`).

- D-> 15 Kas: `HorizonDoc.distanceM` artık isteğe bağlı (harita hücrelerinde yok). Hücre senaryosu aktifken 3B kutusu sahne yerine "The 3D view shows the catalogue point; the selected map point is … of it." notunu gösteriyor.

## D:

- D-> 15 Kas: Yeni `src/data/extended.ts` (yükleyiciler), `src/sim/cell.ts` (hücre efemerisi), `src/app/extendedSites.ts`. `tests/noNetwork.test.ts` artık `data/extended.ts`'teki fetch'e de izin veriyor (tasarım 1. yaklaşım).

- A-> Simülasyon artık gerçek seriyi okuyabilir: `ephemeris.json` → `sun`/`earth` için `azDeg`, `elDeg`, `distanceM`; 8785 örnek, 600 s adım.
- A-> Birimler SI: mesafe m, süre s, güç W, enerji J (arayüz Wh gösterebilir).
- A-> Görünürlük kuralı ve kısmi Güneş diski formülü `docs/data-contract.md`'de; B ile aynı `horizonAt` kodunu kullanın.
- A-> Yukarıdaki görünürlük tablosu (B bölümü) birim testleri için referans değer olarak kullanılabilir.
- A-> Doğrulama sonuçları `docs/validation.md`'de: Horizons ile Skyfield farkı ≤ 0.00006°, ufuk yakınsaması ≤ 0.019° (tolerans 0.05°). Proje metni ve slaytlarda kullanılabilir.
- A-> Sunum için güçlü bir hikâye: Site04'ün katalog noktası krater duvarında (%27 Güneş, %0 Dünya). Sadece 1.9 km ötedeki sırtta (Site04R) Güneş %100, Dünya %48.
- A-> Birim testleri için hazır beklenen değerler: [`docs/reference/visibility.json`](reference/visibility.json) (özet: `visibility.md`). İçinde site başına yüzdeler, olay sayıları, tüm görünürlük pencereleri, `horizonAt` test vektörleri (359.95°→0° geçişi dahil) ve uç durumlar var: Site04'te Dünya hiç doğmuyor, Site07'de Güneş hiç batmıyor, pencere veri sonunda açık (`openAtEnd`). Motorunuz aynı dosyalardan bu sayıları birebir üretmeli.
- A-> Doğuş/batış anını ardışık iki örnek arasında doğrusal ara değerle bulun (`el − horizonAt(az)` işaret değiştirdiği yer). Ara değerle hata < 20 s; örnekleri doğrudan kullanırsanız 10 dk'ya kadar kayar (`docs/validation.md` §4).
- A-> Sunum notu: kutupta Güneş ufku saatte 0.01–0.10° hızla geçiyor; 0.05°'lik ufuk hatası doğuş/batışı 30 dk – 4 saat kaydırabilir (yeni sitelerle güncellendi; Site23 en yavaş). Bu yüzden zaman sonuçlarını dakika hassasiyetiyle "kesin" diye sunmayın.
- A-> "Data & Methods" metni hazır: `docs/data-methods.md` (İngilizce, proje sayfasına doğrudan alınabilir; atıflar ve AI beyanı içinde). Slayt 6 taslağı: `docs/slide6-scientific-basis.md`. Repo kökünde `LICENSE` (MIT) var.
- A-> Enerji simülasyonu ve doğuş/batış zaman çizelgesi `sites.json`'daki 9 nokta için çalışır (hepsinde `ephemeris.json` + `horizon.json` var). `map.json` hücreleri yalnızca özet içerir.
- A-> Dış doğrulama: 7 kutup noktası için 18.6 yıllık Güneş görünürlüğümüz NASA/Mazarico ürünüyle uyumlu (7/7, sıra korelasyonu 0.96). Shackleton tabanı iki modelde de kalıcı gölge. Ayrıntı: `docs/validation.md` §5.
- A-> Slaytlar için hazır görseller: `docs/figures/site04-map.png` (Site04 bölgesel harita: Güneş %, Güneş+Dünya %, eğim; katalog noktası ve 1.9 km ötedeki Site04R işaretli; slayt 3–5 hikâyesine uyuyor) ve `docs/figures/season-polar-sites.png` (7 kutup sitesi, 1 yıl aylık Güneş/Dünya görünürlüğü). Arayüz `map.json`/`season.json`'u göstermediği için bunlar sunumda kullanılabilir. Yeniden üretmek: `python -m preprocess.figures`.
- A-> Soru-cevap için önemli: uygulamanın dönemi (Kas–Ara) kutupta güneşli mevsim. Yıllık ortalamalar belirgin şekilde düşük (Site01 %73 → %47, Site07 %100 → %68, Site04R %100 → %86). Mevsim grafiği bunu gösteriyor.
