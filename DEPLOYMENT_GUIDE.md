# Panduan Lengkap Deploy StreamFlow ke VPS (Ubuntu)

Panduan ini berisi langkah-langkah dari awal sampai akhir untuk menginstal aplikasi StreamFlow di VPS baru (Ubuntu) dan menyambungkannya dengan Domain serta SSL (Gembok Hijau HTTPS).

---

## TAHAP 1: Persiapan DNS (Domain)
Sebelum menyentuh VPS, sangat disarankan untuk mengatur domain Anda terlebih dahulu agar IP punya waktu untuk tersambung (propagate).

1. Buka halaman pengaturan DNS di tempat Anda membeli domain.
2. Cari menu **DNS Manager / DNS Management**.
3. Buat/Edit **A Record** dengan detail berikut:
   - **Type:** `A`
   - **Host/Name:** `@` (Atau biarkan kosong jika Anda menggunakan domain utama)
   - **Value/IP:** `IP_VPS_ANDA` (Contoh: `38.147.122.236`)
4. Buat satu lagi **A Record** atau **CNAME** untuk `www`:
   - **Type:** `CNAME`
   - **Host/Name:** `www`
   - **Value/Target:** `domain-anda.com` (Ganti dengan domain utama Anda)

---

## TAHAP 2: Instalasi Aplikasi Dasar

1. Buka Terminal/CMD/PowerShell di komputer Anda dan login ke VPS:
   ```bash
   ssh root@IP_VPS_ANDA
   ```
   *(Masukkan password VPS Anda saat diminta)*

2. Download dan beri akses ke script installer StreamFlow:
   ```bash
   curl -sL -o install.sh https://raw.githubusercontent.com/Andara2025/streamflowcustom/master/install.sh
   chmod +x install.sh
   ```

3. Jalankan Script Installer:
   ```bash
   ./install.sh
   ```
   *(Ketik `y` saat diminta konfirmasi. Tunggu prosesnya sampai selesai).*

### Troubleshooting (Jika install.sh gagal di bagian pnpm install)
Jika script terhenti dan muncul tulisan `[ERR_PNPM_IGNORED_BUILDS]`, Anda harus menginstal dependency yang terblokir secara manual. Jalankan perintah berurutan berikut:

```bash
# Refresh Terminal
source ~/.bashrc

# Masuk ke folder aplikasi
cd $HOME/streamflow

# Izinkan dan build ulang dependency
pnpm approve-builds --all
pnpm install --ignore-scripts=false
pnpm rebuild sqlite3 bcrypt

# Buat secret key
pnpm run generate-secret

# Install PM2 dan jalankan aplikasi
npm install -g pm2
pm2 start app.js --name streamflow
pm2 save
pm2 startup
```

---

## TAHAP 3: Konfigurasi Nginx & SSL (Gembok Hijau)

Pastikan aplikasi sudah berjalan (bisa dicek dengan IP di browser: `http://IP_VPS:7575`). Langkah selanjutnya adalah menyambungkan domain dan HTTPS.

*Ganti `namadomain.com` pada perintah di bawah ini dengan nama domain asli Anda!*

1. **Install Nginx & Certbot:**
   ```bash
   apt install nginx certbot python3-certbot-nginx -y
   ```

2. **Buat Konfigurasi Domain:**
   *(Copy paste semua perintah ini secara bersamaan)*
   ```bash
   cat > /etc/nginx/sites-available/streamflow << 'EOF'
   server {
       listen 80;
       server_name namadomain.com www.namadomain.com;

       location / {
           proxy_pass http://localhost:7575;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_cache_bypass $http_upgrade;
       }
   }
   EOF
   ```

3. **Aktifkan Konfigurasi & Restart Nginx:**
   ```bash
   ln -s /etc/nginx/sites-available/streamflow /etc/nginx/sites-enabled/
   nginx -t
   systemctl restart nginx
   ```

4. **Pasang SSL otomatis dengan Certbot:**
   ```bash
   certbot --nginx -d namadomain.com -d www.namadomain.com --non-interactive --agree-tos -m admin@namadomain.com
   ```

Jika muncul pesan **"Congratulations!"**, maka instalasi Anda sukses 100%. Buka `https://namadomain.com` di browser.
