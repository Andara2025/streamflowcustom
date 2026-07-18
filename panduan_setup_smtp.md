# Panduan Setting Fitur Lupa Password (SMTP Email)

Fitur Lupa Password (Sistem 2) kini telah berhasil dipasang di website Anda. Namun, agar sistem ini bisa benar-benar mengirimkan email berisi **Link Reset Password** ke user, Anda harus melakukan pengaturan (setup) SMTP Email.

## Langkah 1: Persiapan Akun Email (Contoh Menggunakan Gmail)
Jika Anda menggunakan Gmail untuk mengirim email otomatis, Anda tidak bisa menggunakan password Gmail biasa. Anda wajib membuat **App Password (Sandi Aplikasi)**.
1. Buka akun Google Anda dan masuk ke **Kelola Akun Google Anda** (Manage your Google Account).
2. Pergi ke menu **Keamanan** (Security).
3. Pastikan **Verifikasi 2 Langkah (2-Step Verification)** sudah aktif.
4. Di bagian Verifikasi 2 Langkah, cari **Sandi Aplikasi (App Passwords)** (biasanya di bagian paling bawah halaman 2-Step Verification).
5. Buat Sandi Aplikasi baru dengan nama (misal: "Streamflow App").
6. Google akan memberikan **16 digit password khusus** (misal: `abcd efgh ijkl mnop`). Simpan password ini!

## Langkah 2: Memasukkan Pengaturan SMTP ke Database

Karena pengaturan SMTP disimpan di dalam tabel `app_settings` di database, Anda bisa menjalankan perintah berikut di Terminal VPS/Komputer Anda untuk memasukkan konfigurasinya secara otomatis.

1. Buka Terminal/Command Prompt di dalam folder `STREAMFLOW`.
2. Buat sebuah file baru bernama `setup-smtp.js` dengan menyalin kode berikut:

```javascript
const { db } = require('./db/database');
const smtpConfig = {
  host: 'smtp.gmail.com', // Ganti jika pakai hostinger/mail provider lain
  port: 465,
  secure: true,
  user: 'email_anda@gmail.com', // GANTI DENGAN EMAIL ANDA
  pass: '16_DIGIT_APP_PASSWORD_ANDA' // GANTI DENGAN 16 DIGIT SANDI APLIKASI
};

db.run(
  'INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES (?, ?)',
  ['smtp_settings', JSON.stringify(smtpConfig)],
  (err) => {
    if (err) console.error("Gagal menyimpan:", err);
    else console.log("SMTP berhasil disetting!");
    process.exit();
  }
);
```
3. Edit file tersebut dan **ganti** bagian `user` dan `pass` dengan Email dan App Password Anda.
4. Jalankan script tersebut di terminal:
   ```bash
   node setup-smtp.js
   ```

## Langkah 3: Mengisi Email User
Sistem ini menggunakan validasi berdasarkan **Email**. Oleh karena itu:
- Pastikan user Anda **memiliki data email** di dalam sistem.
- Jika ada user lama yang belum memiliki email, Anda bisa mengupdate email mereka melalui database atau mengarahkan mereka untuk mengisi profil emailnya nanti jika fitur profil sudah ditambahkan emailnya.

### Catatan Tambahan (Mode Dev)
Jika Anda belum mengatur SMTP, sistem tidak akan error. Coba saja masukkan email sembarang (yang ada di database) di halaman "Lupa Password", lalu buka **Terminal Server** Anda. Sistem akan mencetak link reset password-nya secara langsung di dalam log Terminal (*sebagai simulasi*).

Anda bisa klik link reset tersebut yang tercetak di console/terminal!
