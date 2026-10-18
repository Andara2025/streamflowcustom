# 📋 Dokumentasi Fitur: Duplicate Stream (Auto Multi-Live)

## Deskripsi Fitur
Fitur untuk menduplikasi 1 stream (Video + Stream Key) menjadi N live stream secara otomatis, dengan delay yang bisa diatur antar stream. Menghilangkan kebutuhan klik manual "Go Live" di YouTube Studio.

---

## 🧪 Latar Belakang (Temuan Manual)

User menemukan bahwa secara manual, 1 stream key YouTube bisa dipakai untuk multiple live stream sekaligus dengan cara:

1. Buat **Stream 1**: Video A + Key A → `Auto Start: ON` → Langsung live
2. Buat **Stream 2**: Video A + Key A → `Auto Start: OFF` → FFmpeg jalan, YouTube Studio tampil "pending"
3. Klik manual **"Go Live"** di YouTube Studio → Stream ke-2 live!

> **Terbukti work** secara manual. Tujuan fitur ini: **otomasi langkah nomor 3**.

---

## 🔑 API YouTube Yang Digunakan

### `liveBroadcasts.transition`
```
POST https://www.googleapis.com/youtube/v3/liveBroadcasts/transition
```

| Parameter | Value |
|-----------|-------|
| `broadcastStatus` | `"live"` |
| `id` | broadcast_id |
| `part` | `"id,status"` |

**Syarat wajib dari YouTube:**
> Stream yang di-bind ke broadcast harus berstatus **`active`** sebelum bisa di-transition ke `live`.

---

## 🔄 Flow Otomatis Yang Direncanakan

```
USER klik "Duplikat Stream" → pilih jumlah N & delay antar stream
        ↓
[Loop N kali]
        ↓
┌─────────────────────────────────────────┐
│ 1. Buat record Stream baru di database  │
│    (copy semua setting dari stream asal)│
│                                         │
│ 2. Buat YouTube Broadcast baru via API  │
│    enableAutoStart: FALSE               │
│    (berbeda dari stream pertama)        │
│                                         │
│ 3. FFmpeg start → kirim ke stream key   │
│                                         │
│ 4. Tunggu delay X detik (configurable)  │
│                                         │
│ 5. Poll status liveStream setiap 5 dtk  │
│    → tunggu status = "active"           │
│                                         │
│ 6. Call liveBroadcasts.transition       │
│    broadcastStatus: "live"              │
│    → ✅ Auto Go Live!                   │
└─────────────────────────────────────────┘
        ↓
[Ulangi untuk stream ke-3, ke-4, dst...]
```

---

## ⚠️ Batasan & Syarat

| Kondisi | Status |
|---------|--------|
| **YouTube API mode** (`is_youtube_api = true`) | ✅ Bisa diotomasi penuh |
| **Raw RTMP stream key** (tanpa YouTube API) | ❌ Tidak bisa — tidak ada broadcast ID untuk di-transition |
| YouTube butuh stream `active` sebelum transition | ⚠️ Wajib polling dulu |
| Rate limit YouTube API | ⚠️ Sudah ada throttle 3 concurrent (perlu disesuaikan untuk N stream) |

---

## 📁 File Yang Perlu Dimodifikasi

### 1. Database — `db/database.js` atau migration
```sql
-- Tidak perlu tabel baru, cukup pakai tabel streams yang ada
-- Duplikat = record stream baru dengan parent_stream_id (opsional untuk tracking)
ALTER TABLE streams ADD COLUMN parent_stream_id TEXT DEFAULT NULL;
ALTER TABLE streams ADD COLUMN duplicate_delay_seconds INTEGER DEFAULT 0;
```

### 2. `services/youtubeService.js`
- Tambah fungsi `transitionBroadcastToLive(streamId, baseUrl)`
- Tambah fungsi `pollStreamActiveStatus(youtube, liveStreamId, timeoutMs)`
- Modifikasi `createYouTubeBroadcast` agar support parameter `enableAutoStart`

### 3. `services/streamingService.js`
- Tambah fungsi `duplicateAndStartStream(sourceStreamId, count, delaySeconds)`
- Integrasi polling + auto-transition setelah FFmpeg start

### 4. UI — `views/` (halaman stream)
- Tambah tombol **"Duplikat Stream"** di kartu stream
- Modal: pilih jumlah duplikat (N) dan delay antar stream (detik)
- Status indicator per duplikat (pending → active → live)

### 5. API Route — `app.js`
```
POST /api/streams/:id/duplicate
Body: { count: 10, delay_seconds: 30 }
```

---

## 💡 Detail Implementasi Kritis

### Polling Stream Active Status
```javascript
async function pollStreamActiveStatus(youtube, liveStreamId, timeoutMs = 120000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const res = await youtube.liveStreams.list({
      part: 'status',
      id: liveStreamId
    });
    const status = res.data.items?.[0]?.status?.streamStatus;
    if (status === 'active') return true;
    await sleep(5000); // poll tiap 5 detik
  }
  return false; // timeout
}
```

### Auto Transition ke Live
```javascript
async function transitionBroadcastToLive(youtube, broadcastId) {
  await youtube.liveBroadcasts.transition({
    part: 'id,status',
    broadcastStatus: 'live',
    id: broadcastId
  });
}
```

### Delay Antar Stream
```javascript
async function duplicateAndStartStream(sourceStreamId, count, delaySeconds) {
  for (let i = 0; i < count; i++) {
    const newStream = await cloneStream(sourceStreamId);
    await startStream(newStream.id);
    // Tunggu stream active lalu transition
    pollAndTransition(newStream); // async, tidak blocking
    // Delay sebelum stream berikutnya
    if (i < count - 1) await sleep(delaySeconds * 1000);
  }
}
```

---

## 🧪 Rencana Pengujian

1. **Test manual dulu**: Buat 2 duplikat via API route, cek di YouTube Studio
2. **Test polling**: Verifikasi stream status berubah ke `active` setelah FFmpeg start
3. **Test transition**: Verifikasi broadcast berhasil pindah ke `live` otomatis
4. **Test delay**: Verifikasi delay antar stream berjalan sesuai setting
5. **Test bulk**: Test dengan 10 stream sekaligus, pantau CPU dan API quota

---

## 📌 Status

| Item | Status |
|------|--------|
| Diskusi & analisa | ✅ Selesai |
| Dokumentasi | ✅ Selesai |
| Implementasi | ⏳ Belum dimulai |
| Testing | ⏳ Belum dimulai |

---

*Dibuat: 22 September 2026*
*Referensi: [YouTube Data API - liveBroadcasts.transition](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition)*
