# 🚀 StreamFlow — Panduan Instalasi VPS (Ubuntu 22.04)
> Panduan ini sudah mencakup semua fix yang ditemukan. Ikuti urutan step dengan benar.

---

## 📋 Prasyarat
- VPS Ubuntu 22.04 LTS (fresh)
- Domain sudah diarahkan ke IP VPS (A record)
- Akses SSH sebagai root

---

## STEP 1 — SSH ke VPS

```bash
ssh root@[IP_VPS]
```

---

## STEP 2 — Update Sistem

Saat ada prompt konfirmasi file konfigurasi:
- Pilih **"keep the local version currently installed"**

Saat ada prompt restart services → tekan **Tab** → **Enter**

```bash
apt update && apt upgrade -y
apt install -y git ffmpeg python3 make g++ build-essential curl nginx certbot python3-certbot-nginx
```

---

## STEP 3 — Install NVM + Node.js

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/refs/heads/master/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts
nvm alias default 'lts/*'
node -v
```

---

## STEP 4 — Install pnpm

```bash
npm install -g pnpm
source ~/.bashrc
pnpm -v
```

---

## STEP 5 — Clone Repository

```bash
git clone -b master https://github.com/Andara2025/streamflowcustom ~/streamflow
cd ~/streamflow
```

---

## STEP 6 — Install Dependencies

```bash
pnpm install
```

Setelah selesai, **approve build scripts** (WAJIB!):

```bash
pnpm approve-builds --all
pnpm install
```

---

## STEP 7 — Fix Versi SQLite (WAJIB untuk Ubuntu 22.04)

> ⚠️ `sqlite3@6.x` tidak kompatibel dengan Ubuntu 22.04 (GLIBC 2.35)

```bash
pnpm remove sqlite3
pnpm add sqlite3@5.1.7

pnpm remove connect-sqlite3
pnpm add connect-sqlite3@0.9.15
```

---

## STEP 8 — Fix Case-Sensitivity Linux (WAJIB)

> ⚠️ Linux case-sensitive, `RotationService` ≠ `rotationService`

```bash
sed -i "s|./services/RotationService|./services/rotationService|g" ~/streamflow/app.js
```

Verifikasi:
```bash
grep -n "rotationService" ~/streamflow/app.js | head -3
```

---

## STEP 9 — Generate Secret

```bash
cd ~/streamflow
pnpm run generate-secret
```

---

## STEP 10 — Setup Timezone & Firewall

```bash
timedatectl set-timezone Asia/Jakarta

ufw allow 22/tcp
ufw allow 7575
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

---

## STEP 11 — Install PM2 & Jalankan App

```bash
npm install -g pm2
cd ~/streamflow
pm2 start app.js --name streamflow
pm2 save
```

Setup auto-start saat reboot:
```bash
pm2 startup
```
> Copy-paste perintah `sudo env PATH=...` yang muncul, lalu jalankan. Kemudian:
```bash
pm2 save
```

Verifikasi app berjalan:
```bash
pm2 status
ss -tlnp | grep 7575
```
Harus ada output `0.0.0.0:7575` ✅

---

## STEP 12 — Setup Nginx

```bash
python3 -c "
content = open('/etc/nginx/sites-available/streamflow', 'w')
content.write('''server {
    listen 80;
    server_name DOMAIN_ANDA www.DOMAIN_ANDA;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    server_name DOMAIN_ANDA www.DOMAIN_ANDA;
    ssl_certificate /etc/letsencrypt/live/DOMAIN_ANDA/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_ANDA/privkey.pem;
    location / {
        proxy_pass http://localhost:7575;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
''')
content.close()
print('OK!')
"
```

> **Ganti `DOMAIN_ANDA`** dengan domain Anda (contoh: `pejuangmonet.cloud`)

Aktifkan Nginx:
```bash
ln -s /etc/nginx/sites-available/streamflow /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

---

## STEP 13 — Install SSL (Let's Encrypt)

Gunakan **DNS Challenge** (tidak butuh port 80 terbuka dari luar):

```bash
certbot certonly --manual --preferred-challenges dns \
  -d DOMAIN_ANDA -d www.DOMAIN_ANDA
```

**Ikuti instruksi certbot:**
1. Masukkan email → `Y` → `Y`
2. Certbot tampilkan nilai TXT → **JANGAN ENTER dulu!**
3. Buka panel DNS → tambahkan:
   - Host: `_acme-challenge` | Type: `TXT` | Value: `[nilai dari certbot]`
4. Tekan Enter → certbot minta TXT kedua untuk `www`
5. Tambahkan lagi:
   - Host: `_acme-challenge.www` | Type: `TXT` | Value: `[nilai kedua]`
6. Verifikasi di: https://toolbox.googleapps.com/apps/dig/
7. Tunggu 2-3 menit → baru tekan Enter

Setelah sukses, restart Nginx:
```bash
nginx -t && systemctl restart nginx
```

---

## STEP 14 — Verifikasi Akhir

```bash
pm2 status                    # streamflow harus 'online'
ss -tlnp | grep 7575          # harus ada 0.0.0.0:7575
ss -tlnp | grep :80           # nginx harus listening
ss -tlnp | grep :443          # nginx harus listening
```

Buka browser: **`https://DOMAIN_ANDA`** ✅

---

## STEP 15 — Langkah Pertama di Browser

1. Buka `https://DOMAIN_ANDA`
2. Klik **Daftar** → buat akun admin
3. **Sign Out** → Login kembali (sinkronisasi database)
4. Buka `https://DOMAIN_ANDA/activate`
5. Generate license key di lokal: `node license_generator.js "DOMAIN_ANDA"`
6. Paste license key → **Aktivasi** → Pro features aktif ✅

---

## 🔁 Update Code (Rutin)

```bash
# Di lokal
git add -A && git commit -m "update" && git push origin master

# Di VPS
cd ~/streamflow && git pull origin master && pm2 restart streamflow
```

---

## 🔒 Tabel Kompatibilitas Ubuntu 22.04

| Package | ❌ Jangan Pakai | ✅ Gunakan Ini |
|---|---|---|
| sqlite3 | `@6.0.1` (butuh GLIBC 2.38) | **`@5.1.7`** |
| connect-sqlite3 | `@0.9.17` (API mismatch) | **`@0.9.15`** |

---

## 📅 SSL Renewal (Setiap 90 Hari)

```bash
certbot certonly --manual --preferred-challenges dns \
  -d DOMAIN_ANDA -d www.DOMAIN_ANDA
systemctl restart nginx
```
