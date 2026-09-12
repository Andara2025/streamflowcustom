# Panduan Generate License StreamFlow

## Persiapan

Pastikan sudah terinstall:
- Node.js (v14 atau lebih baru)
- File `license_generator.js` ada di folder project

## Cara Generate License (Command Line)

### Format Perintah
```bash
node license_generator.js "nama_pembeli atau email"
```

### Contoh 1: Generate untuk 1 User
```bash
node license_generator.js "budi@gmail.com"
```

### Contoh 2: Generate dengan Nama
```bash
node license_generator.js "Budi Santoso"
```

### Contoh 3: Generate untuk Reseller
```bash
node license_generator.js "reseller-jakarta"
```

## Output

Setelah menjalankan perintah, akan muncul:

```
=======================================================
LISENSI BERHASIL DIBAT
=======================================================
Informasi Klien : budi@gmail.com
License Key     :

YWRtaW5Ac3RyZWFtZmxvdy5jb20=.xxxx...

=======================================================
Berikan teks License Key di atas kepada pembeli.
```

## Cara Aktivasi (di VPS)

1. Login ke StreamFlow sebagai **Admin**
2. Buka halaman: `http://your-vps.com/admin/activate`
3. Paste **License Key** yang sudah di-generate
4. Klik **Aktivasi Lisensi Pro**

## Tips

- **Simpan License Key** yang sudah di-generate (untuk backup)
- **Jangan share** file `license_generator.js` (berisi private key)
- **Generate lokal** di komputer Anda, lalu paste key ke VPS
- Satu lisensi berlaku untuk **semua user** di 1 instalasi VPS

## Troubleshooting

| Error | Solusi |
|-------|--------|
| `node: command not found` | Install Node.js dari https://nodejs.org |
| `license_generator.js not found` | Pastikan file ada di folder yang benar |
| `License Key tidak valid` | Pastikan copy-paste dengan benar (tidak ada spasi) |

## Keamanan

- File `license_generator.js` sudah di-`.gitignore` (tidak masuk git)
- Private key hanya ada di file ini
- Jangan distribusikan file ini ke pembeli
- Pembeli hanya perlu **License Key** (bukan file generator)
