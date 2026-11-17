# Bulanık Mantıkla Trafik Işığı Kontrolü

Tarayıcıda çalışan etkileşimli bir simülatör. Aynı araç akışı iki özdeş kavşağa gönderilir: biri **bulanık çıkarım sistemiyle** (Mamdani), diğeri **sabit süreli** sinyalle yönetilir. Üyelik fonksiyonları ve kural tabanı **genetik algoritmayla** optimize edilebilir.

**Canlı demo:** https://enes-yksl.github.io/bulanik-trafik

## Özellikler

- Yan yana iki kavşak, aynı rastgele araç akışı (adil karşılaştırma)
- Yön başına araç yoğunluğu, hazır senaryolar ve yönler arasında kayan dalgalı talep
- Canlı bulanık çıkarım paneli: üyelik dereceleri, kural ateşlenme dereceleri, birleştirilmiş çıktı ve ağırlık merkezi
- Tıklanarak düzenlenebilen 3×3 kural tabanı
- Genetik algoritma: 10 üyelik fonksiyonu merkezi + 9 kural sonucu birlikte optimize edilir; sabit sinyalin en iyi yeşil süresi de taranır

## Bulanık sistem

| | |
|---|---|
| Girdi 1 | Yeşil yöndeki araç sayısı (Az, Orta, Çok) |
| Girdi 2 | Kırmızı yöndeki araç sayısı (Az, Orta, Çok) |
| Çıktı | Yeşil uzatma süresi, s (Sıfır, Kısa, Orta, Uzun) |
| Çıkarım | Mamdani; VE = min, birleştirme = max, durulaştırma = ağırlık merkezi |
| Karar | En az 7 s yeşil; çıktı < 1,5 s ise faz değişir, değilse çıktı kadar uzatılır; maksimum yeşil sınırı |

## Araç modeli

Hız sınırı 50 km/sa, ivme 2 m/s², sürücü tepki süresi 1 s, durma aralığı 7 m, araçlar düz gider. Sarı 3 s + tüm kırmızı 2 s. Varışlar Poisson sürecidir.

## Çalıştırma

Kurulum gerekmez: `index.html` dosyasını tarayıcıda açmanız yeterli.
