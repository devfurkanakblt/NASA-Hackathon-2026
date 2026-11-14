# Ekip notları

Her kişinin altında, o kişinin bilmesi gerekenler listelenir. Satır başı kimden geldiğini gösterir (`A->` = A'dan).
Veri formatının tamamı: [`docs/data-contract.md`](data-contract.md). Gerçek veri PR #1 merge edilince `main`'de.

## A:

- _(henüz not yok — B/C/D, A'ya iletmek istediklerinizi `B-> ...` şeklinde buraya ekleyin)_

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

