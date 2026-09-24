const Rotation = require('../models/Rotation');
const Stream = require('../models/Stream');
const User = require('../models/User');
const streamingService = require('./streamingService');
const { google } = require('googleapis');
const { encrypt, decrypt } = require('../utils/encryption');
const path = require('path');
const fs = require('fs');
const { syncBroadcastMonetization, sanitizeYouTubeTags } = require('./youtubeService');

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
  const str = dateStr.replace('Z', '').split('.')[0];
  const [datePart, timePart] = str.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes, seconds] = (timePart || '00:00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds || 0);
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

async function checkRotations() {
  try {
    const activeRotations = await Rotation.findActiveRotations();
    const now = new Date();

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
        console.log(`[RotationService] Rotation ${rotation.name} time window has ended`);
        
        const currentItem = items[currentIndex];
        if (currentItem) {
          const streamKey = `${rotation.id}_${currentItem.id}`;
          if (activeRotationStreams.has(streamKey)) {
            await stopRotationStream(rotation, currentItem);
            activeRotationStreams.delete(streamKey);
            loggedAlreadyRunning.delete(streamKey);
            await Rotation.update(rotation.id, { status: 'active' }, rotation.user_id);
          }
          failedRotationStarts.delete(streamKey);
        }

        if (rotation.repeat_mode && rotation.repeat_mode !== 'none') {
          // Window ended -> reschedule for next cycle
          const nextSchedule = getNextSchedule(rotation);
          await Rotation.update(rotation.id, {
            current_index: 0,
            start_time: formatLocalDateTime(nextSchedule.start),
            end_time: formatLocalDateTime(nextSchedule.end),
            status: 'active'
          }, rotation.user_id);
          console.log(`[RotationService] Time window ended. Rescheduled rotation ${rotation.name} for ${formatLocalDateTime(nextSchedule.start)}`);
        } else {
          await Rotation.update(rotation.id, {
            current_index: 0,
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

      if (!activeRotationStreams.has(streamKey)) {
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
        }
        loggedAlreadyRunning.delete(streamKey);
      } else {
        if (!loggedAlreadyRunning.has(streamKey)) {
          console.log(`[RotationService] Rotation item ${currentIndex + 1}/${items.length} already running: ${currentItem.title}`);
          loggedAlreadyRunning.add(streamKey);
        }
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
        is_rotation: true
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
        is_rotation: true
      });
    } else {
      console.log(`[RotationService] Found existing local stream record ${stream.id} for rotation item "${item.title}". Will attempt reuse.`);
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
      const stream = await Stream.findById(streamId);
      await streamingService.stopStream(streamId);

      if (stream && stream.youtube_broadcast_id) {
        try {
          const YoutubeChannel = require('../models/YoutubeChannel');
          let selectedChannel = null;
          
          if (stream.youtube_channel_id) {
            selectedChannel = await YoutubeChannel.findById(stream.youtube_channel_id);
          }
          
          if (!selectedChannel || selectedChannel.user_id !== user.id) {
            console.error(`[RotationService] [WARN] Cannot complete YouTube broadcast: Channel not found or unauthorized for stream ${stream.id}`);
            return { success: true }; // Still return success for the local stop operation
          }

          if (selectedChannel && selectedChannel.access_token) {
            const oauth2Client = new google.auth.OAuth2(
              user.youtube_client_id,
              decrypt(user.youtube_client_secret),
              getRedirectUri(user)
            );

            oauth2Client.setCredentials({
              access_token: decrypt(selectedChannel.access_token),
              refresh_token: decrypt(selectedChannel.refresh_token)
            });

            oauth2Client.on('tokens', async (tokens) => {
              if (tokens.access_token) {
                await YoutubeChannel.update(selectedChannel.id, {
                  access_token: encrypt(tokens.access_token)
                });
              }
              if (tokens.refresh_token) {
                await YoutubeChannel.update(selectedChannel.id, {
                  refresh_token: encrypt(tokens.refresh_token)
                });
              }
            });

            const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

            await youtube.liveBroadcasts.transition({
              part: ['status'],
              id: stream.youtube_broadcast_id,
              broadcastStatus: 'complete'
            });
          }
        } catch (ytError) {
          console.error('[RotationService] Error completing YouTube broadcast:', ytError.message);
        }
      }
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
