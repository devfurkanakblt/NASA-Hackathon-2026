# A — Kapsam genişletme planı

> Durum: 14 Kasım 2026. Teslim: 15 Kasım 23.59 yerel saat (TR) (iç hedef 22.00 TR).
> Kaynak: challenge metni ([Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)) ile mevcut repo karşılaştırması.

---

## 0. Uygulama durumu (14 Kas, gece)

Branch: `feat/plan-a-expansion`. Ayrıntılı sayılar: `docs/validation.md` §5–6, `docs/reference/visibility.md`.

| İş | Durum | Not / plandan sapma |
|---|---|---|
| P1 bölgesel harita | `preprocess/regional_map.py` → `{site}/map.json` | **Paylaşılan uzak ufuk kullanılmadı.** Tek hücre tam menzilde (250 km) yeterince hızlı (0.8–1.6 s). Bu sayede 3 km kaymada derecelerce olan azimut hatası tamamen ortadan kalktı. Tek yaklaşım azimut adımı: 0.5° (site değerlerinde ≤ 0.01 puan fark). Izgara: 100 m (61×61) Site01/04/04R/07; 200 m (31×31) Site11/20/23. |
| P1.6 doğrulama | `preprocess/map_check.py` → validation §6 | 7 harita, merkez + 6 rastgele hücre vs tam 0.1° ufuk: ≤ 0.06 puan. Site04 haritasında Site04R hücresi en iyi %0.2 içinde (tutarlılık kontrolü geçti). |
| P2 1 yıl | `preprocess/season.py` → `{site}/season.json` | Tam yıllık seri yayımlanmadı (6× boyut); aylık özet tablo var. Kas–Ara örnekleri referansla birebir aynı (9/9). |
| P3 dış doğrulama | `preprocess/external.py` → validation §5 | PGDA'da Mazarico ürünleri bulundu (AVGVISIB Güneş/Dünya, LPSR). 18.6 yıllık karşılaştırma: 7/7 site 3×3 piksel aralığında, Spearman 0.96 / 0.96. Shackleton tabanı iki modelde de kalıcı gölge. |
| P4 Site11/20/23 | eklendi | Koordinatlar M2M-30044 (2025) Tablo A2.1-1. 2023 Rev A tablosunda satırlar kaymış; kullanılmamalı. 80 m DEM'in −80° sınırı için kapsam kontrolü eklendi (`horizon.coverage_check`): Site20/23'te bazı ışınlar DEM'den çıkıyor ama ufku etkileyemiyor. |
| P4 karşıtlık | **CE6 (uzak yüz) ve Apollo11 ikisi de** eklendi | Global LDEM_64'ten yalnızca gereken satırlar HTTP range ile okunuyor (`preprocess/global_dem.py`). CE6 yüzey yüksekliği −5254.8 m, LROC'un değeri −5256 m. Bu noktalar için harita üretilmedi (474 m/px DEM). |
| P5 metinler | `LICENSE`, `docs/data-methods.md`, `docs/slide6-scientific-basis.md` | AI beyanı ve atıflar `data-methods.md` içinde. |

| P2 devamı: 1 yıllık seri (15 Kas) | `preprocess/extended.py` → `{site}/year.bin` (9 site) | İlk yüklemeye girmiyor; görev 2 ayı aşınca o sitenin dosyası indiriliyor. Tarih seçici 1 Kas 2027'ye kadar. Skyfield ile tüm yıl karşılaştırıldı: ≤ 0.00003° (validation §1b). |
| P1 devamı: hücre simülasyonu (15 Kas) | `preprocess/extended.py` → `{site}/cells.bin` (7 harita sitesi) | Haritadaki her hücre ve ±3 km içindeki serbest enlem/boylam tam senaryo olarak simüle ediliyor (1° ufuk, efemeris hücreye döndürülüyor, `src/sim/cell.ts`). `map.json` ile fark ≤ 0.15 puan (validation §7). |

Açık soruların cevapları: (1) İlk yüklemede aylık özet (`season.json`); tam yıllık seri `year.bin` olarak ayrı ve yalnızca gerektiğinde yükleniyor. (2) Harita renkleri 2 aylık özet; ama tıklanan hücre (veya ±3 km içinde girilen koordinat) artık tam simülasyon alıyor (zaman serisi + enerji), 1° ufukla. (3) İki karşıtlık noktası da eklendi. (4) Son teslim **yerel saatle 15 Kas 23.59** (TR).

Açık kalan, isteğe bağlı iş: §5'teki C maddesi (`map.json` katmanlarını 3B araziye doku olarak giydirmek) yapılmadı; not `docs/ekip-notlari.md` → C bölümünde.

---

## 1. Şu an elimizde olan

- 4 nokta (Site01, Site04, Site07, türetilmiş Site04R), 1 Kas 2026 – 1 Oca 2027, 10 dk adım.
- Güneş/Dünya az/el/uzaklık: JPL Horizons; Skyfield ile çapraz kontrol (fark ≤ 0.00006°).
- Arazi ufku: 3600 yön, 250 km, yakınsama ≤ 0.019°.
- Veri aktarımı (Horizons'a bağımsız yeniden sorgu) ve doğuş/batış zamanlaması (1 dk referans, < 0.5 dk) testleri geçiyor (`docs/validation.md`).
- B/D için beklenen değerler: `docs/reference/visibility.{json,md}`.

**Sonuç:** Bu 4 nokta ve 2 ay için sayılar iç tutarlılık açısından güvenilir. Ancak aşağıdaki eksikler nedeniyle kapsam challenge'ın istediğinden dar.

## 2. Eksikler

| # | Eksik | Neden önemli | Challenge'daki karşılığı |
|---|---|---|---|
| E1 | **Yalnızca sabit tek noktalar.** Bölge içinde alternatif nokta değerlendirilemiyor. | Site04 örneği: katalog noktası %27 Güneş, 1.9 km ötedeki sırt %100. Tek noktadan bölge hakkında hüküm vermek yanıltıcı. | "evaluate alternative sites in the same region", "why small location changes have large impacts" |
| E2 | **Serbest koordinat girişi yok.** | Kullanıcı yalnızca bizim seçtiğimiz noktaları görebiliyor. | "ability to input custom lunar coordinates" |
| E3 | **Zaman kapsamı 2 ay, tek mevsim.** | Kutupta aydınlanma mevsime göre çok değişir; 2 aylık yüzdeler genellenemez. | "across different lunar days or seasons" |
| E4 | **Bağımsız dış doğrulama yok.** | Tüm testler kendi zincirimizi kendi içinde kontrol ediyor. Jüri kriteri: Validity. | "Data and accuracy" |
| E5 | **Site listesi dar** (yalnızca 3 güney kutbu noktası). | Karşıtlık örneği yok (ör. Dünya'nın hiç görünmediği uzak yüz). | "curated list … Apollo, CLPS, other countries" |
| E6 | **Eğim bilgisi yok.** | İniş için eğim temel kısıt; Site04 noktası ~32° duvarda. | "represent steep slopes and deep craters" |
| E7 | **Metinler yazılmadı**: Data & Methods, slayt 6, LICENSE, atıflar, AI beyanı. | Teslim şartı. | Teslim rehberi |

## 3. Plan (öncelik sırasıyla)

### P1 — Bölgesel aydınlanma / Dünya görünürlük haritası (E1, E2, E6)

**Amaç:** Her site çevresindeki bir ızgarada, her nokta için görünürlük ve eğim değerleri. Arayüzde haritaya tıklanınca o noktanın sonucu gösterilir.

Adımlar:
1. **Süre ölçümü:** Mevcut `horizon.py` ile tek nokta süresini ölç. Izgara boyutunu buna göre seç (hedef: site başına ≤ 30 dk hesap).
2. **Hızlı ufuk modu:**
   - 1° azimut (360 yön).
   - Yakın arazi (≤ ~20 km) her nokta için ayrı hesaplanır.
   - Uzak ufuk (20–250 km) ızgara merkezinden bir kez hesaplanır ve tüm noktalarda paylaşılır.
   - Bu yaklaşımın hatası, birkaç noktada tam hesapla karşılaştırılıp raporlanacak (kabul: ≤ 0.1°).
3. **Nokta başına Güneş/Dünya yönü:**
   - Güneş/Dünya vektörü Ay-sabit çerçevede bir kez hesaplanır (Skyfield, Horizons ile doğrulanmış).
   - Her ızgara noktasının yerel ENU çerçevesine döndürülür.
   - Kutupta birkaç km, azimutu derecelerce değiştirir; bu yüzden döndürme şart.
4. **Izgara:**
   - Başlangıç: site merkezli 6×6 km, 200 m aralık (31×31 = 961 nokta).
   - Süre izin verirse 100 m'ye inilecek.
5. **Nokta başına çıktılar:**
   - Güneş %, Dünya %, ikisi birden %.
   - En uzun Güneşsiz süre, en uzun Dünya'sız süre.
   - Eğim (25 m taban, `ridge.py` ile aynı yöntem).
6. **Doğrulama:**
   - Site merkezi hücresi, mevcut tam çözünürlüklü `horizon.json` sonucu ile karşılaştırılacak.
   - Site04R konumu haritada en iyi bölgelerden biri olarak çıkmalı (tutarlılık kontrolü).

**Önerilen dosya:** `public/data/<siteId>/map.json`. Kesinleşmeden önce B/D ile `docs/data-contract.md`'ye eklenecek.

```json
{
  "version": 1,
  "siteId": "Site01",
  "grid": { "nx": 31, "ny": 31, "spacingM": 200, "originENU": "site center",
            "order": "row-major, row 0 = south, col 0 = west" },
  "latDeg": [...], "lonDeg": [...],
  "sunPct": [...], "earthPct": [...], "bothPct": [...],
  "longestNoSunS": [...], "longestNoEarthS": [...],
  "slopeDeg": [...],
  "method": "1 deg azimuth, near field per point (<= 20 km), shared far field",
  "coverage": { "startUtc": "...", "endUtc": "...", "stepS": 600 }
}
```

Sınır: Bu harita yalnızca site bölgeleri içinde "serbest koordinat" sağlar; tüm Ay için serbest koordinat kapsam dışı kalır ve bu açıkça yazılacak.

### P2 — Zaman kapsamını 1 yıla uzatmak (E3, E4'e destek)

- Ufuk değişmez; yalnızca efemeris yeniden sorgulanır.
- Önerilen aralık: 1 Kas 2026 – 1 Kas 2027.
- Adım:
  - Ana seri 10 dk kalır (site başına dosya ~6× büyür; ölçülüp karar verilecek).
  - Gerekirse uzun seri ayrı bir dosyada 30 dk adımla tutulur.
- Arayüz için aylık özet tablo: ay başına Güneş % / Dünya %. Mevsim farkı tek grafikle anlatılabilir.
- Doğrulama testleri (`validate.py`) ve referans değerler (`reference.py`) yeni kapsamla yeniden üretilecek.
- Arka planda P1 ile paralel çalışabilir.

### P3 — Dış doğrulama (E4)

- Yayınlanmış aydınlanma sonuçlarıyla karşılaştırma:
  - Mazarico et al. 2011 (Icarus).
  - Barker et al. 2021 site ürünleri.
  - PGDA'da aydınlanma/görünürlük haritası olup olmadığı **kontrol edilecek**.
- Uzun dönem ortalama ile kendi değerimiz farklı dönemlere ait. Bu yüzden karşılaştırma "aynı mertebede mi, sıralama aynı mı" düzeyinde yapılıp öyle raporlanacak.
- Bulunamazsa: aynı yöntemle bilinen bir ölçütü yeniden üretmek. Örneğin Shackleton iç tabanının hiç Güneş görmemesi (kalıcı gölge).
- Çıktı: `docs/validation.md`'ye §5 "Dış karşılaştırma".

### P4 — Site listesini genişletmek (E5)

1. **Site11 (de Gerlache Rim), Site20 (Leibnitz β plateau), Site23 (Malapert massif):**
   - 5 m LOLA ürünü var; mevcut pipeline ile düşük maliyet.
   - Koordinatlar Lunar Surface Data Book Tablo A2.1-1'den alınacak.
2. **Karşıtlık noktası (biri yeterli):**
   - Uzak yüz, ör. Chang'e-6 iniş bölgesi: Dünya hiç görünmez.
   - Veya bir Apollo noktası: Dünya gökyüzünde neredeyse sabit, Güneş ~14 gün görünür / ~14 gün görünmez.
   - Koordinatlar resmî kaynaktan **doğrulanarak** alınacak.
   - Kutup dışı nokta için 80 m kutup DEM'i kapsamaz; global LOLA DEM gerekir. Uzak ufuk orta enlemde düşük olduğundan kaba çözünürlük yeterli, ama ufuk hesabında kapsam kontrolü eklenmeli.
   - Bu nokta eğitim amaçlı "karşılaştırma" etiketiyle sunulacak.

### P5 — Metinler (E7)

- `LICENSE` (MIT).
- `docs/data-methods.md`: proje sayfasındaki "Data & Methods" metni (İngilizce).
- Slayt 6 içeriği:
  - Veri kaynakları.
  - Doğrulama tablosu.
  - Model sınırları: tek gözlemci yüksekliği 2 m, kısmi disk yaklaşımı, DEM doğruluğu iddia edilmez, zaman hassasiyeti uyarısı.
- Atıf listesi:
  - LOLA (Barker 2021/2023), Horizons, Skyfield/DE421, Lunar Surface Data Book.
  - P3/P4'te eklenenler.
- AI kullanım beyanı (A kısmı).
- P1–P4 sonuçları netleşince son hâline getirilecek. Taslak P1 ile paralel başlayabilir.

## 4. Takvim önerisi (TR saati)

| Zaman | İş |
|---|---|
| 14 Kas akşam | P1.1 süre ölçümü; `map.json` formatını B/D ile kilitle; P2 sorgularını arka planda başlat |
| 14 Kas gece | P1 hızlı ufuk + yön döndürme + 1 site haritası, doğrulama |
| 15 Kas 03–08 | Diğer sitelerin haritaları ve P2 otomatik çalışır |
| 15 Kas 08–12 | P3 dış karşılaştırma, P4 Site11/20/23 |
| 15 Kas 12–15 | P4 karşıtlık noktası (zaman kalırsa), referans değerleri yeniden üret |
| 15 Kas 15–17 | P5 metinler; 17.00'de veri dondurulur |
| 15 Kas 17–22 | Slayt 6, sunum desteği, teslim |

**Kesme sırası** (zaman yetmezse en sondaki ilk çıkar): P4 karşıtlık noktası → P4 Site11/20/23 → P2'nin 1 yıla uzatılması (3–4 aya düşürülür) → P1 çözünürlüğü (200 m → 400 m). P1'in en az bir sitede çalışan hâli ve P5 korunur.

## 5. B / C / D'ye etkiler

- **B:**
  - Yeni harita görünümü: ızgara ısı haritası, Güneş % / Dünya % / eğim katmanları.
  - Tıklanan hücre bir senaryo noktası gibi karşılaştırmaya eklenebilmeli.
- **C:**
  - `map.json` değerleri `terrain.json` üzerine doku olarak giydirilebilir (aynı ENU ızgara mantığı).
  - Eğim katmanı 3B'de anlamlı.
- **D:**
  - Harita hücreleri için tam zaman serisi yok, yalnızca özet var. Enerji simülasyonu yalnızca tam ufku olan noktalarda çalışır.
  - Kullanıcı bir hücreyi seçerse arayüz bunu açıkça "özet değer" diye belirtmeli. Alternatif: seçilen birkaç hücre için tam `horizon.json` üretilir.
  - 1 yıllık kapsamda tarih seçici sınırları güncellenmeli.

## 6. Açık sorular

1. 1 yıllık efemeris için dosya boyutu sınırı ne olmalı (ilk yükleme süresi)?
2. Harita hücresi seçildiğinde tam simülasyon isteniyor mu? İsteniyorsa kaç hücre için tam ufuk üretilecek?
3. Karşıtlık noktası olarak hangisi: uzak yüz mü, Apollo mu?
4. Son teslim saatinin UTC mi yerel mi olduğu doğrulandı mı?
