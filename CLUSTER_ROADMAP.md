# Roadmap Arsitektur Enterprise StreamFlow (Skala 2000+ Live)

Dokumen ini adalah cetak biru (*blueprint*) jika StreamFlow akan berekspansi dari sistem *Single-Server* menjadi sistem **Cluster (Master-Worker Node)** seperti yang digunakan oleh kompetitor besar. Arsitektur ini dirancang untuk menangani ribuan *live streaming* tanpa membebani satu server.

## 1. Perubahan Arsitektur Dasar

Sistem kita saat ini berbentuk **Monolitik** (semua disatukan dalam 1 VPS: Web Panel, Database SQLite, Storage Lokal, dan Engine FFmpeg). Untuk menampung 2000+ Live, kita harus memecahnya menjadi komponen-komponen terpisah:

### A. Database Tersentralisasi (Perlu Perombakan Skema)
*   **Saat Ini:** `SQLite` (Hanya bisa dibaca oleh 1 server).
*   **Target:** `PostgreSQL` atau `MySQL`.
*   **Alasan:** Semua server (*Worker*) harus bisa membaca data user, jadwal, dan status *stream* dari satu pusat data yang sama secara *real-time*.

### B. Penyimpanan Terpusat (Object Storage)
*   **Saat Ini:** Folder lokal (`/public/uploads/videos`).
*   **Target:** `Amazon S3`, `DigitalOcean Spaces`, atau `MinIO` (Penyimpanan Cloud Jagoan Hosting).
*   **Alasan:** Jika kita punya 10 server FFmpeg, semuanya harus bisa mengambil file video dari satu *storage* tanpa harus men-copy video tersebut ke tiap server.

---

## 2. Topologi Master-Worker Node

Sistem akan dipecah menjadi dua jenis server:

### 1. Master Node (Server Panel Admin)
Ini adalah "Otak" dari sistem. Spesifikasi VPS tidak perlu terlalu besar (misal 4 Core, 4GB RAM) karena tugasnya ringan.
**Tugas Master Node:**
*   Menjalankan *Dashboard* (Website Node.js).
*   Memproses otentikasi (Login/Signup).
*   Menerima order & menyimpan data ke Database.
*   **Distributor Tugas:** Melihat server FFmpeg mana yang masih kosong, lalu menugaskan server tersebut untuk memulai Live Streaming.

### 2. Worker Nodes (Server FFmpeg)
Ini adalah "Otot" dari sistem. Anda bisa menyewa puluhan VPS terpisah khusus untuk ini.
**Tugas Worker Node:**
*   Tidak memiliki *website / panel* sama sekali.
*   Hanya memiliki skrip *agent* kecil yang terus berkomunikasi dengan Master Node.
*   Jika mendapat perintah dari Master Node: *"Hei Worker 3, lakukan stream video X ke YouTube A!"*, maka Worker 3 akan mengunduh video X dari S3 dan menjalankan FFmpeg.
*   Mengirim kembali status (sukses/gagal/berjalan) ke Master Node.

---

## 3. Ilustrasi Alur Kerja (Workflow) Cluster

1.  **User Mendaftar & Upload:** User *login* ke `sewalive.com` (Master Node). User *upload* video. Video tidak disimpan di Master Node, melainkan langsung diteruskan ke **S3 Storage**.
2.  **User Memulai Live:** User klik "Mulai Live". 
3.  **Load Balancing (Master Node):** Master Node mengecek Database:
    *   *Worker 1: Beban CPU 90% (Penuh)*
    *   *Worker 2: Beban CPU 85% (Penuh)*
    *   *Worker 3: Beban CPU 20% (Kosong)*
    Master Node akan memberikan tugas ini kepada **Worker 3**.
4.  **Eksekusi (Worker Node):** Worker 3 menerima sinyal, menarik video dari S3, mengeksekusi *stream* FFmpeg, lalu melapor kembali ke Master Node bahwa statusnya sekarang *"Streaming"*.

---

## 4. Keuntungan Maksimal dari Arsitektur Ini

1.  **Skalabilitas Tak Terbatas (Horizontal Scaling):** 
    Jika pelanggan tiba-tiba membludak, Anda tidak perlu *upgrade* server Master sampai mati. Anda cukup **menyewa VPS baru (Worker 4, Worker 5)**, pasang skrip *agent*, dan otomatis kapasitas Live Anda bertambah ratusan lagi dalam hitungan menit.
2.  **Zero Downtime:** 
    Jika Worker 2 terbakar atau rusak, hanya user di Worker 2 yang mati. Master Node akan langsung menyadarinya dan otomatis memindahkan tugas mereka ke Worker lain yang masih kosong.
3.  **Efisiensi Biaya:**
    Anda bisa menyewa *Worker Node* VPS murah (tanpa panel cpanel/web server) murni hanya untuk *compute power* (CPU).

## 5. Kapan Harus Pindah ke Arsitektur Ini?

Jangan lakukan sekarang. Bangun arsitektur ini secara bertahap ketika:
*   Anda sudah mencapai batasan di Opsi *Split VPS* manual (mengelola lebih dari 5 Dashboard terpisah).
*   Total pendapatan Anda sudah stabil di atas Rp 3.000.000 - Rp 5.000.000 / bulan.
*   Total *concurrent live* (Live bersamaan) sudah konsisten di atas 100-200 Live.
