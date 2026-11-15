# Tasarım: 1 yıllık simülasyon ve harita noktasında tam simülasyon

> Tarih: 15 Kasım 2026 · Durum: onay bekliyor · Özellik dondurma: 15 Kas 17.00 TR

## 1. Amaç ve neden

Challenge metninde iki istek var ve ikisi şu an yalnızca kısmen karşılanıyor:

- **"ability to input custom lunar coordinates"**: Haritada bir hücre seçilebiliyor ama yalnızca özet değer görülüyor. O hücre için enerji ve batarya simülasyonu çalışmıyor.
- **"across different lunar days or seasons"**: Tam simülasyon yalnızca 1 Kas 2026 – 1 Oca 2027 aralığında çalışıyor. Kutupta bu dönem güneşli mevsim olduğu için demo sayıları yıl geneline göre iyimser kalıyor (ör. Site07'de %100'e karşı yıllık %68).

Gereken veri A'nın makinesinde zaten hesaplanmış durumda, yalnızca yayımlanmamış. `data_raw/map_*.npz` dosyalarında her hücrenin 0.5° adımlı, 250 km menzilli ufku var. `data_raw/horizons_cache/` klasöründe de 1 yıllık JPL Horizons serisi var. Bu iş yeni bir hesap gerektirmiyor; mevcut veriyi paketleyip arayüze bağlıyoruz.

## 2. Hedefler

1. Tarih seçici, kutup ve karşıtlık noktalarının hepsinde **1 Kas 2026 – 1 Kas 2027** aralığını kabul eder. Enerji, batarya, görünürlük şeritleri ve panorama bu aralığın her yerinde çalışır.
2. Haritada bir hücreye tıklanınca **"Simulate this point"** ile o hücre, katalog noktasıyla aynı motorla tam senaryo olarak karşılaştırmaya eklenir.
3. Bir **enlem/boylam girişi** vardır. Girilen nokta bir sitenin ±3 km haritası içindeyse en yakın hücreye oturtulur. Seçilen hücre ve ona olan uzaklık ekranda yazar.
4. Haritadaki "204367922 near-field ray samples…" uyarısı oran olarak, düz bir cümleyle yazılır.
5. Yeni verinin doğruluğu otomatik testlerle gösterilir (bkz. §6).

## 3. Kapsam dışı

- Ay'ın herhangi bir noktası için serbest koordinat. Bunun için çevrimiçi DEM ve uzun bir hesap gerekir; giriş açıkça "±3 km of a site" diye sınırlandırılır.
- Karşıtlık noktaları (CE6, Apollo11) için hücre simülasyonu. Bu noktaların haritası zaten yok.
- Hücre senaryosu için 3B görünüm. 3B sahne site merkezinde kalır ve yerine kısa bir not gösterilir. C'nin sahnesini kaydırmak bu işin parçası değil.
- Hücre ufku için `distanceM` (cache'te yok). Panorama, hücre senaryosunda "ufku X km ötedeki sırt oluşturuyor" bilgisini göstermez.
- Mevcut doğrulanmış dosyaların (`ephemeris.json`, `horizon.json`, `map.json` sayıları) değiştirilmesi.

### Olmaması gerekenler (çalışsa bile başarısızlık sayılır)

- Hücre senaryosunun sayıları katalog noktasıyla aynı kesinlikteymiş gibi sunulması. Hücre ufku 1° adımlı; arayüz bunu "regional map point (1° horizon)" diye etiketler.
- İlk açılışın yavaşlaması. Yeni dosyalar ilk yüklemeye eklenmez.
- Yıllık seriyle mevcut iki aylık seri arasında, örtüşen dönemde fark olması.

## 4. Yaklaşımlar

| | Yaklaşım | Bedel | Karar |
|---|---|---|---|
| 1 | **Site seçilince ayrıca yüklenen ikili dosyalar** (`year.bin`, `cells.bin`) | "İlk yüklemeden sonra ağ isteği yok" kuralı esner. İnternetsiz yerel demo yine çalışır. | **Seçildi** |
| 2 | Her şey ilk açılışta yüklenir | İlk yükleme ~3 MB'tan ~12–15 MB'a çıkar; demo riski | Reddedildi |
| 3 | Küçültülmüş veri (200 m hücre, 30 dk adım) önden yüklenir | Doğrulanmış 10 dk zinciri bozulur, validation.md sayıları geçersizleşir | Reddedildi |

Ekip 15 Kas'ta 1. yaklaşımı seçti.

## 5. Tasarım

### 5.1 Veri (Kişi A)

Yeni komut: `python -m preprocess.extended [--sites ...]`. Ağ isteği yapmaz; yalnızca cache'leri okur.

**`{site}/year.bin`** (9 site): 1 Kas 2026 – 1 Kas 2027, 600 s adım. Örnek sayısı, `season.py` ile aynı ızgaradan gelir. Düzen: little-endian `Float32Array`; sırasıyla `sun.azDeg`, `sun.elDeg`, `sun.distanceM`, `earth.azDeg`, `earth.elDeg`, `earth.distanceM` blokları, her biri `count` uzunlukta.
- `distanceM` float32 ile ~10 km çözünürlüğe iner. Bu, disk payı ve güç hesabında ihmal edilebilir (1 au'da göreli 1e-7).
- Açılar float32'de 360° civarında ~3e-5° hassasiyet verir; kabul toleransı 0.01°.
- Boyut ≈ 52 560 × 6 × 4 B ≈ 1.26 MB/site.

**`{site}/cells.bin`** (haritası olan 7 site): `map_*.npz` → `horizons` (N×720, 0.5°), her iki değerden biri alınarak 1° adıma (360 değer) indirilir. Düzen: little-endian `Int16Array`, birim 0.01°, satır = hücre (map.json sırası), sütun = azimut `j × 1°`.
- Boyut: 61×61 sitelerde 3721 × 360 × 2 B ≈ 2.7 MB; 31×31 sitelerde ≈ 0.7 MB.
- Neden seyreltme, ortalama değil: Ufuk değeri bir yöndeki en yüksek açıdır; iki yönün ortalaması, ikisinde de olmayan bir değer üretir. 0.5° → 1° geçişinin site yüzdelerine etkisi A'nın ölçümüne göre ≤ 0.08 puan; §6'daki test bunu hücrelerde yeniden kontrol eder.

**`{site}/extended.json`** (küçük başlık, 9 site): `version`, `year: {file, startUtc, stepS, count, source}`; haritası olanlarda ayrıca `cells: {file, azStepDeg: 1, count: 360, unitDeg: 0.01, n, eyeM: number[]}`. Burada `eyeM[i]` hücrenin göz yüksekliğidir (npz `eye`, referans küreye göre); merkez hücre yayımlanan göz yüksekliğini kullanır.

**Uyarı metni:** Mevcut `map.json` dosyaları yeniden hesaplanmaz. `regional_map.py` içindeki metin oran üretecek şekilde değiştirilir. Örnek: `"2.7 % of terrain samples within 7 km of a cell fell outside the 5 m DEM and used the 80 m DEM"`. Payda = hücre sayısı × yön sayısı × yakın alan adım sayısı (bu sayının kodda nasıl sayıldığı yapan kişi tarafından doğrulanmalı). Ardından mevcut 7 `map.json`'daki bu tek satır, sayının kendisinden yeniden yazılır; diğer alanlara dokunulmaz.

`docs/data-contract.md`'ye üç dosyanın tanımı eklenir.

### 5.2 Yükleme ve motor (Kişi D)

- `loadAllData()` değişmez: ilk açılış aynı kalır.
- Yeni `loadExtended(siteId)`: site başına bir kez çalışan, önbellekli bir Promise. Başarısız olursa arayüz yalnızca o özelliği "not available" gösterir; mevcut 2 aylık simülasyon çalışmaya devam eder.
- **Yıl:** Yüklenen yıllık seri, o sitenin `EphemerisDoc`'u olarak motora verilir. Motor zaten `startUtc/stepS/count` ile çalıştığı için `evaluate.ts` değişmez. `BodySeries` tipi `number[]` yerine `ArrayLike<number>` olur, böylece Float32Array kopyalanmadan kullanılır.
- **Hücre:** `src/sim/cell.ts` içinde `cellSiteData(base: SiteData, ext, cellIndex): SiteData`.
  - Efemeris: `regional_map.body_vectors` + `local_azel`'in TypeScript karşılığı. Site merkezindeki az/el/mesafe → Ay-sabit konum (float64) → hücrenin ENU çerçevesinde az/el. Dünya'nın birkaç km'lik paralaksı da hesaba katılır.
  - Ufuk: `{azStepDeg: 1, count: 360, elevDeg}`; `distanceM` yok (`HorizonDoc.distanceM` isteğe bağlı olur, panorama buna göre davranır).
  - `site`: kopya; `id = "<site>@<row>,<col>"`, `latDeg/lonDeg` = hücre, `label = "Regional map point (1° horizon), not a catalogue site"`, `derivedFrom = <site>`.
- Uygulama, sentetik `SiteData`'yı motora verdiği `bySite` haritasına ekler. `evaluateScenarios` aynı kalır.

### 5.3 Arayüz (Kişi B)

- **Tarih aralığı:** Seçili site için `year.bin` yüklüyse sınır 1 Kas 2027 olur; yüklenirken "Loading one-year data…" gösterilir. Mevcut −24/+24/+72 sa düğmeleri aynen çalışır.
- **Harita:** Hücre seçiliyken "Simulate this point" düğmesi aktif senaryonun yerini (sitesini) o hücreyle değiştirir. Senaryo kopyalama aynen çalışır; böylece kullanıcı "katalog noktası vs. 600 m ötesi"ni yan yana koyabilir.
- **Koordinat girişi:** Senaryo listesinde "Lat / Lon (±3 km of a site)" alanları vardır. En yakın site haritasının sınırları içinde değilse açıklayıcı hata verilir. İçindeyse en yakın hücre seçilir ve "snapped to cell … (NN m away)" yazar.
- **Etiketler:** Hücre senaryosunda `Sources` bölümü `label`'ı ve "1° horizon, no distance data" notunu gösterir. 3B kutusunda "3D view shows the catalogue point" notu çıkar.
- **Paylaşılabilir bağlantı:** `share.ts` hücre id'sini (`Site01@30,42`) taşır. Bağlantı açılınca `loadExtended` tetiklenir.
- **Yıllık grafik:** Değişmez.

## 6. Doğrulama (otomatik testler)

1. **Yıl ↔ mevcut seri:** `year.bin`'in ilk `ephemeris.count` örneği `ephemeris.json` ile örnek örnek aynı (float32 yuvarlaması içinde: açı ≤ 1e-4°). Python testi + Vitest.
2. **Yıl ↔ season.json:** TS motoru yıllık seri ve site ufkuyla her ay için Güneş/Dünya/ikisi yüzdelerini hesaplar; `season.json` ile ≤ 0.01 puan fark beklenir.
3. **Hücre efemerisi:** Python `local_azel` ile 5 hücre × 10 zaman için referans değerler üretilir (`docs/reference/cells.json`); TS sonucu ≤ 0.001° içinde aynı olmalı.
4. **Hücre ↔ map.json:** 7 sitede merkez + 6 sabit hücre için TS'te hesaplanan 2 aylık Güneş/Dünya/ikisi yüzdeleri `map.json` ile karşılaştırılır. Fark tamamen 0.5° → 1° seyreltmesinden gelir; beklenen ≤ 0.2 puan. Sonuç `docs/validation.md` §7'ye yazılır.
5. **Uç durumlar:** Haritanın dışındaki koordinat, karşıtlık noktasında koordinat girişi, `year.bin` yokken uygulamanın açılması, yıl sonuna taşan görev (`CoverageError`).

## 7. Kısıtlar

- Repo ve `dist` boyutu ≈ 24 MB artar (year 11.4 MB + cells 12.8 MB). Vercel ve GitHub Pages için sorun değil.
- Bir site için tek seferde inen en büyük yük ~4 MB (Site01/04/04R/07). İkili float verisi iyi sıkışmaz; 10 Mbit/s bağlantıda yaklaşık 3 s sürer. Demo öncesi ölçülmeli.
- `package-lock.json` Windows'ta bozuluyor; bu iş yeni bağımlılık eklemez.

## 8. Yapan kişiye bırakılanlar

- `preprocess/extended.py`'nin `season.query_year`'ı nasıl yeniden kullanacağı (cache'ten okuma) ve dosya yazma ayrıntıları.
- Yükleme durumunun arayüzdeki görünümü ve koordinat giriş alanının tam yeri.
- Hücre id'sinde satır/sütun mu yoksa düz indeks mi kullanılacağı (bağlantıda okunabilir olması yeterli).
- 6 sabit test hücresinin seçimi (merkez dışında, haritanın farklı bölgelerinden).

## 9. Benim verdiğim kararlar (kontrol edin)

- Hücre ufku **1°**: 0.5° tutulursa boyut iki katına çıkar (~25 MB).
- Seyreltme yöntemi: **her iki değerden birini almak**, ortalama değil.
- `year.bin` ve `cells.bin` **ikili**: JSON olsaydı yaklaşık 2.5 kat büyük olurdu.
- Hücre senaryosunda **3B gösterilmiyor**, bunun yerine not çıkıyor.
- Uyarı metni için `map.json` **yeniden hesaplanmıyor**, yalnızca o tek satır yeniden yazılıyor.
