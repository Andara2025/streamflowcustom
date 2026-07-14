#!/bin/bash

# Pastikan script dijalankan sebagai root/sudo
if [ "$EUID" -ne 0 ]; then
  echo "⚠️  Harap jalankan script ini sebagai root atau dengan sudo!"
  echo "Contoh: sudo ./mount_s3.sh"
  exit 1
fi

clear
echo "============================================================"
echo "          STREAMFLOW - S3 MOUNTING AUTOMATION SCRIPT         "
echo "============================================================"
echo "Script ini akan menginstal s3fs, mengkonfigurasi kredensial,"
echo "dan melakukan mounting S3 Object Storage secara otomatis."
echo "============================================================"
echo ""

# 1. Minta input kredensial dari user
read -p "🔑 Masukkan Access Key ID: " ACCESS_KEY
while [ -z "$ACCESS_KEY" ]; do
  read -p "⚠️  Access Key ID tidak boleh kosong. Masukkan kembali: " ACCESS_KEY
done

read -p "🔑 Masukkan Secret Access Key: " SECRET_KEY
while [ -z "$SECRET_KEY" ]; do
  read -p "⚠️  Secret Access Key tidak boleh kosong. Masukkan kembali: " SECRET_KEY
done

read -p "🪣  Masukkan Nama Bucket S3: " BUCKET_NAME
while [ -z "$BUCKET_NAME" ]; do
  read -p "⚠️  Nama Bucket tidak boleh kosong. Masukkan kembali: " BUCKET_NAME
done

read -p "🌐 Masukkan Endpoint URL (Default Wasabi SG: https://s3.ap-southeast-1.wasabisys.com): " ENDPOINT_URL
ENDPOINT_URL=${ENDPOINT_URL:-"https://s3.ap-southeast-1.wasabisys.com"}

echo ""
echo "--- Pilihan Folder Target Mounting ---"
echo "1) Seluruh folder uploads (/root/streamflow/public/uploads)"
echo "2) Hanya folder video (/root/streamflow/public/uploads/videos) [Rekomendasi]"
read -p "Pilihan Anda (1 atau 2): " FOLDER_OPTION

if [ "$FOLDER_OPTION" == "1" ]; then
  MOUNT_DIR="/root/streamflow/public/uploads"
else
  MOUNT_DIR="/root/streamflow/public/uploads/videos"
fi

echo ""
echo "============================================================"
echo "Memulai instalasi & konfigurasi S3 Object Storage..."
echo "============================================================"
echo ""

# STEP 1 & 2: Update & Install package yang dibutuhkan (fuse dan s3fs)
echo "🔄 [1/6] Mengupdate paket sistem dan menginstall fuse & s3fs..."
apt-get update -y
apt-get install fuse s3fs -y

# STEP 3 & 4: Setup Kredensial di /etc/passwd-s3fs
echo "🔐 [2/6] Menyimpan kredensial S3 ke /etc/passwd-s3fs..."
echo "${ACCESS_KEY}:${SECRET_KEY}" > /etc/passwd-s3fs
chmod 600 /etc/passwd-s3fs

# STEP 5 & 6: Buat Direktori Cache dan Target Mount Folder
echo "📁 [3/6] Membuat folder cache dan folder target mount..."
mkdir -p /tmp/cache
mkdir -p "$MOUNT_DIR"
chmod 777 /tmp/cache "$MOUNT_DIR"

# STEP 7: Jalankan perintah mount S3FS
echo "⚙️  [4/6] Melakukan mounting S3 Object Storage ke $MOUNT_DIR..."
# Unmount jika sebelumnya sudah ada mount di folder tersebut agar bersih
umount "$MOUNT_DIR" 2>/dev/null || true

s3fs "$BUCKET_NAME" "$MOUNT_DIR" \
  -o url="$ENDPOINT_URL" \
  -o use_cache=/tmp/cache \
  -o curldbg \
  -o use_path_request_style \
  -o allow_other

# STEP 8: Cek apakah mount berhasil
echo "🔍 [5/6] Memeriksa status mounting..."
sleep 2
if df -h | grep -iq "s3fs"; then
  echo "✅ Mounting BERHASIL!"
  df -h | grep -i "s3fs"
else
  echo "❌ Mounting GAGAL. Silakan cek kredensial atau Endpoint URL Anda."
  exit 1
fi

# STEP 9: Daftarkan ke /etc/fstab agar otomatis ter-mount saat VPS reboot
echo "✍️  [6/6] Mendaftarkan auto-mount di /etc/fstab..."
# Bersihkan sisa entri lama di fstab (jika ada) untuk menghindari duplikasi
sed -i "/s3fs#$BUCKET_NAME/d" /etc/fstab
sed -i "\|$MOUNT_DIR|d" /etc/fstab

# Tulis baris konfigurasi auto-mount baru
echo "s3fs#$BUCKET_NAME $MOUNT_DIR fuse _netdev,passwd_file=/etc/passwd-s3fs,url=$ENDPOINT_URL,use_cache=/tmp/cache,use_path_request_style,allow_other 0 0" >> /etc/fstab

echo ""
echo "============================================================"
echo "🎉   MOUNTING S3 OBJECT STORAGE BERHASIL & SELESAI!         "
echo "============================================================"
echo "Penyimpanan S3 '$BUCKET_NAME' aktif di: $MOUNT_DIR"
echo "Semua file di folder tersebut sekarang tersimpan aman di S3."
echo "Auto-mount aktif saat VPS reboot."
echo "============================================================"
echo ""
