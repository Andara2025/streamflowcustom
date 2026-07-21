# Panduan Instalasi Bersih StreamFlow di VPS Ubuntu 22.04
Dokumen ini merangkum langkah-langkah **paling benar dan berurutan** untuk menginstall aplikasi StreamFlow di VPS baru tanpa takut mengalami error.

---

## TAHAP 1: Persiapan Server Dasar
Jalankan perintah ini satu per satu dari terminal (di `/root/`):

1. **Update Sistem & Install Alat Dasar**
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install build-essential curl git ffmpeg -y
```
*(Catatan: `build-essential` wajib agar tidak ada error kompilasi C++ di NPM, dan `ffmpeg` wajib untuk proses kompresi video).*

2. **Atur Zona Waktu ke Indonesia (WIB)**
```bash
sudo timedatectl set-timezone Asia/Jakarta
```

---

## TAHAP 2: Instalasi Node.js & Kloning Kode
Jangan gunakan `apt install nodejs`, selalu gunakan **NVM** agar versinya bisa disesuaikan.

1. **Install NVM & Node.js versi 18**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

2. **Tarik Kode StreamFlow dari Github**
```bash
git clone https://github.com/Andara2025/streamflowcustom.git
cd streamflowcustom
```
*(Jika folder sudah ada, cukup `cd streamflowcustom` lalu `git pull`).*

3. **Install Dependensi Node.js**
```bash
# Pastikan posisi Anda di: root@live:~/streamflowcustom#
npm install
```

---

## TAHAP 3: Menjalankan Aplikasi & Autostart (PM2)
Agar aplikasi tetap hidup meski terminal ditutup dan otomatis menyala saat VPS di-reboot.

1. **Install PM2 & Jalankan StreamFlow**
```bash
npm install -g pm2
pm2 start app.js --name "streamflow"
```

2. **Simpan Konfigurasi PM2**
```bash
pm2 save
pm2 startup
```
*(Copy-Paste perintah yang muncul di terminal dari hasil `pm2 startup` lalu tekan Enter).*

---

## TAHAP 4: Keamanan Firewall (UFW)
Blokir akses langsung ke port 7575, hanya buka port web resmi (80 & 443) dan SSH (22).

```bash
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## TAHAP 5: Konfigurasi Nginx (Reverse Proxy)
Menyambungkan port web standar ke port aplikasi StreamFlow (7575).

1. **Install Nginx**
```bash
sudo apt install nginx -y
```

2. **Buat File Konfigurasi (Copy-Paste semua sekaligus lalu Enter)**
```bash
sudo bash -c 'cat > /etc/nginx/sites-available/pejuangmonet.cloud << "EOF"
server {
    listen 80;
    server_name pejuangmonet.cloud www.pejuangmonet.cloud;
    
    # Batas ukuran upload file (50GB)
    client_max_body_size 50000M; 

    location / {
        proxy_pass http://127.0.0.1:7575;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
EOF'
```

3. **Aktifkan Konfigurasi & Restart**
```bash
sudo ln -sf /etc/nginx/sites-available/pejuangmonet.cloud /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx
```

---

## TAHAP 6: Memasang SSL / HTTPS (Let's Encrypt)
Agar website memiliki gembok hijau dan aman diakses browser.

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d pejuangmonet.cloud -d www.pejuangmonet.cloud --non-interactive --agree-tos -m admin@pejuangmonet.cloud
```

**SELESAI!** Website Anda sekarang dapat diakses dengan aman di `https://pejuangmonet.cloud`.
