# Catatan Teknis & Workflow: Smart Audience Automation (Auto-Extend & Auto-Redirect)

**Tanggal:** 18 Oktober 2026  
**Status Implementasi:** Aktif di Tab Streams (`/`) dan Tab Rotasi (`/rotations`)  
**Lokasi Sinkronisasi:** `F:\Nivaralive` & `F:\STREAMFLOW`  

---

## 1. Ringkasan Fitur
Smart Audience Automation adalah modul otomatisasi audiens berbasis **YouTube Live Streaming API v3** yang bertugas mempertahankan jumlah penonton saat siaran live mendekati akhir jadwal tayang:
1. **Auto-Extend**: Memperpanjang siaran secara otomatis jika jumlah penonton aktif masih melampaui ambang batas tertentu (*threshold*).
2. **Auto-Redirect / Chat Announcement**: Mengirim pesan pengumuman resmi dan tautan ke siaran / konten berikutnya di Live Chat sebelum siaran ditutup rapi.

---

## 2. Pengaturan yang Tersedia
- **Toggle Auto-Extend**: Mengaktifkan atau menonaktifkan fitur.
- **Minimal Penonton (`auto_extend_min_viewers`)**: Jumlah minimum penonton aktif (default: `10`).
- **Durasi Perpanjang (`auto_extend_duration`)**: Penambahan waktu siaran dalam menit (misal `15`, `30`, atau `60` menit).
- **Batas Maksimal Perpanjangan (`auto_extend_max`)**: 
  - `0`: Tanpa batas (Looping terus selama penonton $\ge$ batas).
  - `1`, `2`, `3`, `5`: Membatasi jumlah kali perpanjangan berturut-turut.
- **Auto-Redirect Checkbox (`auto_redirect`)**: Mengirim pesan pengalihan penonton via Live Chat sebelum stop stream.
- **Ambang Batas Penonton Redirect (`auto_redirect_min_viewers`)**: Ambang batas penonton aktif untuk pengiriman pesan redirect.

---

## 3. Workflow Lengkap
```
[ Siaran Mendekati Batas Akhir (now >= scheduledEnd) ]
                        │
                        ▼
       [ Cek Penonton Real-Time via YouTube API ]
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
[ Penonton >= Batas? ]       [ Penonton < Batas / Batas Extend Habis ]
          │                                   │
      ( YA )                               ( TIDAK )
          │                                   │
          ▼                                   ▼
 [ Auto-Extend Aktif:                [ Auto-Redirect Evaluasi:
   - Perpanjang end_time               - Siapkan pesan & link tujuan
   - FFmpeg tetap lanjut               - Kirim pesan ke Live Chat
   - Kirim chat extend ke penonton     - Jeda grace period 3-5 detik
   - Notifikasi ke dashboard ]         - Stop Stream & Complete YouTube ]
```

---

## 4. Penanganan Kasus: Jadwal Berikutnya Masih Jauh

Ketika siaran saat ini selesai namun jadwal siaran berikutnya masih lama (misal: baru tayang besok hari atau minggu depan), strategi yang disiapkan:

1. **Auto-Extend Berkelanjutan (Prioritas Utama)**:
   - Atur batas perpanjangan ke **"Tanpa Batas (Looping)"**.
   - Selama penonton masih ramai, siaran akan terus berputar (*looping*) tanpa perlu dipaksa berakhir.

2. **Upcoming Schedule Reminder**:
   - Jika siaran harus berhenti, pesan di Live Chat diformat menjadi pengingat jadwal berikutnya:
     > *"📢 Terima kasih telah menonton! Siaran sesi ini telah selesai. Nantikan siaran berikutnya pada [Hari/Jam Jadwal Berikutnya]. Jangan lupa Subscribe dan aktifkan lonceng!"*

3. **Redirect ke Video Unggulan / Playlist Channel**:
   - Penonton diarahkan ke URL Playlist YouTube atau Video Terpopuler channel.

4. **Cross-Channel Redirect**:
   - Mengoper penonton ke channel lain milik pengguna yang kebetulan sedang live pada jam tersebut.

---

## 5. Rencana Pengembangan Lanjutan (Future Roadmap)
- [ ] Penambahan input teks opsional: **"Custom Redirect URL"** (Link Playlist/Video/Channel eksternal).
- [ ] Penambahan input template pesan chat: **"Custom Live Chat Message"** untuk personalisasi pesan perpisahan/pengalihan.
- [ ] Opsi filter cross-channel: otomatis mendeteksi channel lain milik user yang sedang aktif live.
