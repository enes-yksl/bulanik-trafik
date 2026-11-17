# Bulanık Trafik — Bulanık Mantıkla Uyarlanabilir Sinyal Kontrolü

İzole bir kavşakta trafik sinyali kontrolü için **bulanık çıkarım (Mamdani)**, **genetik-bulanık optimizasyon** ve **Q-öğrenme** yöntemlerini klasik yöntemlerle karşılaştıran, tarayıcıda çalışan bir araştırma ve eğitim simülatörü.

**Canlı demo:** https://enes-yksl.github.io/bulanik-trafik/

## Bölümler

| Sekme | İçerik |
|---|---|
| **Simülatör** | Tek kavşak. Aynı rastgele araç akışı altında iki denetleyiciyi yan yana izleme. 9 senaryo ve 4 talep profili sunulur. Canlı bulanık çıkarım paneli ve düzenlenebilir kural tabanı vardır. |
| **Ağ Simülasyonu** | Çok kavşaklı yol ağları: ana arter koridoru (1×3) ve 2×2, 2×3, 3×3 ızgaralar. Araçlar kavşaklarda sağa ya da sola döner. Kuyruklar önceki kavşağa taşabilir (geri taşma). Sola dönenler karşı akıma yol verir (izinli dönüş, 30 m dönüş cebi). Yeşil dalga (koordineli plan) ve göbekli dönel kavşak seçenekleri, iki ağın yan yana karşılaştırması, kavşağa yakınlaştırma ve ağlar arası toplu deney sunulur. |
| **Deney Laboratuvarı** | Senaryo × denetleyici × tekrar biçiminde toplu deneyler. %95 güven aralığı, Holm düzeltmeli eşleştirilmiş t-testi, HCM hizmet düzeyi (LOS), çok ölçütlü sonuçlar, talep duyarlılık analizi ve CSV dışa aktarımı içerir. |
| **Optimizasyon** | Genetik algoritmayla üyelik fonksiyonu ve kural tabanı arama. Ablasyon için üç mod vardır. Tablo tabanlı Q-öğrenme ajanı eğitilir ve politikası ısı haritasıyla gösterilir. Sonuçlar eğitim ve test tohumları ayrı tutularak raporlanır. |
| **Yöntem ve Literatür** | Kuramsal temel, formüller, model varsayımları, deney tasarımı ve kaynakça. |
| **Analizler** | Araştırma soruları ve hipotezler (AS1–AS6), 17 analizlik plan, geçerlilik tehditleri ve son deneyin otomatik bulguları. |

## Denetleyiciler

| Denetleyici | Açıklama |
|---|---|
| Sabit süreli | Her faz için kullanıcı tanımlı yeşil süresi |
| Webster | Optimum döngü C₀ = (1,5L + 5) / (1 − Y) ve kritik akım oranına göre bölünen yeşil (Webster, 1958) |
| Araç tetiklemeli | En kısa yeşil 7 s, geçiş süresi 3 s, varlık dedektörü 40 m geride, maksimum yeşil sınırı (Signal Timing Manual, 2015) |
| Bulanık (Mamdani) | 2 girdi (yeşil ve kırmızı yöndeki araç sayısı), 1 çıktı (uzatma süresi), 9 kural. Min–max çıkarım, ağırlık merkezi durulaştırma |
| Bulanık + GA | Üyelik merkezleri ve kural sonuçları genetik algoritmayla optimize edilmiş bulanık sistem |
| Q-öğrenme | 144 durum × 2 eylem (sürdür / değiştir) tablo tabanlı ajan |
| Yeşil dalga (yalnız ağ) | Ortak döngü ve doğu yönü için ofset θ = x / v<sub>p</sub> mod C |
| Dönel kavşak (yalnız ağ) | Sinyalsiz, göbekli tek şeritli halka. Girişte yol ver kuralı, kritik aralık 4,2 s, takip aralığı 2,2 s. HCM kapasite modeline göre kalibre edildi. |

## Örnek sonuç

9 senaryo × 6 denetleyici × 10 tekrar, 30 dk simülasyon, 5 dk ısınma. Değerler araç başına ortalama gecikmedir (s). GA karma senaryoda eğitilmiştir.

| Senaryo | Sabit | Webster | Tetiklemeli | Bulanık | Bulanık+GA | Q-öğrenme |
|---|---|---|---|---|---|---|
| Dengeli | 18,2 | 16,3 | 13,5 | 19,2 | **12,8** | 19,4 |
| Ana yol – tali yol | 186,4 | 19,1 | 14,3 | 16,8 | **13,7** | 18,7 |
| Kayan talep | 33,8 | 34,6 | 13,3 | 17,1 | **13,1** | 17,7 |
| Ani artış | 32,7 | 28,7 | 17,2 | 22,0 | **16,6** | 25,4 |

GA ile ayarlanmış bulanık denetleyici, Holm düzeltmeli eşleştirilmiş t-testine göre şu sonuçları verdi:
- Sabit süreliye göre 9/9 senaryoda anlamlı olarak daha düşük gecikme.
- Webster'e göre 7/9 senaryoda anlamlı olarak daha düşük gecikme.
- Elle tasarlanmış bulanık sisteme göre 7/9 senaryoda anlamlı olarak daha düşük gecikme.
- Araç tetiklemeli kontrole göre 8/9 senaryoda anlamlı fark yok (denk performans), 1 senaryoda anlamlı olarak daha iyi.

### Ağ ölçeği

4 ağ × 8 denetleyici × 5 tekrar, 20 dk simülasyon, 5 dk ısınma, %15 sola ve %15 sağa dönüş. Değerler yolculuk başına ortalama gecikmedir (s).

| Ağ | Sabit | Webster | Yeşil dalga | Tetiklemeli | Bulanık | Bulanık+GA | Q-öğrenme | Dönel kavşak |
|---|---|---|---|---|---|---|---|---|
| Koridor 1×3 | 140,7 | 39,7 | 44,4 | 27,6 | 38,8 | 32,8 | 36,9 | 28,4 |
| Izgara 2×2 | 60,1 | 65,5 | 48,9 | 32,9 | 49,0 | 36,8 | 41,4 | **26,3** |
| Izgara 2×3 | 114,0 | 68,3 | 69,7 | 43,8 | 61,5 | 54,3 | 50,5 | **36,1** |
| Izgara 3×3 | 73,4 | 57,0 | 63,9 | 43,1 | 63,8 | 46,1 | 54,5 | **33,2** |

Bu sonuçlardan çıkan gözlemler:
- **Sinyalli kavşaklar:** En iyisi araç tetiklemeli kontrol oldu. GA ile ayarlanmış bulanık denetleyici tek kavşakta eğitildiği için, sola dönüş etkileşimlerinin olduğu ağda onun gerisinde kaldı.
- **Dönel kavşak (göbekli):** Izgaralarda en düşük gecikmeyi verdi ve geri taşmayı neredeyse sıfıra indirdi. Yoğun ana arter koridorunda araç tetiklemeli sinyalle aralarında anlamlı fark çıkmadı. Buna karşılık yolculuk başına duruş sayısı daha yüksek.
- **Yeşil dalga:** Koordine edilen arter yönündeki gecikmeyi belirgin biçimde azalttı, ama ağ ortalamasında geride kaldı.

Sonuçlar rastgele tohumlara ve GA koşusuna göre küçük farklılıklar gösterebilir.

## Çalıştırma

Kurulum gerekmez. Yerelde Web Worker'ın çalışması için dosyaları bir sunucu üzerinden açın:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Dosya doğrudan `file://` ile açılırsa hesaplamalar sayfa içinde, daha yavaş çalışır.

## Dosya yapısı

```
index.html        Arayüz, yöntem metni ve analiz planı
css/style.css     Stil
js/engine.js      Tek kavşak simülasyon motoru, denetleyiciler, istatistik, GA ve Q-öğrenme (DOM'suz)
js/net.js         Çok kavşaklı ağ motoru: geometri, rotalar, izinli sola dönüş, geri taşma, yeşil dalga, dönel kavşak
js/worker.js      Ağır hesaplamalar için Web Worker
js/app.js         Arayüz mantığı ve grafikler
vendor/katex/     Formül gösterimi (KaTeX, MIT lisansı)
```

## Temel kaynaklar

- Zadeh, L. A. (1965). Fuzzy sets. *Information and Control*, 8(3), 338–353.
- Mamdani, E. H. ve Assilian, S. (1975). An experiment in linguistic synthesis with a fuzzy logic controller. *Int. J. Man-Machine Studies*, 7(1), 1–13.
- Pappis, C. P. ve Mamdani, E. H. (1977). A fuzzy logic controller for a traffic junction. *IEEE Trans. SMC*, 7(10), 707–717.
- Webster, F. V. (1958). *Traffic Signal Settings*. Road Research Technical Paper No. 39.
- Trabia, M. B., Kaseko, M. S. ve Ande, M. (1999). A two-stage fuzzy logic controller for traffic signals. *Transportation Research Part C*, 7(6), 353–367.
- Niittymäki, J. ve Pursula, M. (2000). Signal control using fuzzy logic. *Fuzzy Sets and Systems*, 116(1), 11–22.
- Herrera, F. (2008). Genetic fuzzy systems: taxonomy, current research trends and prospects. *Evolutionary Intelligence*, 1, 27–46.
- Watkins, C. J. C. H. ve Dayan, P. (1992). Q-learning. *Machine Learning*, 8, 279–292.
- Abdulhai, B., Pringle, R. ve Karakoulas, G. J. (2003). Reinforcement learning for true adaptive traffic signal control. *J. Transportation Engineering*, 129(3), 278–285.

Tam kaynakça sitedeki "Yöntem ve Literatür" sekmesindedir.
