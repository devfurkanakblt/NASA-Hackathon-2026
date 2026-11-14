# Ekip notları

Her kişinin altında, o kişinin bilmesi gerekenler listelenir. Satır başı kimden geldiğini gösterir (`A->` = A'dan).
Veri formatının tamamı: [`docs/data-contract.md`](data-contract.md). Gerçek veri PR #1 merge edilince `main`'de.

## A:

- C-> Yeni komut: `python -m preprocess.crosscheck_moontrek` → `docs/validation-moontrek.md`. Etkinlik sayfasında listelenen NASA Moon Trek'in LOLA 5 m verisinden (`LRO_LOLA_DEM_SPole875_5mp_v04`) aynı `terrain.build` ile ızgara üretip `terrain.json` ile karşılaştırıyor. Sonuç: eğimi 10°'nin altındaki arazide RMS fark 1.3–2.4 m, Shackleton duvarında (eğim > 25°) 16–18 m. `preprocess/README.md`'ye ve slayt 6'ya ekleyebilirsin; `public/data/` değişmedi.
- C-> TypeScript motoru (`src/sim/`), `docs/reference/visibility.json`'daki yüzdeleri ve pencere indekslerini dört sitede birebir üretiyor (`tests/simRealData.test.ts`). Değerler şimdilik teste elle yazıldı; dosya `main`'e girince test doğrudan dosyadan okuyabilir.
- C-> 3B genel görünüm `sites.json` → `surfaceElevationM` alanını kullanıyor (1737.4 km referans küreyi çizmek için). Bu alanın adı ya da anlamı değişirse haber ver.
- C-> `preprocess/requirements.txt`'teki `numpy==1.26.4` Python 3.14'te kurulmuyor; numpy 2.5 + rasterio 1.5.2 + pyproj 3.8 ile `terrain.build` ve `Dem` sorunsuz çalıştı.
- C-> `.gitignore`'a web uygulaması satırları (`node_modules`, `dist`) ve `.venv/` eklendi; senin satırlarına dokunulmadı.

## B:

- A-> `_sample` yerine artık gerçek veriyi kullanın: `public/data/sites.json` ve `Site01`, `Site04`, `Site04R`, `Site07` klasörleri (her birinde `ephemeris.json`, `horizon.json`, `terrain.json`).
- A-> Site listesinde yeni bir id var: `Site04R`. Katalog noktası değil, türetilmiş bir değerlendirme noktası. `derivedFrom: "Site04"` ve `derivation` alanlarını taşır; arayüzde "Site04 yakınındaki sırt noktası (türetilmiş)" gibi etiketleyin.
- A-> Her sitenin `warnings` dizisini site kartında gösterin. Site04'te "katalog noktası ~32° eğimli Shackleton iç duvarında" uyarısı var.
- A-> Her sitenin `label` alanını da gösterin ("not a certified landing site").
- A-> Ufuk panoraması: `horizon.json` → `elevDeg` 3600 değer, 0.1° adım. `distanceM[i]` ile "ufku X km ötedeki sırt oluşturuyor" bilgisi gösterilebilir.
- A-> Açı kuralları: azimut kuzeyden saat yönünde (K=0, D=90, G=180, B=270); yükseklik açısı yerel yatay düzleme göre; zaman UTC.
- A-> Zaman dizisi yok: `t[i] = startUtc + i * stepS` (`stepS` = 600 s).
- A-> Görünürlük kontrolü için sözleşmedeki `horizonAt` fonksiyonunu kullanın; D ile aynı kodu paylaşın ki sayılar tutarlı olsun.
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

## C:

- A-> 3B arazi: `terrain.json` → 256×256 ızgara, ±5 km (10 km kenar), hücre ~39 m.
- A-> Koordinat sistemi yerel ENU, orijin gözlemcinin gözü: x = doğu, y = kuzey, z = yukarı. `zM` göz seviyesine göre ve Ay eğriliği dahil, yani gözlemci (0, 0, 0)'da.
- A-> `zM` satır öncelikli: satır 0 = en güney, sütun 0 = en batı. three.js gibi Y-yukarı bir motorda eksenleri çevirmeyi unutmayın (örn. x→x, z→y, y→−z).
- A-> Arazi yalnızca görsel. Görünürlük her zaman `horizon.json`'dan gelir; 3B'deki gölgeyle karar verilmez.
- A-> Güneş/Dünya işareti için `ephemeris.json` → az/el'den yön vektörü (ENU): `x = cos(el)·sin(az)`, `y = cos(el)·cos(az)`, `z = sin(el)`.
- A-> 10 km ızgara uzak ufku (250 km'ye kadar) içermez. Uzak dağlar gerekiyorsa `horizon.json`'daki profili bir halka/panorama olarak çizebilirsiniz.
- A-> `Site04R`'nin arazisi Site04 DEM'inden alındı ama merkezi Site04R noktası.

## D:

- A-> Simülasyon artık gerçek seriyi okuyabilir: `ephemeris.json` → `sun`/`earth` için `azDeg`, `elDeg`, `distanceM`; 8785 örnek, 600 s adım.
- A-> Birimler SI: mesafe m, süre s, güç W, enerji J (arayüz Wh gösterebilir).
- A-> Görünürlük kuralı ve kısmi Güneş diski formülü `docs/data-contract.md`'de; B ile aynı `horizonAt` kodunu kullanın.
- A-> Yukarıdaki görünürlük tablosu (B bölümü) birim testleri için referans değer olarak kullanılabilir.
- A-> Doğrulama sonuçları `docs/validation.md`'de: Horizons ile Skyfield farkı ≤ 0.00006°, ufuk yakınsaması ≤ 0.019° (tolerans 0.05°). Proje metni ve slaytlarda kullanılabilir.
- A-> Sunum için güçlü bir hikâye: Site04'ün katalog noktası krater duvarında (%27 Güneş, %0 Dünya). Sadece 1.9 km ötedeki sırtta (Site04R) Güneş %100, Dünya %48.

