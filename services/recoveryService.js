/**
 * recoveryService.js
 *
 * Smart Startup Recovery Service
 * Saat app restart/crash, service ini scan orphan FFmpeg processes,
 * cocokkan dengan data DB, lalu:
 *  - Stream masih dalam jadwal  → kill orphan + restart otomatis
 *  - Stream di luar jadwal      → kill orphan + update DB → offline
 *  - Rotasi masih dalam window  → biarkan rotationService handle (sudah active di DB)
 *  - Rotasi di luar window      → update DB → inactive/completed
 */

'use strict';

const { execSync } = require('child_process');
const { db } = require('../db/database');
const Stream = require('../models/Stream');

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Parse datetime string lokal (tanpa timezone) menjadi Date.
 * Format: "YYYY-MM-DDTHH:MM:SS" atau ISO dengan/tanpa Z.
 */
function parseLocalDateTime(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).replace('Z', '').split('.')[0];
  const [datePart, timePart] = str.split('T');
  if (!datePart) return null;
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = (timePart || '00:00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

/**
 * Scan semua proses FFmpeg yang berjalan di sistem.
 * Return: array of { pid, rtmpUrl, args }
 */
function scanOrphanFFmpegProcesses() {
  try {
    if (process.platform === 'win32') {
      // Windows: pakai wmic
      const out = execSync('wmic process where "name=\'ffmpeg.exe\'" get ProcessId,CommandLine /format:csv 2>nul', {
        stdio: 'pipe',
        timeout: 5000
      }).toString();

      const results = [];
      const lines = out.split('\n').filter(l => l.includes('ffmpeg'));
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 3) {
          const pid = parseInt(parts[parts.length - 1].trim(), 10);
          const cmdLine = parts.slice(1, -1).join(',');
          const rtmpMatch = cmdLine.match(/rtmps?:\/\/[^\s]+/i);
          if (!isNaN(pid) && rtmpMatch) {
            results.push({ pid, rtmpUrl: rtmpMatch[0], args: cmdLine });
          }
        }
      }
      return results;
    } else {
      // Linux/macOS: pakai ps aux
      const out = execSync('ps aux 2>/dev/null | grep ffmpeg | grep -v grep', {
        stdio: 'pipe',
        timeout: 5000
      }).toString();

      const results = [];
      const lines = out.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[1], 10);
        const rtmpMatch = line.match(/rtmps?:\/\/[^\s]+/i);
        if (!isNaN(pid) && rtmpMatch) {
          results.push({ pid, rtmpUrl: rtmpMatch[0], args: line });
        }
      }
      return results;
    }
  } catch (e) {
    // ps gagal = tidak ada ffmpeg yang jalan, atau tidak ada akses
    return [];
  }
}

/**
 * Kill proses berdasarkan PID (force kill).
 */
function killByPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F 2>nul`, { stdio: 'pipe', timeout: 3000 });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (e) {
    // Proses sudah mati, abaikan
  }
}

/**
 * Normalkan RTMP URL untuk perbandingan (hapus trailing slash, lowercase).
 */
function normalizeRtmp(url) {
  return (url || '').toLowerCase().replace(/\/+$/, '').trim();
}

/**
 * Ambil semua stream dari DB (tanpa filter status) yang punya RTMP URL.
 */
function getAllStreamsFromDb() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, title, status, rtmp_url, stream_key, schedule_time, start_time, end_time, duration, user_id, is_rotation
       FROM streams
       WHERE rtmp_url IS NOT NULL AND rtmp_url != ''`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

/**
 * Ambil semua rotasi dari DB.
 */
function getAllRotationsFromDb() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, name, status, start_time, end_time, repeat_mode, current_index, user_id
       FROM stream_rotations
       WHERE status IN ('active', 'live')`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

/**
 * Update status stream di DB.
 */
function updateStreamStatus(streamId, status) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE streams SET status = ?, status_updated_at = ? WHERE id = ?`,
      [status, new Date().toISOString(), streamId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Update status rotasi di DB.
 */
function updateRotationStatus(rotationId, status) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE stream_rotations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, rotationId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Cek apakah stream masih dalam window jadwal saat ini.
 * Support: end_time (kolom langsung), atau start_time + duration.
 */
function isStreamInScheduleWindow(stream) {
  const now = new Date();

  // Prioritas 1: gunakan end_time langsung
  if (stream.end_time) {
    const endTime = new Date(stream.end_time);
    if (!isNaN(endTime.getTime()) && now < endTime) {
      return true;
    }
  }

  // Prioritas 2: start_time + duration (detik)
  if (stream.start_time && stream.duration) {
    const startTime = new Date(stream.start_time);
    if (!isNaN(startTime.getTime())) {
      const endByDuration = new Date(startTime.getTime() + stream.duration * 1000);
      if (now < endByDuration) {
        return true;
      }
    }
  }

  // Tidak ada jadwal yang valid = anggap sudah selesai
  return false;
}

/**
 * Cek apakah rotasi masih dalam window waktu aktif saat ini.
 */
function isRotationInWindow(rotation) {
  if (!rotation.start_time || !rotation.end_time) return false;

  const now = new Date();
  const start = parseLocalDateTime(rotation.start_time);
  const end = parseLocalDateTime(rotation.end_time);

  if (!start || !end) return false;

  return now >= start && now < end;
}

// ──────────────────────────────────────────────
// Main Recovery Function
// ──────────────────────────────────────────────

async function runStartupRecovery(streamingService) {
  console.log('[RecoveryService] ===== Starting Smart Startup Recovery =====');

  // Beri waktu 2 detik agar DB sepenuhnya siap
  await new Promise(r => setTimeout(r, 2000));

  try {
    // 1. Scan FFmpeg orphan processes
    const orphanProcesses = scanOrphanFFmpegProcesses();
    console.log(`[RecoveryService] Found ${orphanProcesses.length} orphan FFmpeg process(es) running`);

    // 2. Ambil semua stream dari DB
    const allStreams = await getAllStreamsFromDb();
    const liveStreams = allStreams.filter(s => s.status === 'live');
    console.log(`[RecoveryService] Found ${liveStreams.length} stream(s) with status=live in DB`);

    // 3. Build map RTMP → orphan process untuk lookup cepat
    const rtmpToOrphan = new Map();
    for (const orphan of orphanProcesses) {
      rtmpToOrphan.set(normalizeRtmp(orphan.rtmpUrl), orphan);
    }

    // 4. Proses setiap stream yang statusnya live
    const streamsToRestart = [];
    const streamsToOffline = [];

    for (const stream of liveStreams) {
      // Full RTMP URL = rtmp_url + stream_key
      const fullRtmp = normalizeRtmp(`${stream.rtmp_url}/${stream.stream_key}`);
      const orphan = rtmpToOrphan.get(fullRtmp);

      if (orphan) {
        // Ada FFmpeg orphan yang cocok → kill dulu sebelum restart
        console.log(`[RecoveryService] Killing orphan PID ${orphan.pid} for stream "${stream.title}"`);
        killByPid(orphan.pid);
        rtmpToOrphan.delete(fullRtmp);
      }

      // Cek apakah masih dalam jadwal
      if (isStreamInScheduleWindow(stream)) {
        streamsToRestart.push(stream);
      } else {
        streamsToOffline.push(stream);
      }
    }

    // 5. Kill sisa orphan yang tidak cocok dengan stream apapun
    for (const [rtmp, orphan] of rtmpToOrphan) {
      console.log(`[RecoveryService] Killing untracked orphan PID ${orphan.pid} (${rtmp})`);
      killByPid(orphan.pid);
    }

    // 6. Update stream di luar jadwal → offline
    for (const stream of streamsToOffline) {
      console.log(`[RecoveryService] Stream "${stream.title}" out of schedule → offline`);
      await updateStreamStatus(stream.id, 'offline');
    }

    // 7. Restart stream yang masih dalam jadwal
    if (streamsToRestart.length > 0) {
      console.log(`[RecoveryService] Restarting ${streamsToRestart.length} stream(s) still within schedule...`);
      // Delay kecil agar semua kill selesai dulu
      await new Promise(r => setTimeout(r, 1500));

      for (const stream of streamsToRestart) {
        try {
          console.log(`[RecoveryService] Restarting stream "${stream.title}" (${stream.id})`);
          // Reset status ke offline dulu agar startStream tidak reject karena sudah live
          await updateStreamStatus(stream.id, 'offline');
          const result = await streamingService.startStream(stream.id, false);
          if (result && result.success) {
            console.log(`[RecoveryService] ✓ Stream "${stream.title}" restarted successfully`);
          } else {
            console.warn(`[RecoveryService] ✗ Stream "${stream.title}" failed to restart: ${result && result.error}`);
            await updateStreamStatus(stream.id, 'offline');
          }
        } catch (err) {
          console.error(`[RecoveryService] Error restarting stream "${stream.title}":`, err.message);
          await updateStreamStatus(stream.id, 'offline');
        }
        // Jeda antar stream agar tidak overload
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 8. Cek rotasi di luar window → set inactive
    const activeRotations = await getAllRotationsFromDb();
    console.log(`[RecoveryService] Checking ${activeRotations.length} active rotation(s)...`);

    for (const rotation of activeRotations) {
      if (!isRotationInWindow(rotation)) {
        // Rotasi di luar window tapi masih status active/live
        // Biarkan rotationService.checkRotations() yang handle reschedule-nya
        // Kita hanya log saja tanpa ubah status supaya tidak konflik
        console.log(`[RecoveryService] Rotation "${rotation.name}" outside window — rotationService will handle reschedule`);
      } else {
        console.log(`[RecoveryService] Rotation "${rotation.name}" still within window — rotationService will restart`);
      }
    }

    console.log('[RecoveryService] ===== Smart Startup Recovery Complete =====');
    console.log(`[RecoveryService] Summary: ${streamsToRestart.length} restarted | ${streamsToOffline.length} set offline | ${orphanProcesses.length} orphan(s) killed`);

  } catch (err) {
    console.error('[RecoveryService] Recovery failed:', err);
    // Jangan crash app, cukup log saja
  }
}

module.exports = { runStartupRecovery };
