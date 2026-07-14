# FERCONVERT v3.0

Tarayıcıda yerel çalışan PDF, dosya dönüştürme ve akıllı belge araçları.

## Faz 3A özellikleri

- Türkçe / İngilizce OCR (Tesseract.js)
- QR kod üretme ve okuma
- Tarayıcı destekli barkod okuma
- PDF metin tablolarını CSV / JSON olarak çıkarma
- Sayfa bazlı gelişmiş PDF arama
- Kural tabanlı fatura, sözleşme, teklif, CV, rapor ve dekont sınıflandırması
- Yerel işlem geçmişi ve JSON dışa/içe aktarma
- Faz 1 dashboard ve Faz 2 PDF Studio özellikleri

## Gizlilik

Dosyalar sunucuya yüklenmez. İşlemler tarayıcı içinde yapılır. OCR ve QR kütüphaneleri ilk kullanımda CDN üzerinden kod olarak yüklenir; seçtiğiniz dosya bu CDN'lere gönderilmez.

## Çalıştırma

Dosyaları GitHub Pages deponuzun kök dizinine yükleyin. `index.html` ana uygulamadır.

## Bilinen sınırlar

- OCR süresi cihaz hızına ve sayfa sayısına bağlıdır.
- Tablo çıkarma metin tabanlı ve düzenli tablolarda en iyi sonucu verir.
- Barkod okuma desteği tarayıcıya göre değişir. Güncel Chrome veya Edge önerilir.
- Belge tanıma yapay zekâ değildir; yerel ve açıklanabilir anahtar kelime puanlaması kullanır.
