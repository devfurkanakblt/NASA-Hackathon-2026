# NASA Space Apps: 3B Ay Görev Kontrolü ve Enerji/İletişim Simülatörü

> Challenge: [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)
>
> Bu sürüm, orijinal PDF planına revizyonların işlendiği hâlidir. Farkların özeti dosyanın sonunda.

---

## 1. Hedef ve kazanma yaklaşımı

**3B araziyi, Güneş/Dünya hareketlerini ve görev dayanımını aynı ekranda birleştiren bir web uygulaması geliştirin.** Kullanıcı, seçtiği yer ve tarihte şu soruların yanıtını almalı:

- Güneş ve Dünya, gerçek arazi ufkuna göre nerede?
- Panel ne kadar elektrik üretebilir, batarya ne zaman kritik seviyeye iner?
- Dünya'ya görüş hattı ne zaman açılır ve kapanır?
- Başka bir nokta veya tarih, aynı görev donanımıyla daha uygun sonuç verir mi?

Bu, seçtiğiniz **3B kontrol merkezi + doğrulanabilir sade simülatör** yönüdür. Ana kullanıcı, alternatifleri hızlı değerlendiren görev planlayıcısı; eğitim kullanımı aynı arayüzdeki açıklamalarla desteklenecek. ([Resmî görev](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/))

**Başarı ölçütü:** Kullanıcı üç senaryoyu karşılaştırıp bir dakika içinde *"bu varsayımlar altında hangi seçenek neden daha uygun?"* sorusuna cevap verebilmeli.

Jüri; **Impact, Creativity, Validity, Relevance ve Presentation** alanlarını ayrı ayrı 1–5 arasında değerlendiriyor. Bu nedenle çalışmaların bilimsel geçerliliği, kullanılabilirliği ve anlatımı birlikte güçlü olmalı. ([2026 jüri rehberi](https://www.spaceappschallenge.org/resources/judging-awards-guide/))

### Planın esasları

- Ekip: **3–4 kişi**, teknoloji: **React + TypeScript** (uygulama) ve **Python** (yalnızca çevrim dışı veri ön işleme).
- Başlangıç için mevcut çalışan uygulama olmadığı varsayılıyor.
- Son tarih: **15 Kasım 23.59**. Bunun **UTC mi (= 16 Kasım 02.59 TR) yoksa Türkiye yerel saati mi** olduğu ilk saatte takım panelinden doğrulanacak; Space Apps genellikle etkinliğin yerel saatini esas alır. Doğrulanana kadar daha erken olan saat (23.59 TR) varsayılacak.
- İç teslim hedefi: **15 Kasım 22.00 Türkiye saati**. Varsa daha erken yerel sunum saati de ilk iş doğrulanacak.
- Özgün katkınızın gerekçesini ekip yazacak; AI desteği araştırma, geliştirme ve doğrulama katkısı olarak açıklanacak. ([Teslim rehberi](https://www.spaceappschallenge.org/resources/project-submission-guide/))

---

## 2. Geliştirilecek ürün

### Tek ekran, birbirine bağlı beş görünüm

#### Ufuk panoraması (birincil kanıt görünümü)

- x ekseni azimut (0–360°), y ekseni yükseklik açısı.
- Gerçek arazi ufku siluet olarak; geometrik (düz) ufuk kesikli çizgi olarak.
- Güneş ve Dünya'nın görev süresince izleri çizgi, anlık konumları işaret olarak.
- Bir gök cisminin geometrik ufkun üstünde olup dağın arkasında kaldığı anlar vurgulanacak.
- Bu görünüm 3B'den bağımsız çalışır; 3B gecikirse demo ve jüri kanıtı bu görünümle verilir.

#### 3B görev görünümü (paralel geliştirilir, kesilebilir)

- Seçili noktanın gerçek yükseklik verisinden üretilmiş yerel arazisi.
- Temsili iniş aracı, panel, kuzey yönü ve gerçek konumlarına göre Güneş/Dünya işaretleri.
- Genel arazi kamerası ve iniş aracından ufka bakış.
- Zaman ilerlediğinde gökyüzü, panel durumu ve grafikler birlikte değişecek.
- "Arazi etkisini göster" kontrolü, bir gök cisminin geometrik ufkun üzerinde olmasına rağmen dağ tarafından kapanmasını açıklayacak.

#### Görev ayarları

- Başlangıç tarihi/saat, görev süresi ve seçili bölge.
- Panel alanı, verimi, sabit/ideal takip modu.
- Batarya kapasitesi, başlangıç doluluğu, rezerv sınırı.
- Temel elektrik yükü ve iletişim sırasında ek yük.
- Kabul edilen en uzun Dünya görüşü kesintisi.

#### Zaman çizelgesi ve göstergeler

- Güneş merkezi görünürlük şeridi.
- Dünya merkezi görünürlük şeridi.
- İkisinin birlikte görünür olduğu pencereler.
- Panel üretimi ve planlanan tüketim grafiği.
- Batarya doluluğu; ilk rezerv ihlali.
- Sonraki doğuş/batış ve görüş açılışı/kapanışına kalan süre.

#### Senaryo karşılaştırması

- En fazla üç senaryo sabitlenebilecek.
- Aynı noktanın farklı tarihleri veya farklı noktalar karşılaştırılabilecek.
- Donanım ve görev ayarları bütün senaryolara ortak uygulanacak.
- Zaman çizelgeleri görev başlangıcından itibaren geçen saate hizalanacak; gerçek UTC zamanı ayrıca gösterilecek.
- **+24/+72 saat** düğmeleriyle seçili senaryonun tarihi kaydırılabilecek.
- Sonuç, açık koşullarla gösterilecek: "batarya rezervini koruyor", "iletişim kesintisi sınırını aşıyor" gibi. Gizli ağırlıklardan oluşan tek bir başarı puanı kullanılmayacak.

### Veri kapsamı

Başlangıçta şu üç kaynaklı araştırma noktası kullanılacak:

| Site | Enlem | Boylam (doğu) |
|---|---|---|
| **Connecting Ridge — Site01** | −89.4632° | −137.49° |
| **Shackleton Rim — Site04** | −89.7668° | −171.87° |
| **Peak Near Shackleton — Site07** | −88.811° | 123.6901° |

Bunlar araştırma bölgesi merkezleri olarak etiketlenecek; kesinleşmiş uçuş noktası olarak sunulmayacak. Koordinat kaynağı uygulamadan erişilebilir olacak. ([NASA Lunar Surface Data Book, Tablo A2.1-1](https://ntrs.nasa.gov/api/citations/20250002845/downloads/M2M-30044%20Lunar%20Surface%20Data%20Book%20Baseline_Final.pdf))

Önceden hesaplanan tarih kapsamı **1 Kasım 2026–1 Ocak 2027 UTC**, varsayılan görev başlangıcı **15 Kasım 2026 00.00 UTC**, görev süresi **7 gün** olacak. Kullanıcı 1–30 günlük görev seçebilecek; bütün görev aralığının veri kapsamına sığması gerekecek.

**Kapsam sınırı:** Yarışma sürümünde bu üç nokta tamamlanacak. Tüm Ay için serbest koordinat, rover rotası, iniş dinamiği, termal analiz, uydu röleleri ve ayrıntılı radyo link bütçesi sonraki sürüme bırakılacak.

**Zaman kalırsa ek kapsam (sırasıyla):**

1. Aynı ön işleme pipeline'ıyla 5 m LOLA ürünü bulunan ek noktalar: **Site11 (de Gerlache Rim), Site20 (Leibnitz β plateau), Site23 (Malapert massif)**. Pipeline otomatik olduğu için düşük maliyetlidir ve challenge'daki "curated site list" maddesini güçlendirir.
2. Paylaşılabilir senaryo bağlantısı (ayarların URL'de saklanması).

---

## 3. Bilimsel model ve teknik yapı

### NASA verisi ve arazi ufku

**Güneş ve Dünya konumları JPL Horizons'tan alınacak.** Dünya gökyüzünde sabit varsayılmayacak. Ay yüzeyindeki gözlemci için azimut/yükseklik kullanılacak; koordinatlar doğu pozitif, tarihler UTC, atmosferik kırılma kapalı olacak. Gözlemci yüksekliği bütün hesaplarda **zeminden 2 metre** olarak sabitlenecek. ([Horizons belgeleri](https://ssd.jpl.nasa.gov/horizons/manual.html))

- **İlk saat doğrulaması:** Tek bir Horizons sorgusuyla (`CENTER='coord@301'`, geodetik site koordinatı) Ay yüzeyi gözlemcisinin azimut/yükseklik ve uzaklık çıktısının geldiği doğrulanacak.
- **Yedek yol:** Horizons sorgusu beklenen çıktıyı vermezse veya erişim sorun çıkarırsa aynı hesap **Skyfield** (DE421 efemerisi + Ay PA frame dosyaları) ile yerelde yapılacak.
- **Çapraz kontrol:** İki yol da çalışıyorsa birkaç zamanda Horizons ve Skyfield sonuçları karşılaştırılacak; fark doğrulama bölümünde raporlanacak.

Arazi hesabı:

- Noktanın ilk **7 km çevresinde yerel 5 m/piksel LOLA verisi**.
- **7 km'den itibaren 80 m/piksel bölgesel LOLA verisi.** Başlangıç tarama mesafesi **~100 km**; zaman kalırsa ve kabul testi gerektirirse 250 km'ye çıkarılacak.
- Gözlemci, arazi ve Ay eğriliği aynı koordinat sisteminde hesaplanacak.
- Ufuk profili önceden üretilecek; başlangıç açısal örneklemesi **0,1°** (3600 yön), ışın boyunca adım yakın alanda en fazla **2,5 m**, uzakta **40 m** olacak. Kabul testi geçilmeyen yönlerde örnekleme sıklaştırılacak.
- Hesap parçalara bölünerek yürütülecek; büyük ara matrisler bellekte tutulmayacak.
- DEM boşlukları ve eksik kapsam, sonuçlara açık uyarı olarak taşınacak.

Yerel 5 m ürünler üç bölge için mevcut. Bölgesel 80 m ürün yaklaşık 181 MB; büyük ham veri tarayıcıya hiç gönderilmeyecek, yalnızca türetilmiş ufuk profili ve 3B için küçültülmüş yükseklik ızgarası gönderilecek. Piksel boyutu, mutlak doğruluk olarak sunulmayacak. ([Yerel LOLA ürünleri](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/), [bölgesel veri ve atıf bilgisi](https://pgda.gsfc.nasa.gov/products/90))

> **Önemli uygulama kararı:** Görünürlük ve enerji hesabı, tam arazi verisinden oluşturulan ufuk profilinden gelecek. Ufuk panoraması bu profili doğrudan gösterir. Düşük poligonlu 3B model yalnızca görselleştirme içindir; ekrandaki oyun motoru gölgeleri hesaplama kaynağı olmayacak.

### Enerji modeli

Panel üretimi şu bileşenlerden hesaplanacak:

```
Güneş akısı × panel alanı × verim × sistem katsayısı × geliş açısı etkisi × görünürlük
```

- Nominal Güneş akısı **1 AU'da 1361 W/m²**; efemeristen alınan Güneş uzaklığıyla ters kare düzeltmesi uygulanacak. ([NASA güneş ışınımı açıklaması](https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science))
- Sabit panelde Güneş doğrultusu ile panel normalinin açısı kullanılacak.
- İdeal takip modunda panel Güneş'e dik kabul edilecek.
- Güneş merkezi arazi ufkunun altındaysa üretim sıfır olacak.
- Kısmi Güneş diski, tutulmalar ve ayrıntılı sıcaklık etkileri modellenmeyecek; bu sınırlar model açıklamasında gösterilecek.

Başlangıç değerleri **örnek görev donanımı varsayımları** olarak etiketlenecek:

| Parametre | Varsayılan |
|---|---|
| Panel | **2 m²**, verim **%25**, sistem katsayısı **0,8** |
| Panel modu | **ideal takip** |
| Batarya | **5 kWh**, başlangıç **%80**, rezerv **%20** |
| Şarj/deşarj verimi | **%90** |
| Temel talep | **200 W** |
| Dünya görünürken ek iletişim talebi | **100 W** |

Batarya enerji dengesi zaman adımıyla hesaplanacak; doluluk kapasite sınırları içinde tutulacak. Enerji biterse karşılanamayan talep ayrıca kaydedilecek. Karşılaştırmalarda ilk rezerv ihlali ve karşılanamayan enerji gösterilecek.

Enerji/batarya motoru **TypeScript ile tarayıcıda** çalışacak; böylece kullanıcı ayar değiştirdiğinde sonuç ağ isteği olmadan anında güncellenir.

### İletişim modeli

Dünya merkezi arazi ufkunun üzerindeyse **Dünya görüş hattı açık** kabul edilecek. Toplam görüş süresi, en uzun kesinti ve sonraki pencere hesaplanacak.

Varsayılan kabul edilen kesinti **6 saat**, kullanıcı tarafından değiştirilebilir olacak. Bu model; yer istasyonu erişimi, anten kazancı veya garantili bağlantı kapasitesi iddiası taşımayacak.

### Mimari: çalışma zamanında sunucu yok

Sistem iki ayrı parçadan oluşur:

1. **Çevrim dışı ön işleme (Python):** NASA verilerini indirir, ufuk profillerini ve efemerisi hesaplar, sonuçları statik JSON dosyalarına yazar. Yalnızca ekip bilgisayarında çalışır.
2. **Statik web uygulaması (React + TypeScript):** JSON dosyalarını yükler; görünürlük, enerji, batarya ve karşılaştırma hesaplarını tarayıcıda yapar.

| Katman | Teknoloji |
|---|---|
| Uygulama durumu, kontroller, karşılaştırma | **React + TypeScript (Vite)** |
| Senaryo değerlendirme, enerji/batarya motoru | **TypeScript** (saf fonksiyonlar, birim testli) |
| Ufuk panoraması, zaman çizelgeleri, enerji grafikleri | **ECharts** |
| 3B sahne | **Three.js / React Three Fiber** |
| Efemeris ön işleme | **Python** + Horizons API (yedek: **Skyfield**) |
| Arazi ön işleme | **NumPy, Rasterio, PyProj** |
| Ham veri ve ara sonuç önbelleği | Ekip bilgisayarında dosya önbelleği (repoya ham DEM eklenmez) |

### Veri sözleşmesi

Ön işleme şu dosyaları üretir (`public/data/` altında):

- `sites.json` — site listesi: kimlik, ad, koordinatlar, kaynaklar, kullanılabilir tarih aralığı, DEM uyarıları.
- `{siteId}/ephemeris.json` — **10 dakikalık** adımlarla UTC zaman, Güneş ve Dünya azimut/yükseklik, Güneş uzaklığı, kaynak (Horizons/Skyfield) ve üretim ayarları.
- `{siteId}/horizon.json` — 0,1° azimut adımlarıyla arazi ufku yükseklik açısı, tarama mesafesi, çözünürlük ve boşluk uyarıları.
- `{siteId}/terrain.json` (veya ikili dosya) — 3B için küçültülmüş yerel yükseklik ızgarası.

Uygulamadaki ana hesap fonksiyonu:

```ts
evaluateScenarios(
  candidates: { siteId: string; startUtc: string }[], // en fazla 3
  settings: MissionSettings                          // ortak görev/donanım ayarları
): ScenarioResult[] // konum serileri, görünürlük aralıkları, güç, batarya, özetler, kaynak/model bilgisi
```

Zaman sürgüsü yüklenmiş seriyi oynatır; hiçbir kullanıcı işlemi yeni NASA isteği oluşturmaz.

Horizons çağrıları yalnızca Python ön işleme üzerinden, tek sıra halinde yapılacak; önbellek, hata durumunda bekleme ve uygulamayı tanımlayan User-Agent kullanılacak. Tarayıcı JPL API'sine hiç bağlanmayacak. ([JPL kullanım politikası](https://ssd-api.jpl.nasa.gov/))

### Yayın

- Derlenmiş statik uygulama **Vercel** veya **GitHub Pages** üzerinde yayınlanacak. Uyku moduna geçen sunucu ve soğuk başlangıç riski yoktur.
- Aynı derleme (`dist/`) ekip bilgisayarında internet olmadan yerel olarak açılabilecek; demo bulut bağlantısına bağımlı kalmayacak.

---

## 4. Ekip dağılımı ve çalışma takvimi

### Sorumluluklar

- **Kişi A — Bilimsel veri ve ön işleme:** Horizons (ve Skyfield yedeği), koordinatlar, DEM, ufuk profilleri, JSON veri sözleşmesi ve dosyaların üretimi.
- **Kişi B — Arayüz, ufuk panoraması ve karşılaştırma:** ekran düzeni, kontroller, ufuk panoraması, zaman çizelgeleri, senaryo yönetimi.
- **Kişi C — 3B deneyim (paralel):** arazi modeli, kameralar, Güneş/Dünya işaretleri, performans. 3B gecikirse ürün ve demo panorama ile tamamlanır.
- **Kişi D — Simülasyon ve teslim:** TypeScript enerji/batarya ve görünürlük motoru, birim testleri, proje metni ve sunum koordinasyonu. Gerçek veri gelene kadar sentetik/analitik seriyle çalışır.

Üç kişiyseniz **B ve C birleşecek**. Bu durumda önce panorama ve karşılaştırma bitirilecek; 3B görünüm yalnızca tek kamera ve sade malzemelerle, zaman kalırsa eklenecek. Sunum metnini herkes kendi modülü için kısa maddelerle besleyecek.

### Takvim — bütün saatler Türkiye saati

#### 14 Kasım 21.00–22.00 — Kapsamı ve bağlantıları kilitleyin

- Takım üyelerini, seçili challenge'ı, **son teslim saatini (UTC mi yerel mi)** ve yerel sunum saatini doğrulayın.
- Ortak repo, **JSON veri sözleşmesi**, birim ve koordinat kurallarını belirleyin.
- Tek bir Horizons sorgusuyla Ay yüzeyi gözlemcisi çıktısını doğrulayın; olmazsa Skyfield'e geçme kararını şimdi verin.
- Üç noktanın verilerini indirmeye başlayın.
- Herkesin sonunda göstereceği çalışan çıktıyı yazın.

#### 22.00–15 Kasım 01.00 — İlk uçtan uca akış

- Tek nokta için gerçek efemeris verisini JSON'a yazıp ekrana getirin.
- Ufuk panoraması (başta geometrik ufukla), Güneş/Dünya işaretleri ve zaman sürgüsünü bağlayın.
- Panel/batarya motorunu analitik örneklerle çalıştırın.
- 3B tarafında basit arazi ve Güneş/Dünya işaretleriyle sahne iskeleti kurun.

> **Kontrol kapısı:** Bir tarih değiştiğinde gerçek açı, görünürlük ve enerji çıktısı birlikte değişmeli.

#### 01.00–03.00 — Bilimsel çekirdeği bağlayın

- İlk gerçek arazi ufkunu (0,1°, ~100 km) üretip panoramaya entegre edin.
- Aynı verinin panorama, 3B görünüm ve grafiklerde kullanıldığını doğrulayın.
- Diğer iki noktanın ön hesaplarını başlatın.

#### 03.00–08.00 — Ön hesaplar ve dinlenme

- Uzun veri işlerini otomatik yürütün.
- Ekibin tamamını sabaha kadar ayakta tutmayın; bir sonraki günün test ve sunum çalışmasına kapasite bırakın.

#### 08.00–12.00 — Üç nokta ve simülatör

- Üç noktanın verilerini tamamlayın; ufuk kabul testini çalıştırın, gereken yönleri inceltin.
- Panel ayarları, batarya, kesinti ölçütleri ve karşılaştırmayı bitirin.
- Kaynak/model bilgisi bölümünü ekleyin.

#### 12.00–15.00 — Entegrasyon ve gerçek demo seçimi

- Tarih kaydırma, senaryo kopyalama ve eşzamanlı oynatmayı tamamlayın.
- 3B görünümü entegre edin; hazır değilse bu noktada kapsam dışı bırakma kararını verin.
- Gerçek veride arazi etkisini ve donanım değişimini iyi anlatan örnek bulun.
- Hikâyeye uygun sonuç üretmek için veriyi veya varsayımları gizlice değiştirmeyin.
- Zaman varsa ek siteleri (Site11/20/23) pipeline'a ekleyin.

#### 15.00–17.00 — Test ve yayın

- Sayısal kontrolleri, kullanıcı denemesini ve statik yayın testini yapın.
- **17.00'de özellik eklemeyi durdurun.**

#### 17.00–20.00 — Sunum ve proje sayfası

- İngilizce yedi slaytı ve proje açıklamasını tamamlayın.
- Kaynakları, lisansları, AI katkısını ve model sınırlarını yazın.
- Canlı ve yerel (internetsiz) demo provasını yapın.

#### 20.00–22.00 — Teslim

- Herkese açık bağlantıları oturumsuz tarayıcıda sınayın.
- Formu tamamlayıp **Submit for Judging** işlemini yapın.
- Başarılı teslim mesajını ve nihai bağlantıları kaydedin.

Yerel jüri daha erken bir saat belirlediyse bu kilometre taşları o saate göre öne çekilecek.

---

## 5. Doğrulama, jüri demosu ve teslim

### Kabul testleri

- **Koordinat/efemeris:** üç noktanın her birinde en az 10 zaman için JSON'daki değerlerle aynı ayarlı Horizons çıktısı arasında azimut/yükseklik farkı en fazla **0,01°**. Bu, veri aktarım testidir. Skyfield kullanıldıysa aynı karşılaştırma Skyfield–Horizons arasında yapılıp fark raporlanacak.
- **Ufuk:** 32 sabit yönde ve demo geçişlerinde örnekleme adımları yarıya indirildiğinde değişim hedefi **≤0,05°**; ayrıca tarama mesafesi 100 km'den 250 km'ye çıkarıldığında demo yönlerinde değişim kontrol edilecek. Geçilmezse ilgili yön ince hesaplanacak; bu değer DEM'in fiziksel doğruluğu olarak sunulmayacak.
- **Zaman:** seçili doğuş/batışlar 1 dakikalık referans serisiyle kontrol edilecek. Küçük açı hatasının kutupta büyük zaman farkına dönüşebileceği belirtilecek.
- **Enerji:** gece ve ters yönlü panelde sıfır üretim; doğru Wh/W dönüşümü; kapasite, rezerv ve karşılanamayan talep hesapları (TypeScript birim testleri).
- **Görünürlük:** hiç doğmayan/batmayan hedefler, 359°→0° azimut geçişi ve veri aralığının sonunda başlayan pencereler.
- **Kullanım:** UTC dönüşümü, kapsam dışı tarih, DEM boşluğu, eksik veri dosyası ve WebGL hatası (3B açılmazsa panorama ve grafikler çalışmaya devam etmeli).
- **Performans:** üç senaryonun ayar değişiminden sonra yaklaşık iki saniye içinde sonuçlanması; ilk yüklemeden sonra hiçbir ağ isteği yapılmaması; zaman sürgüsünün akıcı çalışması.
- **Demo dayanıklılığı:** yerel derleme internet kapalıyken çalışmalı; bulut sürümünde hata olursa aynı senaryo yerelde açılabilmeli.

En az üç kişiye açıklama yapmadan şu görevi verin: **"İki senaryodan hangisi batarya rezervini koruyor ve daha kısa Dünya görüşü kesintisi yaşıyor?"** Bir dakika içinde doğru gerekçeyi bulamıyorlarsa son saatleri yeni özelliğe değil arayüze ayırın.

### Yedi slaytlık resmî demo

1. **Problem ve vaat:** iniş yeri/tarihi, enerji ve iletişimi birlikte etkiler.
2. **Kullanıcı akışı:** yer → tarih → görev donanımı → karşılaştırma.
3. **Arazi kanıtı:** ufuk panoramasında (ve varsa 3B görünümde) gerçek arazi ufkunun Güneş veya Dünya'yı kapatması.
4. **Enerji kanıtı:** panel/batarya ayarı değişince sonuçların değişmesi.
5. **Karşılaştırma:** aynı donanımla üç seçeneğin gerekçeli değerlendirmesi.
6. **Bilimsel temel:** NASA verileri, doğrulama sonuçları ve model sınırları.
7. **Etki ve erişim:** çalışan uygulama, kaynak kod, ekip ve sonraki adım.

Resmî demo olarak **toplam yedi İngilizce slayt** kullanılacak. Yerel sunumda gösterilecek kısa ekran kaydı ayrıca hazırlanabilir; resmî demo sınırı aşılmayacak. ([Demo kuralları](https://www.spaceappschallenge.org/resources/project-submission-guide/))

### Tamamlanmış sayılacak teslim

- [ ] Herkese açık çalışan statik uygulama ve internetsiz yerel yedek.
- [ ] Açık kaynak repo; **MIT lisansı**, kurulum, ön işleme ve model açıklaması.
- [ ] Üç nokta için kaynaklı veri (JSON) ve tekrarlanabilir ön işleme scriptleri.
- [ ] Doğrulama sonuçları; ölçülmemiş doğruluk iddiası içermeyen açıklamalar.
- [ ] Yedi İngilizce slayt.
- [x] NASA/veri/kütüphane atıfları ve açık AI kullanım beyanı.
- [ ] **Save Progress yerine Submit for Judging ile tamamlanmış, başarı mesajı görülmüş teslim.**

**Son öncelik sırası:** doğru veri ve hesap → çalışan karşılaştırma → ufuk panoraması → anlaşılır 3B deneyim → güçlü sunum. Bir modül gecikirse önce ek görsel efektleri, sonra 3B görünümü çıkarın; bilimsel çekirdeği, karşılaştırmayı ve teslim zamanını koruyun.

---

## Orijinal PDF planından farklar

| Konu | Orijinal | Bu sürüm |
|---|---|---|
| Backend | FastAPI + SQLite, Docker, Render | Çalışma zamanında sunucu yok; Python yalnızca ön işleme, statik JSON |
| API | `GET /sites`, `POST /scenarios/evaluate` | `sites.json` + site başına JSON dosyaları, tarayıcıda `evaluateScenarios()` |
| Yayın | Render | Vercel veya GitHub Pages (statik) |
| Ufuk örneklemesi | 0,01°, 250 km | Başlangıçta 0,1°, ~100 km; kabul testine göre inceltilir |
| Efemeris | Yalnızca Horizons | Horizons + Skyfield yedeği ve çapraz kontrol |
| Kanıt görünümü | 3B görünüm | 2B ufuk panoraması birincil; 3B paralel ve kesilebilir |
| Son teslim | 23.59 UTC varsayımı | UTC/yerel saat doğrulanana kadar 23.59 TR varsayımı |
| Ek kapsam | Paylaşılabilir bağlantı | Önce Site11/20/23, sonra paylaşılabilir bağlantı |
