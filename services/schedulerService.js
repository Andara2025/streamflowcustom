const Stream = require('../models/Stream');

const scheduledTerminations = new Map();
const SCHEDULE_CHECK_INTERVAL = 15000;
const DURATION_CHECK_INTERVAL = 15000;

let streamingService = null;
let initialized = false;
let scheduleIntervalId = null;
let durationIntervalId = null;

function init(streamingServiceInstance) {
  if (initialized) {
    return;
  }

  streamingService = streamingServiceInstance;
  streamingService.setSchedulerService(module.exports);
  initialized = true;

  scheduleIntervalId = setInterval(checkScheduledStreams, SCHEDULE_CHECK_INTERVAL);
  durationIntervalId = setInterval(checkStreamDurations, DURATION_CHECK_INTERVAL);

  checkScheduledStreams();
  checkStreamDurations();
}

async function checkScheduledStreams() {
  try {
    if (!streamingService) {
      return;
    }

    const now = new Date();
    const streams = await Stream.findScheduledInRange(null, now);

    for (const stream of streams) {
      if (streamingService.isStreamActive(stream.id) || streamingService.isStreamStarting(stream.id)) {
        continue;
      }

      const currentStream = await Stream.findById(stream.id);
      if (!currentStream || currentStream.status !== 'scheduled') {
        continue;
      }

      // PERMANENT FIX: double-check jadwal, jangan start jika schedule_time masih di masa depan (cegah live prematur karena timezone)
      if (currentStream.schedule_time) {
        const sched = new Date(currentStream.schedule_time);
        // toleransi 60 detik agar tidak miss
        if (!isNaN(sched.getTime()) && sched.getTime() > now.getTime() + 60000) {
          continue;
        }
      }

      const baseUrl = process.env.BASE_URL || 'http://localhost:7575';
      const result = await streamingService.startStream(stream.id, false, baseUrl);

      if (!result.success) {
        console.error(`[Scheduler] Failed to start stream ${stream.id}: ${result.error}`);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error checking scheduled streams:', error);
  }
}

async function checkStreamDurations() {
  try {
    if (!streamingService) {
      return;
    }

    const liveStreams = await Stream.findAll(null, 'live');

    for (const stream of liveStreams) {
      if (!stream.end_time) {
        continue;
      }

      const endTime = new Date(stream.end_time);
      if (isNaN(endTime.getTime())) {
        console.error(`[Scheduler] Stream ${stream.id} ("${stream.title}") end_time tidak valid: ${stream.end_time}`);
        continue;
      }
      const now = new Date();
      const timeUntilEnd = endTime.getTime() - now.getTime();
      const overdueMin = Math.round(-timeUntilEnd / 60000);

      // --- SMART AUDIENCE AUTOMATION (AUTO-EXTEND & REDIRECT) ---
      if (stream.auto_extend && timeUntilEnd <= 60000) {
        try {
          const { getLiveViewerCount, sendLiveChatMessage } = require('./youtubeService');
          const viewers = await getLiveViewerCount(stream);
          const minViewers = stream.auto_extend_min_viewers || 10;
          const maxExtends = stream.auto_extend_max || 0;
          const currentExtends = stream.auto_extend_count || 0;

          if (viewers !== null && viewers >= minViewers && (maxExtends === 0 || currentExtends < maxExtends)) {
            const extendMinutes = stream.auto_extend_duration || 60;
            const newEndTime = new Date(now.getTime() + extendMinutes * 60000).toISOString();
            const newCount = currentExtends + 1;

            console.log(`[Scheduler] 🚀 AUTO-EXTEND TRIGGERED for stream ${stream.id} ("${stream.title}"): Viewers = ${viewers} (min: ${minViewers}). Extending by ${extendMinutes} mins to ${newEndTime} (Extension #${newCount})`);

            await Stream.update(stream.id, {
              end_time: newEndTime,
              auto_extend_count: newCount,
              loop_video: true
            });

            scheduledTerminations.delete(stream.id);

            if (stream.is_youtube_api) {
              await sendLiveChatMessage(stream, `🎉 Siaran live diperpanjang otomatis +${extendMinutes} menit karena antusiasme penonton! Tetap nikmati tayangannya.`);
            }

            continue;
          } else {
            if (viewers !== null) {
              console.log(`[Scheduler] Auto-extend not triggered for stream ${stream.id}: Viewers = ${viewers} (required: >= ${minViewers})`);
            }
            if (stream.auto_redirect && (viewers === null || viewers >= (stream.auto_redirect_min_viewers || 10))) {
              if (stream.is_youtube_api) {
                await sendLiveChatMessage(stream, `📢 Live streaming ini akan segera berakhir. Terima kasih banyak atas kehadiran Anda!`);
              }
            }
          }
        } catch (autoErr) {
          console.error(`[Scheduler] Error evaluating auto-extend for stream ${stream.id}:`, autoErr.message);
        }
      }

      if (timeUntilEnd <= 0) {
        // HARD STOP: jadwal sudah lewat -> wajib mati sekarang, bukan besok.
        // Kasus "start jam 10 end jam 11 molor sampai siang" terjadi karena
        // stop lama cuma fire-and-forget + status langsung offline padahal
        // FFmpeg masih hidup.
        console.log(`[Scheduler] STOP ${stream.id} ("${stream.title}") overdue ${overdueMin} mnt (end: ${stream.end_time}, now: ${now.toISOString()})`);
        scheduledTerminations.delete(stream.id);

        try {
          const res = await streamingService.stopStream(stream.id);
          // BACKUP 1: verifikasi FFmpeg benar-benar mati, kalau masih aktif paksa sekali lagi.
          // BACKUP 2: verifikasi DB benar-benar offline (stop bisa sukses kill tapi gagal update DB).
          // Hanya untuk yang sudah overdue (timeUntilEnd <= 0) -> tidak ada risiko stop prematur.
          if (streamingService.isStreamActive(stream.id)) {
            console.error(`[Scheduler] Stream ${stream.id} masih aktif setelah stop, paksa stop kedua...`);
            await streamingService.stopStream(stream.id);
          }
          try {
            const fresh = await Stream.findById(stream.id);
            if (fresh && fresh.status === 'live') {
              const freshEnd = fresh.end_time ? new Date(fresh.end_time).getTime() : NaN;
              if (!isNaN(freshEnd) && freshEnd <= Date.now()) {
                console.error(`[Scheduler] Stream ${stream.id} DB masih live setelah stop, paksa stop kedua...`);
                await streamingService.stopStream(stream.id);
              }
            }
          } catch (_) {}
          if (!res || !res.success) {
            console.error(`[Scheduler] stopStream ${stream.id} gagal: ${res && res.error}`);
          }
        } catch (e) {
          console.error(`[Scheduler] stopStream ${stream.id} exception: ${e.message}`);
          try {
            const fresh = await Stream.findById(stream.id);
            if (fresh && fresh.end_time && new Date(fresh.end_time).getTime() <= Date.now()) {
              await Stream.updateStatus(stream.id, 'offline', stream.user_id);
            }
          } catch (_) {}
        }
      } else if (timeUntilEnd <= 60000 && !scheduledTerminations.has(stream.id) && !stream.auto_extend) {
        scheduleStreamTermination(stream.id, timeUntilEnd / 60000, stream.user_id);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error checking stream durations:', error);
  }
}

function scheduleStreamTermination(streamId, durationMinutes, userId = null) {
  if (!streamingService) {
    return;
  }

  if (typeof durationMinutes !== 'number' || Number.isNaN(durationMinutes) || durationMinutes < 0) {
    return;
  }

  if (scheduledTerminations.has(streamId)) {
    const existing = scheduledTerminations.get(streamId);
    if (existing.timeoutId) {
      clearTimeout(existing.timeoutId);
    }
  }

  const durationMs = Math.max(0, durationMinutes * 60 * 1000);
  const targetEndTime = Date.now() + durationMs;

  const timeoutId = setTimeout(async () => {
    try {
      const stream = await Stream.findById(streamId);
      if (!stream || stream.status !== 'live') {
        scheduledTerminations.delete(streamId);
        return;
      }

      if (stream.auto_extend) {
        // Biarkan checkStreamDurations yang memproses auto-extend
        scheduledTerminations.delete(streamId);
        return;
      }

      await streamingService.stopStream(streamId);
      scheduledTerminations.delete(streamId);
    } catch (error) {
      scheduledTerminations.delete(streamId);
    }
  }, durationMs);

  scheduledTerminations.set(streamId, {
    timeoutId,
    targetEndTime,
    userId
  });
}

function cancelStreamTermination(streamId) {
  if (scheduledTerminations.has(streamId)) {
    const scheduled = scheduledTerminations.get(streamId);
    if (scheduled.timeoutId) {
      clearTimeout(scheduled.timeoutId);
    }
    scheduledTerminations.delete(streamId);
    return true;
  }
  return false;
}

function getScheduledTermination(streamId) {
  const scheduled = scheduledTerminations.get(streamId);
  if (!scheduled) return null;

  return {
    streamId,
    targetEndTime: scheduled.targetEndTime,
    remainingMs: scheduled.targetEndTime ? scheduled.targetEndTime - Date.now() : null
  };
}

function handleStreamStopped(streamId) {
  return cancelStreamTermination(streamId);
}

function scheduleStreamTerminationByEndTime(streamId, endTimeIso, userId = null) {
  if (!streamingService) {
    return;
  }
  if (!endTimeIso) {
    return;
  }
  const endTime = new Date(endTimeIso);
  if (isNaN(endTime.getTime())) {
    console.error(`[Scheduler] scheduleByEndTime ${streamId}: end_time tidak valid: ${endTimeIso}`);
    return;
  }
  const msUntilEnd = endTime.getTime() - Date.now();
  if (msUntilEnd <= 0) {
    // Sudah lewat -> stop sekarang via polling berikutnya, plus coba langsung
    console.log(`[Scheduler] scheduleByEndTime ${streamId}: end_time sudah lewat, stop langsung`);
    streamingService.stopStream(streamId).catch(e => {
      console.error(`[Scheduler] immediate stop ${streamId} gagal: ${e.message}`);
    });
    return;
  }
  // Node setTimeout max ~24.8 hari, jadwal stream selalu < itu. Cap aman.
  const cappedMs = Math.min(msUntilEnd, 2147483647);
  console.log(`[Scheduler] scheduleByEndTime ${streamId}: stop dalam ${Math.round(cappedMs / 60000)} mnt (end: ${endTime.toISOString()})`);
  scheduleStreamTermination(streamId, cappedMs / 60000, userId);
}

function shutdown() {
  if (scheduleIntervalId) {
    clearInterval(scheduleIntervalId);
  }
  if (durationIntervalId) {
    clearInterval(durationIntervalId);
  }

  for (const [streamId, scheduled] of scheduledTerminations) {
    if (scheduled.timeoutId) {
      clearTimeout(scheduled.timeoutId);
    }
  }
  scheduledTerminations.clear();
}

module.exports = {
  init,
  scheduleStreamTermination,
  scheduleStreamTerminationByEndTime,
  cancelStreamTermination,
  getScheduledTermination,
  handleStreamStopped,
  checkScheduledStreams,
  checkStreamDurations,
  shutdown
};
