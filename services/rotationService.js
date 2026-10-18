const Rotation = require('../models/Rotation');
const Stream = require('../models/Stream');
const User = require('../models/User');
const Notification = require('../models/Notification');
const YoutubeChannel = require('../models/YoutubeChannel');
const streamingService = require('./streamingService');
const { google } = require('googleapis');
const { encrypt, decrypt } = require('../utils/encryption');
const path = require('path');
const fs = require('fs');
const { syncBroadcastMonetization, sanitizeYouTubeTags, getLiveViewerCount, sendLiveChatMessage } = require('./youtubeService');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

function getRedirectUri(user) {
  // PERMANENT FIX: prioritas BASE_URL (my.id), abaikan cloud lama
  if (process.env.BASE_URL && !process.env.BASE_URL.includes('pejuangmonet.cloud')) {
    return `${process.env.BASE_URL.replace(/\/$/, '')}/auth/youtube/callback`;
  }
  if (user && user.youtube_redirect_uri && !user.youtube_redirect_uri.includes('pejuangmonet.cloud')) {
    return user.youtube_redirect_uri;
  }
  if (process.env.BASE_URL) {
    return `${process.env.BASE_URL.replace(/\/$/, '')}/auth/youtube/callback`;
  }
  const port = process.env.PORT || 7575;
  return `http://localhost:${port}/auth/youtube/callback`;
}

let checkIntervalId = null;
const activeRotationStreams = new Map();
const failedRotationStarts = new Map();
const loggedAlreadyRunning = new Set();
const loggedScheduleInfo = new Set();

function formatLocalDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

function parseLocalDateTime(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim().replace('Z', '').split('.')[0];
  const separator = str.includes('T') ? 'T' : (str.includes(' ') ? ' ' : null);
  if (!separator) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  const [datePart, timePart] = str.split(separator);
  if (!datePart) return null;
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = (timePart || '00:00:00').split(':').map(Number);
  const d = new Date(year, month - 1, day, hours, minutes, seconds);
  return isNaN(d.getTime()) ? null : d;
}

function calculateRotationWindow(rotation, referenceDate = new Date()) {
  const originalStart = parseLocalDateTime(rotation.start_time);
  const originalEnd = parseLocalDateTime(rotation.end_time);

  if (!originalStart || !originalEnd) {
    const now = referenceDate;
    return { start: now, end: now };
  }

  const startHours = originalStart.getHours();
  const startMinutes = originalStart.getMinutes();
  const endHours = originalEnd.getHours();
  const endMinutes = originalEnd.getMinutes();

  const now = referenceDate;
  const repeatMode = rotation.repeat_mode || 'daily';
  if (repeatMode === 'none') {
    return { start: originalStart, end: originalEnd };
  }

  const isCrossMidnight = (endHours < startHours) || (endHours === startHours && endMinutes <= startMinutes);

  function buildWindow(baseY, baseM, baseD) {
    const s = new Date(baseY, baseM, baseD, startHours, startMinutes, 0, 0);
    const e = new Date(baseY, baseM, baseD + (isCrossMidnight ? 1 : 0), endHours, endMinutes, 0, 0);
    return { start: s, end: e };
  }

  // WEEKLY: hormati hari pilihan user (Senin-Minggu), bukan hari ini
  if (repeatMode === 'weekly') {
    const targetDow = originalStart.getDay();
    // Mulai dari 0 (hari ini), bukan -1 (kemarin), kecuali window lintas tengah malam
    const startOffset = isCrossMidnight ? -1 : 0;
    for (let offset = startOffset; offset <= 7; offset++) {
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      if (base.getDay() !== targetDow) continue;
      const w = buildWindow(base.getFullYear(), base.getMonth(), base.getDate());
      if (now >= w.start && now < w.end) return w;  // sedang aktif
      if (w.start > now) return w;                   // window berikutnya
    }
    // fallback: cari hari yang sama minggu depan
    for (let offset = 1; offset <= 14; offset++) {
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      if (base.getDay() !== targetDow) continue;
      const w = buildWindow(base.getFullYear(), base.getMonth(), base.getDate());
      if (w.end > now) return w;
    }
  }

  // MONTHLY: hormati tanggal pilihan user (1-31)
  if (repeatMode === 'monthly') {
    const targetDom = originalStart.getDate();
    for (let mOffset = -1; mOffset <= 13; mOffset++) {
      const ref = new Date(now.getFullYear(), now.getMonth() + mOffset, 1);
      const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
      const dom = Math.min(targetDom, lastDay);
      const w = buildWindow(ref.getFullYear(), ref.getMonth(), dom);
      if (now >= w.start && now < w.end) return w;
      if (w.start > now) return w;
    }
  }

  // DAILY (dan fallback): logika hari ini seperti semula
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHours, startMinutes, 0, 0);
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (isCrossMidnight ? 1 : 0), endHours, endMinutes, 0, 0);

  const startYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, startHours, startMinutes, 0, 0);
  const endYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHours, endMinutes, 0, 0);

  if (isCrossMidnight && now >= startYesterday && now < endYesterday) {
    return { start: startYesterday, end: endYesterday };
  }

  if (now >= startToday && now < endToday) {
    return { start: startToday, end: endToday };
  }

  if (now < startToday) {
    return { start: startToday, end: endToday };
  }

  let daysToAdd = 1;
  if (repeatMode === 'weekly') daysToAdd = 7;
  if (repeatMode === 'monthly') {
    const nextStartM = new Date(startToday);
    const nextEndM = new Date(endToday);
    while (nextEndM <= now) {
      nextStartM.setMonth(nextStartM.getMonth() + 1);
      nextEndM.setMonth(nextEndM.getMonth() + 1);
    }
    return { start: nextStartM, end: nextEndM };
  }

  const nextStart = new Date(startToday);
  const nextEnd = new Date(endToday);

  while (nextEnd <= now) {
    nextStart.setDate(nextStart.getDate() + daysToAdd);
    nextEnd.setDate(nextEnd.getDate() + daysToAdd);
  }

  return { start: nextStart, end: nextEnd };
}

function getNextSchedule(rotation, baseDate = null) {
  const refDate = baseDate || new Date();
  const window = calculateRotationWindow(rotation, refDate);
  if (window.end <= refDate) {
    const futureRef = new Date(refDate.getTime() + 60 * 1000);
    return calculateRotationWindow(rotation, futureRef);
  }
  // Window yang ditemukan SUDAH di masa depan (start > ref) -> itulah jadwal
  // berikutnya, langsung pakai. Jangan hitung sekali lagi (bug lama: tiap
  // reschedule weekly lompat +14 hari karena menghitung window sesudah
  // window berikutnya, sehingga slot live kosong seminggu).
  if (window.start > refDate) {
    return window;
  }
  // Dipanggil di tengah window berjalan (item habis lebih awal) -> jadwal
  // berikutnya adalah window sesudah window ini.
  const afterWindowRef = new Date(window.end.getTime() + 60 * 1000);
  return calculateRotationWindow(rotation, afterWindowRef);
}

function init() {
  console.log('[RotationService] Initializing rotation service...');
  checkIntervalId = setInterval(checkRotations, 60 * 1000);
  checkRotations();
}

async function moveRotationToNextScheduledItem(rotation, items, currentIndex, reason) {
  const nextIndex = currentIndex + 1;

  if (nextIndex >= items.length) {
    if (rotation.repeat_mode && rotation.repeat_mode !== 'none') {
      const nextSchedule = getNextSchedule(rotation);

      await Rotation.update(rotation.id, {
        current_index: 0,
        start_time: formatLocalDateTime(nextSchedule.start),
        end_time: formatLocalDateTime(nextSchedule.end),
        status: 'active'
      }, rotation.user_id);
      console.log(`[RotationService] ${reason} Rotation ${rotation.name} diulang dari item pertama pada ${formatLocalDateTime(nextSchedule.start)}`);
    } else {
      await Rotation.update(rotation.id, { status: 'completed' }, rotation.user_id);
      console.log(`[RotationService] ${reason} Rotation ${rotation.name} selesai`);
    }

    return;
  }

  // Moving to next item WITHIN current rotation window: do NOT add 1 day to start_time!
  await Rotation.update(rotation.id, {
    current_index: nextIndex,
    status: 'active'
  }, rotation.user_id);
  console.log(`[RotationService] ${reason} Lanjut ke item ${nextIndex + 1}/${items.length} (${rotation.start_time})`);
}

// Track antrian stagger per channel agar tidak bersamaan
// channelKey -> timestamp kapan channel ini boleh start berikutnya
const channelStartQueue = new Map();
const STAGGER_DELAY_MS = 30 * 1000; // 30 detik jeda per channel

async function checkRotations() {
  try {
    const activeRotations = await Rotation.findActiveRotations();
    const now = new Date();

    // Kumpulkan rotasi yang butuh START di tick ini (belum running, belum gagal)
    const rotationsToStart = [];

    for (const rotation of activeRotations) {
      if (!rotation.start_time || !rotation.end_time) continue;

      const items = await Rotation.getItemsByRotationId(rotation.id);
      if (items.length === 0) continue;

      let scheduledStart = parseLocalDateTime(rotation.start_time);
      let scheduledEnd = parseLocalDateTime(rotation.end_time);

      if (!scheduledStart || !scheduledEnd) continue;

      if (now < scheduledStart) {
        if (!loggedScheduleInfo.has(`notstarted_${rotation.id}`)) {
          console.log(`[RotationService] Rotation ${rotation.name} not yet started (starts at ${scheduledStart.toLocaleString()})`);
          loggedScheduleInfo.add(`notstarted_${rotation.id}`);
        }
        continue;
      }

      loggedScheduleInfo.delete(`notstarted_${rotation.id}`);

      const currentIndex = rotation.current_index || 0;
      
      if (currentIndex >= items.length) {
        console.log(`[RotationService] All items completed for rotation ${rotation.name}`);
        
        for (const item of items) {
          const streamKey = `${rotation.id}_${item.id}`;
          if (activeRotationStreams.has(streamKey)) {
            await stopRotationStream(rotation, item);
            activeRotationStreams.delete(streamKey);
            loggedAlreadyRunning.delete(streamKey);
            await Rotation.update(rotation.id, { status: 'active' }, rotation.user_id);
          }
          failedRotationStarts.delete(streamKey);
        }

        if (rotation.repeat_mode && rotation.repeat_mode !== 'none') {
          const nextSchedule = getNextSchedule(rotation);
          
          await Rotation.update(rotation.id, { 
            current_index: 0,
            start_time: formatLocalDateTime(nextSchedule.start),
            end_time: formatLocalDateTime(nextSchedule.end),
            status: 'active'
          }, rotation.user_id);
          console.log(`[RotationService] Rotation ${rotation.name} rescheduled for ${formatLocalDateTime(nextSchedule.start)}`);
        } else {
          await Rotation.update(rotation.id, { status: 'completed' }, rotation.user_id);
          console.log(`[RotationService] Rotation ${rotation.name} completed`);
        }
        continue;
      }

      if (now >= scheduledEnd) {
        console.log(`[RotationService] Rotation ${rotation.name} time window has reached end (end: ${rotation.end_time}, now: ${now.toLocaleString()})`);

        const currentItem = items[currentIndex];
        const streamKey = currentItem ? `${rotation.id}_${currentItem.id}` : null;
        const streamInfo = streamKey ? activeRotationStreams.get(streamKey) : null;
        let streamId = streamInfo ? streamInfo.streamId : null;

        // Auto-Extend Evaluation: perpanjang durasi jika penonton aktif masih melampaui ambang batas
        const isAutoExtendEnabled = rotation.auto_extend === 1 || rotation.auto_extend === true || rotation.auto_extend === '1';
        const maxExtends = parseInt(rotation.auto_extend_max, 10) || 0;
        const currentExtends = parseInt(rotation.auto_extend_count, 10) || 0;

        if (isAutoExtendEnabled && streamId && (maxExtends === 0 || currentExtends < maxExtends)) {
          try {
            const minViewers = parseInt(rotation.auto_extend_min_viewers, 10) || 10;
            const liveViewers = await getLiveViewerCount(streamId);

            if (liveViewers !== null && liveViewers >= minViewers) {
              const extendDurationMinutes = parseInt(rotation.auto_extend_duration, 10) || 30;
              const newEndTime = new Date(scheduledEnd.getTime() + extendDurationMinutes * 60 * 1000);
              const newEndTimeStr = formatLocalDateTime(newEndTime);
              const updatedExtendCount = currentExtends + 1;

              console.log(`[RotationService] 🚀 Auto-extending rotation "${rotation.name}" by ${extendDurationMinutes}m. Current viewers: ${liveViewers} >= ${minViewers} (Extends: ${updatedExtendCount}/${maxExtends || '∞'})`);

              await Rotation.update(rotation.id, {
                end_time: newEndTimeStr,
                auto_extend_count: updatedExtendCount
              }, rotation.user_id);

              await Stream.update(streamId, {
                end_time: newEndTimeStr,
                auto_extend_count: updatedExtendCount
              }, rotation.user_id);

              rotation.end_time = newEndTimeStr;
              rotation.auto_extend_count = updatedExtendCount;

              try {
                await sendLiveChatMessage(
                  streamId,
                  `📢 Siaran diperpanjang ${extendDurationMinutes} menit karena antusiasme penonton (${liveViewers} penonton aktif)! Terima kasih tetap setia menyaksikan.`
                );
              } catch (chatErr) {
                console.error('[RotationService] Gagal kirim chat extend:', chatErr.message);
              }

              try {
                await Notification.create({
                  user_id: rotation.user_id,
                  type: 'info',
                  title: `Rotasi Diperpanjang Otomatis: ${rotation.name}`,
                  message: `Rotasi "${rotation.name}" otomatis diperpanjang ${extendDurationMinutes} menit hingga ${newEndTimeStr} (Penonton aktif: ${liveViewers}).`,
                  metadata: { rotationId: rotation.id, viewers: liveViewers, newEndTime: newEndTimeStr }
                });
              } catch (nErr) {
                console.error('[RotationService] Gagal buat notif auto-extend:', nErr.message);
              }

              // Perpanjangan berhasil, jangan stop stream
              continue;
            } else {
              console.log(`[RotationService] Auto-extend tidak aktif: viewers=${liveViewers}, target=${minViewers}`);
            }
          } catch (extendErr) {
            console.error(`[RotationService] Gagal evaluasi auto-extend:`, extendErr.message);
          }
        }

        // Auto-Redirect / Pengalihan Penonton via Live Chat sebelum stream dihentikan
        const isAutoRedirectEnabled = rotation.auto_redirect === 1 || rotation.auto_redirect === true || rotation.auto_redirect === '1';
        if (isAutoRedirectEnabled && streamId) {
          try {
            const redirectMinViewers = parseInt(rotation.auto_redirect_min_viewers, 10) || 1;
            const currentViewers = await getLiveViewerCount(streamId);
            if (currentViewers === null || currentViewers >= redirectMinViewers) {
              let redirectMessage = `📢 Terima kasih telah menyaksikan siaran kami! Siaran ini akan segera berakhir.`;
              if (rotation.auto_redirect_target_stream_id) {
                const targetStream = await Stream.findById(rotation.auto_redirect_target_stream_id);
                if (targetStream && targetStream.youtube_broadcast_id) {
                  redirectMessage += ` Silakan beralih ke live stream berikutnya di: https://youtu.be/${targetStream.youtube_broadcast_id}`;
                }
              }
              await sendLiveChatMessage(streamId, redirectMessage);
              await delay(3000); // Beri jeda 3 detik agar chat sempat tersampaikan
            }
          } catch (redirErr) {
            console.error('[RotationService] Gagal kirim chat redirect:', redirErr.message);
          }
        }

        if (currentItem) {
          if (activeRotationStreams.has(streamKey)) {
            await stopRotationStream(rotation, currentItem);
            activeRotationStreams.delete(streamKey);
            loggedAlreadyRunning.delete(streamKey);
            await Rotation.update(rotation.id, { status: 'active' }, rotation.user_id);
          } else {
            // Map memori bisa hilang habis restart PM2: sapu DB agar tidak molor
            try {
              const { db } = require('../db/database');
              const liveRotStreams = await new Promise((resolve) => {
                db.all('SELECT * FROM streams WHERE user_id = ? AND is_rotation = 1 AND status = ?', [rotation.user_id, 'live'], (err, rows) => {
                  resolve(rows || []);
                });
              });
              for (const ls of liveRotStreams) {
                // Filter cerdas: hanya sapu stream yang memang milik channel/rotasi ini dan end_time-nya sudah terlewati
                const streamEnd = ls.end_time ? new Date(ls.end_time) : null;
                const isMatchingChannel = ls.youtube_channel_id && rotation.youtube_channel_id ? (ls.youtube_channel_id === rotation.youtube_channel_id) : true;
                const isMatchingTitle = currentItem && ls.title === currentItem.title;
                const isOverdue = streamEnd ? (now.getTime() >= streamEnd.getTime()) : true;

                if (isMatchingChannel && isMatchingTitle && isOverdue) {
                  console.log(`[RotationService] Sweep overdue rotation stream ${ls.id} ("${ls.title}")`);
                  await streamingService.stopStream(ls.id);
                }
              }
            } catch (sweepErr) {
              console.error(`[RotationService] Sweep overdue gagal: ${sweepErr.message}`);
            }
          }
          failedRotationStarts.delete(streamKey);
        }

        if (rotation.repeat_mode && rotation.repeat_mode !== 'none') {
          // Window ended -> reschedule for next cycle (reset auto_extend_count)
          const nextSchedule = getNextSchedule(rotation);
          await Rotation.update(rotation.id, {
            current_index: 0,
            start_time: formatLocalDateTime(nextSchedule.start),
            end_time: formatLocalDateTime(nextSchedule.end),
            auto_extend_count: 0,
            status: 'active'
          }, rotation.user_id);
          console.log(`[RotationService] Time window ended. Rescheduled rotation ${rotation.name} for ${formatLocalDateTime(nextSchedule.start)}`);
        } else {
          await Rotation.update(rotation.id, {
            current_index: 0,
            auto_extend_count: 0,
            status: 'completed'
          }, rotation.user_id);
          console.log(`[RotationService] Time window ended. Rotation ${rotation.name} completed (non-repeating)`);
        }
        continue;
      }

      const currentItem = items[currentIndex];
      if (!currentItem) continue;

      const streamKey = `${rotation.id}_${currentItem.id}`;
      const windowKey = `${rotation.start_time}|${rotation.end_time}|${currentIndex}`;

      if (failedRotationStarts.get(streamKey) === windowKey) {
        continue;
      }

      if (activeRotationStreams.has(streamKey)) {
        if (!loggedAlreadyRunning.has(streamKey)) {
          console.log(`[RotationService] Rotation item ${currentIndex + 1}/${items.length} already running: ${currentItem.title}`);
          loggedAlreadyRunning.add(streamKey);
        }
        continue;
      }

      // Rotasi ini butuh start — kumpulkan dulu
      rotationsToStart.push({ rotation, items, currentIndex, currentItem, streamKey, windowKey });
    }

    // ── SMART STAGGERED QUEUE ──────────────────────────────────────────────
    // Urutkan berdasarkan channel agar channel yang sama tidak dobel-start
    // Tiap channel unik mendapat jeda STAGGER_DELAY_MS dari channel sebelumnya
    if (rotationsToStart.length > 0) {
      console.log(`[RotationService] ${rotationsToStart.length} rotasi perlu start. Mengantre dengan stagger per channel...`);

      // Hitung kapan setiap channel boleh start berikutnya
      // channelStartQueue berisi Promise<void> yang resolve saat giliran tiba
      const channelSlots = new Map(); // channelKey -> slotIndex (berapa banyak sudah terjadwal untuk channel ini)
      const nowMs = Date.now();

      // Bersihkan entri lama (> 10 menit) di channelStartQueue
      for (const [key, ts] of channelStartQueue.entries()) {
        if (nowMs - ts > 10 * 60 * 1000) channelStartQueue.delete(key);
      }

      // Hitung slot index global (bukan per-channel) untuk beri delay kumulatif
      let globalSlot = 0;

      for (const entry of rotationsToStart) {
        const { rotation, items, currentIndex, currentItem, streamKey, windowKey } = entry;

        // channelKey: per user + per youtube channel (atau rtmp url sebagai fallback)
        const channelKey = `${rotation.user_id}|${rotation.youtube_channel_id || rotation.rtmp_url || 'default'}`;

        // Cari slot berikutnya untuk channel ini
        const lastQueuedTs = channelStartQueue.get(channelKey) || 0;
        const minStartTs = Math.max(lastQueuedTs + STAGGER_DELAY_MS, nowMs + globalSlot * STAGGER_DELAY_MS);
        channelStartQueue.set(channelKey, minStartTs);

        const waitMs = Math.max(0, minStartTs - Date.now());
        globalSlot++;

        if (waitMs > 0) {
          console.log(`[RotationService] Rotasi "${rotation.name}" (channel ${channelKey.split('|')[1]}) antre: mulai dalam ${Math.round(waitMs / 1000)}s`);
        }

        // Jalankan start dengan delay yang dihitung (non-blocking agar semua terjadwal dulu)
        (async () => {
          if (waitMs > 0) await delay(waitMs);

          console.log(`[RotationService] Starting rotation item ${currentIndex + 1}/${items.length}: ${currentItem.title}`);
          const result = await startRotationStream(rotation, currentItem);
          if (result.success) {
            failedRotationStarts.delete(streamKey);
            activeRotationStreams.set(streamKey, { 
              rotationId: rotation.id, 
              itemId: currentItem.id,
              streamId: result.streamId 
            });
            await Rotation.update(rotation.id, { status: 'live' }, rotation.user_id);
          } else if (result.code === 'UNSUPPORTED_COPY_MODE_MEDIA') {
            failedRotationStarts.delete(streamKey);
            await moveRotationToNextScheduledItem(
              rotation,
              items,
              currentIndex,
              `Item "${currentItem.title}" di-skip karena media tidak kompatibel dengan copy mode YouTube.`
            );
          } else {
            failedRotationStarts.set(streamKey, windowKey);
            console.error(`[RotationService] Failed to start item ${currentIndex + 1}/${items.length}: ${result.error}`);

            // Kirim notifikasi kegagalan khusus ke user bersangkutan
            try {
              let userFriendlyMsg = result.error || 'Terjadi kesalahan saat memulai broadcast.';
              let errorType = 'error';

              if (userFriendlyMsg.includes('suspended')) {
                userFriendlyMsg = `Akun YouTube dari channel ditangguhkan (suspended) oleh Google. Silakan periksa akun YouTube Anda.`;
                if (rotation.youtube_channel_id) {
                  await YoutubeChannel.update(rotation.youtube_channel_id, {
                    oauth_status: 'suspended',
                    last_error: 'YouTube account suspended by Google',
                    last_checked_at: new Date().toISOString()
                  });
                }
              } else if (userFriendlyMsg.includes('unauthorized') || userFriendlyMsg.includes('not connected') || userFriendlyMsg.includes('invalid_grant')) {
                userFriendlyMsg = `Izin token YouTube channel kadaluarsa atau dicabut. Silakan sambungkan ulang channel di menu Settings.`;
                if (rotation.youtube_channel_id) {
                  await YoutubeChannel.update(rotation.youtube_channel_id, {
                    oauth_status: 'expired',
                    last_error: 'OAuth token invalid/expired',
                    last_checked_at: new Date().toISOString()
                  });
                }
              } else if (userFriendlyMsg.includes('Video not found')) {
                userFriendlyMsg = `File video "${currentItem.title}" tidak ditemukan di server. Pastikan video belum terhapus dari galeri.`;
              } else if (userFriendlyMsg.includes('already in progress')) {
                userFriendlyMsg = `Siaran sedang dalam proses inisialisasi. Stagger otomatis aktif — coba tunggu giliran antrian berikutnya.`;
                errorType = 'warning';
              } else if (userFriendlyMsg.includes('quota') || userFriendlyMsg.includes('rateLimit') || userFriendlyMsg.includes('403')) {
                userFriendlyMsg = `Kuota YouTube API habis atau terkena batas rate-limit Google. Disarankan gunakan Project Client ID terpisah.`;
              }

              await Notification.create({
                user_id: rotation.user_id,
                type: errorType,
                title: `Gagal Memulai Rotasi: ${rotation.name}`,
                message: `Item #${currentIndex + 1} ("${currentItem.title}"): ${userFriendlyMsg}`,
                metadata: { rotationId: rotation.id, itemId: currentItem.id, rawError: result.error }
              });
            } catch (notifErr) {
              console.error('[RotationService] Gagal membuat notifikasi user:', notifErr.message);
            }
          }
          loggedAlreadyRunning.delete(streamKey);
        })().catch(err => {
          console.error(`[RotationService] Stagger async error untuk "${rotation.name}":`, err.message);
        });
      }
    }
  } catch (error) {
    console.error('[RotationService] Error checking rotations:', error);
  }
}

async function startRotationStream(rotation, item) {
  try {
    let actualVideoId = item.video_id;
    if (item.video_id && item.video_id.startsWith('playlist:')) {
      actualVideoId = item.video_id.substring(9);
    }

    await streamingService.validateCopyModeCompatibilityForInput({
      videoId: actualVideoId,
      useAdvancedSettings: false,
      isYouTubeApi: !(rotation.rtmp_url && rotation.stream_key)
    });

    const user = await User.findById(rotation.user_id);
    if (!user) {
      console.error('[RotationService] User not found');
      return { success: false, error: 'User not found' };
    }

    if (rotation.rtmp_url && rotation.stream_key && !rotation.youtube_channel_id) {
      console.log(`[RotationService] Using custom RTMP for rotation ${rotation.name}`);
      
      const stream = await Stream.create({
        title: item.title,
        video_id: actualVideoId,
        rtmp_url: rotation.rtmp_url,
        stream_key: rotation.stream_key,
        platform: 'Custom RTMP',
        platform_icon: 'broadcast',
        loop_video: true,
        use_advanced_settings: false,
        status: 'scheduled',
        user_id: rotation.user_id,
        is_youtube_api: false,
        schedule_time: rotation.start_time,
        end_time: rotation.end_time,
        is_rotation: true,
        auto_extend: rotation.auto_extend === 1 || rotation.auto_extend === true || rotation.auto_extend === '1',
        auto_extend_min_viewers: rotation.auto_extend_min_viewers || 10,
        auto_extend_duration: rotation.auto_extend_duration || 30,
        auto_extend_count: rotation.auto_extend_count || 0,
        auto_extend_max: rotation.auto_extend_max || 0
      });

      const startResult = await streamingService.startStream(stream.id);
      if (!startResult.success) {
        return {
          success: false,
          error: startResult.error,
          code: startResult.code || null
        };
      }

      return { success: true, streamId: stream.id, broadcastId: null };
    }

    const YoutubeChannel = require('../models/YoutubeChannel');
    let selectedChannel = null;
    
    if (rotation.youtube_channel_id) {
      selectedChannel = await YoutubeChannel.findById(rotation.youtube_channel_id);
    }
    if (!selectedChannel) {
      selectedChannel = await YoutubeChannel.findDefault(rotation.user_id);
    }
    if (!selectedChannel) {
      const userChannels = await YoutubeChannel.findAll(rotation.user_id);
      if (userChannels.length > 0) {
        selectedChannel = userChannels[0];
      }
    }
    
    if (!selectedChannel || selectedChannel.user_id !== rotation.user_id) {
      console.error(`[RotationService] [ERROR] YouTube channel association broken or unauthorized for rotation ${rotation.id}. Expected Channel UUID: ${rotation.youtube_channel_id}`);
      return { success: false, error: 'YouTube channel not found or unauthorized. Please select a channel in rotation settings.' };
    }

    if (!selectedChannel || !selectedChannel.access_token) {
      console.error('[RotationService] YouTube not connected');
      return { success: false, error: 'YouTube not connected' };
    }

    // Reuse or create local Stream record for rotation
    const userStreams = await new Promise((resolve) => {
      const { db } = require('../db/database');
      db.all('SELECT * FROM streams WHERE user_id = ? AND is_rotation = 1', [rotation.user_id], (err, rows) => {
        resolve(rows || []);
      });
    });
    let stream = userStreams.find(s => 
      s.schedule_time === rotation.start_time &&
      s.title === item.title &&
      s.video_id === actualVideoId &&
      s.is_youtube_api &&
      (s.status === 'scheduled' || s.status === 'offline' || s.status === 'starting' || s.status === 'live')
    );

    if (!stream) {
      const thumbnailToUpload = item.original_thumbnail_path || item.thumbnail_path;
      let thumbUrl = null;
      if (thumbnailToUpload) {
        thumbUrl = `/uploads/thumbnails/${thumbnailToUpload}`;
      }

      stream = await Stream.create({
        title: item.title,
        video_id: actualVideoId,
        rtmp_url: '',
        stream_key: '',
        platform: 'YouTube',
        platform_icon: 'brand-youtube',
        loop_video: true,
        use_advanced_settings: false,
        status: 'scheduled',
        user_id: rotation.user_id,
        youtube_description: item.description,
        youtube_privacy: item.privacy,
        youtube_category: item.category,
        youtube_tags: item.tags,
        youtube_monetization: item.youtube_monetization === true || item.youtube_monetization === 1,
        youtube_altered_content: item.youtube_altered_content,
        youtube_made_for_kids: item.youtube_made_for_kids,
        youtube_channel_id: selectedChannel.id,
        youtube_thumbnail: thumbUrl,
        is_youtube_api: true,
        schedule_time: rotation.start_time,
        end_time: rotation.end_time,
        is_rotation: true,
        auto_extend: rotation.auto_extend === 1 || rotation.auto_extend === true || rotation.auto_extend === '1',
        auto_extend_min_viewers: rotation.auto_extend_min_viewers || 10,
        auto_extend_duration: rotation.auto_extend_duration || 30,
        auto_extend_count: rotation.auto_extend_count || 0,
        auto_extend_max: rotation.auto_extend_max || 0,
        auto_redirect: rotation.auto_redirect === 1 || rotation.auto_redirect === true || rotation.auto_redirect === '1',
        auto_redirect_min_viewers: rotation.auto_redirect_min_viewers || 10,
        auto_redirect_target_stream_id: rotation.auto_redirect_target_stream_id || null
      });
    } else {
      console.log(`[RotationService] Found existing local stream record ${stream.id} for rotation item "${item.title}". Will attempt reuse.`);
      await Stream.update(stream.id, {
        auto_extend: rotation.auto_extend === 1 || rotation.auto_extend === true || rotation.auto_extend === '1' ? 1 : 0,
        auto_extend_min_viewers: rotation.auto_extend_min_viewers || 10,
        auto_extend_duration: rotation.auto_extend_duration || 30,
        auto_extend_max: rotation.auto_extend_max || 0,
        auto_redirect: rotation.auto_redirect === 1 || rotation.auto_redirect === true || rotation.auto_redirect === '1' ? 1 : 0,
        auto_redirect_min_viewers: rotation.auto_redirect_min_viewers || 10,
        auto_redirect_target_stream_id: rotation.auto_redirect_target_stream_id || null
      }, rotation.user_id);
    }

    const startResult = await streamingService.startStream(stream.id);
    if (!startResult.success) {
      return {
        success: false,
        error: startResult.error,
        code: startResult.code || null
      };
    }

    const updatedStream = await Stream.findById(stream.id);
    return { success: true, streamId: stream.id, broadcastId: updatedStream ? updatedStream.youtube_broadcast_id : null };
  } catch (error) {
    console.error('[RotationService] Error starting rotation stream:', error);
    return { success: false, error: error.message, code: error.code || null };
  }
}

async function stopRotationStream(rotation, item) {
  try {
    let rotationData = rotation;
    if (!rotation.user_id) {
      const fetched = await Rotation.findById(rotation.id);
      if (fetched) {
        rotationData = fetched;
      }
    }
    const user = await User.findById(rotationData.user_id);
    if (!user) return { success: false, error: 'User not found' };

    let actualVideoId = item.video_id;
    if (item.video_id && item.video_id.startsWith('playlist:')) {
      actualVideoId = item.video_id.substring(9);
    }

    const streamKey = `${rotationData.id}_${item.id}`;
    const streamInfo = activeRotationStreams.get(streamKey);
    let streamId = streamInfo ? streamInfo.streamId : null;
    
    if (!streamId) {
      // Fallback: search in DB if not in memory (legacy/safety)
      const streams = await new Promise((resolve) => {
        const { db } = require('../db/database');
        db.all('SELECT * FROM streams WHERE user_id = ? AND is_rotation = 1', [rotationData.user_id], (err, rows) => {
          resolve(rows || []);
        });
      });
      const rotationStream = streams.find(s => 
        s.video_id === actualVideoId && 
        s.title === item.title && 
        s.status === 'live'
      );
      if (rotationStream) streamId = rotationStream.id;
    }

    if (streamId) {
      // stopStream sudah handle kill FFmpeg + complete YouTube via youtubeService
      // (per-channel Client ID + cek lifecycle). Jangan transition manual di sini
      // agar tidak double-complete (Redundant transition) dan tidak
      // unauthorized_client (token channel A dipakai dengan Client-B).
      await streamingService.stopStream(streamId);
    }

    // Clean up tracking maps
    activeRotationStreams.delete(streamKey);
    loggedAlreadyRunning.delete(streamKey);

    return { success: true };
  } catch (error) {
    console.error('[RotationService] Error stopping rotation stream:', error);
    return { success: false, error: error.message };
  }
}

async function activateRotation(rotationId) {
  try {
    const rotation = await Rotation.findById(rotationId);
    if (!rotation) {
      return { success: false, error: 'Rotation not found' };
    }

    const now = new Date();
    const window = calculateRotationWindow(rotation, now);
    
    const updateData = {
      status: 'active',
      current_index: 0,
      start_time: formatLocalDateTime(window.start),
      end_time: formatLocalDateTime(window.end)
    };
    
    console.log(`[RotationService] Activating rotation ${rotationId} for ${formatLocalDateTime(window.start)} - ${formatLocalDateTime(window.end)}`);

    await Rotation.update(rotationId, updateData, rotation.user_id);
    checkRotations();
    return { success: true };
  } catch (error) {
    console.error('[RotationService] Error activating rotation:', error);
    return { success: false, error: error.message };
  }
}

async function pauseRotation(rotationId) {
  try {
    const rotation = await Rotation.findByIdWithItems(rotationId);
    if (!rotation) return { success: false, error: 'Rotation not found' };

    for (const item of rotation.items) {
      const streamKey = `${rotationId}_${item.id}`;
      if (activeRotationStreams.has(streamKey)) {
        await stopRotationStream(rotation, item);
        activeRotationStreams.delete(streamKey);
        loggedAlreadyRunning.delete(streamKey);
      }
      failedRotationStarts.delete(streamKey);
    }

    await Rotation.update(rotationId, { status: 'paused' }, rotation.user_id);
    return { success: true };
  } catch (error) {
    console.error('[RotationService] Error pausing rotation:', error);
    return { success: false, error: error.message };
  }
}

async function stopRotation(rotationId) {
  try {
    const rotation = await Rotation.findByIdWithItems(rotationId);
    if (!rotation) return { success: false, error: 'Rotation not found' };

    for (const item of rotation.items) {
      const streamKey = `${rotationId}_${item.id}`;
      if (activeRotationStreams.has(streamKey)) {
        await stopRotationStream(rotation, item);
        activeRotationStreams.delete(streamKey);
        loggedAlreadyRunning.delete(streamKey);
      }
      failedRotationStarts.delete(streamKey);
    }

    await Rotation.update(rotationId, { status: 'inactive', current_index: 0 }, rotation.user_id);
    return { success: true };
  } catch (error) {
    console.error('[RotationService] Error stopping rotation:', error);
    return { success: false, error: error.message };
  }
}

function shutdown() {
  console.log('[RotationService] Shutting down rotation service...');
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
  }
  
  for (const [streamKey, streamInfo] of activeRotationStreams) {
    console.log(`[RotationService] Stopping active rotation stream: ${streamKey}`);
    stopRotationStream({ id: streamInfo.rotationId }, { id: streamInfo.itemId }).catch(err => {
      console.error(`[RotationService] Error stopping stream ${streamKey} during shutdown:`, err);
    });
  }
  activeRotationStreams.clear();
  failedRotationStarts.clear();
}

module.exports = {
  init,
  shutdown,
  checkRotations,
  startRotationStream,
  stopRotationStream,
  activateRotation,
  pauseRotation,
  stopRotation
};
