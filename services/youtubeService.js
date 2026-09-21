const { google } = require('googleapis');
const { encrypt, decrypt } = require('../utils/encryption');
const User = require('../models/User');
const Stream = require('../models/Stream');
const YoutubeChannel = require('../models/YoutubeChannel');
const Video = require('../models/Video');
const fs = require('fs');
const path = require('path');

const loggedAlreadyHasBroadcast = new Set();

// YouTube API Throttle: max 3 concurrent broadcast creations
const YT_MAX_CONCURRENT = 3;
const ytActiveCalls = new Set();
const ytQueue = [];

function ytThrottle(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      ytActiveCalls.add(run);
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        ytActiveCalls.delete(run);
        if (ytQueue.length > 0 && ytActiveCalls.size < YT_MAX_CONCURRENT) {
          const next = ytQueue.shift();
          next();
        }
      }
    };
    if (ytActiveCalls.size < YT_MAX_CONCURRENT) {
      run();
    } else {
      ytQueue.push(run);
    }
  });
}

function getYouTubeOAuth2Client(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function omitUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function sanitizeYouTubeTags(tagsString) {
  if (!tagsString) return [];
  const tagsArray = [];
  let totalLength = 0;
  const rawTags = tagsString
    .split(',')
    .map(t => t.trim().replace(/[<>]/g, ''))
    .filter(t => t);

  for (const tag of rawTags) {
    const slicedTag = tag.slice(0, 90);
    if (slicedTag.length > 0) {
      if (totalLength + slicedTag.length + 1 < 450) {
        tagsArray.push(slicedTag);
        totalLength += slicedTag.length + 1;
      } else {
        break;
      }
    }
  }
  return tagsArray;
}


async function syncBroadcastMonetization(youtube, broadcastId, enabled) {
  const broadcastResponse = await youtube.liveBroadcasts.list({
    part: 'id,snippet,contentDetails,status,monetizationDetails',
    id: broadcastId
  });

  const currentBroadcast = broadcastResponse.data.items?.[0];
  if (!currentBroadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  const currentSnippet = currentBroadcast.snippet || {};
  const currentContentDetails = currentBroadcast.contentDetails || {};
  const currentStatus = currentBroadcast.status || {};
  const currentMonitorStream = currentContentDetails.monitorStream || {};
  const monitorStream = omitUndefined({
    enableMonitorStream: currentMonitorStream.enableMonitorStream,
    broadcastStreamDelayMs:
      currentMonitorStream.enableMonitorStream !== undefined
        ? currentMonitorStream.broadcastStreamDelayMs ?? 0
        : undefined
  });

  const requestBody = {
    id: broadcastId,
    snippet: omitUndefined({
      title: currentSnippet.title,
      description: currentSnippet.description || '',
      scheduledStartTime: currentSnippet.scheduledStartTime,
      scheduledEndTime: currentSnippet.scheduledEndTime
    }),
    contentDetails: omitUndefined({
      boundStreamId: currentContentDetails.boundStreamId,
      enableAutoStart: currentContentDetails.enableAutoStart,
      enableAutoStop: currentContentDetails.enableAutoStop,
      enableClosedCaptions: currentContentDetails.enableClosedCaptions,
      enableContentEncryption: currentContentDetails.enableContentEncryption,
      enableDvr: currentContentDetails.enableDvr,
      enableEmbed: currentContentDetails.enableEmbed,
      latencyPreference: currentContentDetails.latencyPreference,
      projection: currentContentDetails.projection,
      recordFromStart: currentContentDetails.recordFromStart,
      startWithSlate: currentContentDetails.startWithSlate,
      monitorStream: Object.keys(monitorStream).length > 0 ? monitorStream : undefined
    }),
    status: omitUndefined({
      privacyStatus: currentStatus.privacyStatus,
      selfDeclaredMadeForKids: currentStatus.selfDeclaredMadeForKids
    }),
    monetizationDetails: enabled
      ? {
          adsMonetizationStatus: 'ON',
          cuepointSchedule: {
            enabled: true,
            ytOptimizedCuepointConfig: 'MEDIUM'
          }
        }
      : {
          adsMonetizationStatus: 'OFF'
        }
  };

  await youtube.liveBroadcasts.update({
    part: 'id,snippet,contentDetails,status,monetizationDetails',
    requestBody
  });
}

async function createYouTubeBroadcast(streamId, baseUrl) {
  return ytThrottle(async () => {
  const stream = await Stream.findById(streamId);
  if (!stream) {
    throw new Error('Stream not found');
  }

  if (!stream.is_youtube_api) {
    return { success: true, message: 'Not a YouTube API stream' };
  }

  if (stream.youtube_broadcast_id && stream.rtmp_url && stream.stream_key) {
    if (!loggedAlreadyHasBroadcast.has(streamId)) {
      console.log(`[YouTubeService] Stream ${streamId} already has YouTube broadcast & RTMP info, skipping creation`);
      loggedAlreadyHasBroadcast.add(streamId);
    }
    return { 
      success: true, 
      rtmpUrl: stream.rtmp_url, 
      streamKey: stream.stream_key,
      broadcastId: stream.youtube_broadcast_id,
      streamId: stream.youtube_stream_id
    };
  }

  const user = await User.findById(stream.user_id);
  if (!user || !user.youtube_client_id || !user.youtube_client_secret) {
    console.error(`[YouTubeService] [CRITICAL] User ${stream.user_id} has no YouTube credentials configured.`);
    throw new Error('YouTube API credentials not configured');
  }

  console.log(`[YouTubeService] [DEBUG] Binding check: Stream=${streamId}, User=${stream.user_id}, ChannelInternalID=${stream.youtube_channel_id}`);

  let selectedChannel = null;
  if (stream.youtube_channel_id) {
    selectedChannel = await YoutubeChannel.findById(stream.youtube_channel_id);
  }
  if (!selectedChannel) {
    selectedChannel = await YoutubeChannel.findDefault(stream.user_id);
  }
  if (!selectedChannel) {
    const userChannels = await YoutubeChannel.findAll(stream.user_id);
    if (userChannels.length > 0) {
      selectedChannel = userChannels[0];
    }
  }

  if (!selectedChannel) {
    console.error(`[YouTubeService] [ERROR] Channel not found for stream ${streamId}. Expected Internal ID: ${stream.youtube_channel_id}`);
    throw new Error('YouTube channel not connected or association broken. Please select a channel in stream settings.');
  }

  if (selectedChannel.user_id !== stream.user_id) {
    console.error(`[YouTubeService] [SECURITY] Data Leakage Attempt! Stream ${streamId} (User ${stream.user_id}) tried to use Channel ${selectedChannel.id} (User ${selectedChannel.user_id})`);
    throw new Error('Unauthorized channel access. Ownership mismatch.');
  }

  console.log(`[YouTubeService] [INFO] Using Channel: Name="${selectedChannel.channel_name}", YouTubeID="${selectedChannel.channel_id}" for Stream: "${stream.title}"`);

  const clientSecret = decrypt(user.youtube_client_secret);
  const accessToken = decrypt(selectedChannel.access_token);
  const refreshToken = decrypt(selectedChannel.refresh_token);

  if (!clientSecret || !accessToken) {
    throw new Error('Failed to decrypt YouTube credentials');
  }

  const redirectUri = `${baseUrl}/auth/youtube/callback`;
  const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
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

  // REUSE CHECK: If stream already has a broadcast ID, verify if it is valid and upcoming on YouTube API
  if (stream.youtube_broadcast_id) {
    try {
      const checkRes = await youtube.liveBroadcasts.list({
        part: 'snippet,status,contentDetails',
        id: stream.youtube_broadcast_id
      });
      
      const existingBroadcast = checkRes.data.items?.[0];
      if (existingBroadcast) {
        const lifeCycleStatus = existingBroadcast.status?.lifeCycleStatus;
        if (lifeCycleStatus === 'upcoming' || lifeCycleStatus === 'created' || lifeCycleStatus === 'ready') {
          console.log(`[YouTubeService] Found valid existing UPCOMING broadcast ${stream.youtube_broadcast_id} (status: ${lifeCycleStatus})`);
          
          let liveStreamId = stream.youtube_stream_id;
          let rtmpUrl = stream.rtmp_url;
          let streamKey = stream.stream_key;

          if (liveStreamId && (!rtmpUrl || !streamKey)) {
            try {
              const streamRes = await youtube.liveStreams.list({
                part: 'cdn',
                id: liveStreamId
              });
              const cdn = streamRes.data.items?.[0]?.cdn;
              if (cdn && cdn.ingestionInfo) {
                rtmpUrl = cdn.ingestionInfo.ingestionAddress;
                streamKey = cdn.ingestionInfo.streamName;
              }
            } catch (streamErr) {
              console.log(`[YouTubeService] Could not fetch existing liveStream details: ${streamErr.message}`);
            }
          }

          if (!liveStreamId || !rtmpUrl || !streamKey) {
            // Create live stream and bind to existing broadcast
            const streamResponse = await youtube.liveStreams.insert({
              part: 'snippet,cdn,contentDetails,status',
              requestBody: {
                snippet: { title: `${(stream.title || 'Live Stream').substring(0, 90)} - Stream` },
                cdn: { frameRate: '30fps', ingestionType: 'rtmp', resolution: '1080p' },
                contentDetails: { isReusable: false }
              }
            });
            const newLiveStream = streamResponse.data;
            liveStreamId = newLiveStream.id;
            rtmpUrl = newLiveStream.cdn.ingestionInfo.ingestionAddress;
            streamKey = newLiveStream.cdn.ingestionInfo.streamName;

            await youtube.liveBroadcasts.bind({
              part: 'id,contentDetails',
              id: stream.youtube_broadcast_id,
              streamId: liveStreamId
            });
          }

          await Stream.update(streamId, {
            youtube_stream_id: liveStreamId,
            rtmp_url: rtmpUrl,
            stream_key: streamKey
          });

          return {
            success: true,
            broadcastId: stream.youtube_broadcast_id,
            streamId: liveStreamId,
            rtmpUrl: rtmpUrl,
            streamKey: streamKey
          };
        }
      }
    } catch (checkErr) {
      console.log(`[YouTubeService] Error verifying existing broadcast ${stream.youtube_broadcast_id}: ${checkErr.message}. Will create new broadcast.`);
    }
  }

  const tagsArray = sanitizeYouTubeTags(stream.youtube_tags);
  const broadcastTitle = (stream.title || 'Live Stream').substring(0, 100);

  const broadcastSnippet = {
    title: broadcastTitle,
    description: stream.youtube_description || '',
    scheduledStartTime: new Date().toISOString()
  };

  console.log(`[YouTubeService] Creating new YouTube broadcast for stream ${streamId}`);

  let broadcastResponse;
  const broadcastData = {
    snippet: broadcastSnippet,
    contentDetails: {
      enableAutoStart: true,
      // 24/7 streamcopy: JANGAN autoStop. Dengan autoStop=true, YouTube
      // mengakhiri broadcast (jadi VOD) setiap ada jeda data sesaat
      // (jitter Jerman -> YouTube), padahal FFmpeg retry dan app masih live.
      enableAutoStop: false,
      monitorStream: {
        enableMonitorStream: false
      }
    },
    status: {
      privacyStatus: stream.youtube_privacy || 'unlisted',
      selfDeclaredMadeForKids: stream.youtube_made_for_kids === 1 || stream.youtube_made_for_kids === true
    }
  };

  broadcastResponse = await youtube.liveBroadcasts.insert({
    part: 'snippet,contentDetails,status',
    requestBody: broadcastData
  });

  const broadcast = broadcastResponse.data;
  console.log(`[YouTubeService] Created broadcast: ${broadcast.id}`);

  if (stream.youtube_monetization) {
    try {
      await syncBroadcastMonetization(youtube, broadcast.id, true);
      console.log(`[YouTubeService] Enabled monetization for broadcast ${broadcast.id}`);
    } catch (monetizationError) {
      console.warn(`[YouTubeService] Failed to enable monetization for broadcast ${broadcast.id}. Continuing without monetization. Error: ${monetizationError.message}`);
      await Stream.update(streamId, { youtube_monetization: false });
    }
  }

  if (tagsArray.length > 0 || stream.youtube_category || stream.youtube_altered_content || stream.youtube_made_for_kids) {
    try {
      const videoResponse = await youtube.videos.list({
        part: 'snippet',
        id: broadcast.id
      });

      if (videoResponse.data.items && videoResponse.data.items.length > 0) {
        const currentSnippet = videoResponse.data.items[0].snippet;
        await youtube.videos.update({
          part: 'snippet,status,contentDetails',
          requestBody: {
            id: broadcast.id,
            snippet: {
              title: broadcastTitle,
              description: stream.youtube_description || '',
              categoryId: stream.youtube_category || '22',
              tags: tagsArray.length > 0 ? tagsArray : currentSnippet.tags,
              defaultLanguage: currentSnippet.defaultLanguage,
              defaultAudioLanguage: currentSnippet.defaultAudioLanguage
            },
            status: {
              selfDeclaredMadeForKids: stream.youtube_made_for_kids === 1 || stream.youtube_made_for_kids === true
            },
            contentDetails: {
              hasAlteredContent: stream.youtube_altered_content === 1 || stream.youtube_altered_content === true
            }
          }
        });
      }
    } catch (updateError) {
      console.log('[YouTubeService] Note: Could not update video metadata:', updateError.message);
    }
  }

  // --- Otomatis Ambil Thumbnail dari Galeri ---
  let thumbnailPathStr = stream.youtube_thumbnail;
  
  if (!thumbnailPathStr && stream.video_id) {
    try {
      const video = await Video.findById(stream.video_id);
      if (video && video.thumbnail_path) {
        thumbnailPathStr = video.thumbnail_path;
      }
    } catch (e) {
      console.log('[YouTubeService] Note: Could not fetch video thumbnail fallback:', e.message);
    }
  }
  
  if (thumbnailPathStr) {
    try {
      const projectRoot = path.resolve(__dirname, '..');
      const thumbnailPath = path.join(projectRoot, 'public', thumbnailPathStr);
      if (fs.existsSync(thumbnailPath)) {
        const thumbnailStream = fs.createReadStream(thumbnailPath);
        await youtube.thumbnails.set({
          videoId: broadcast.id,
          media: {
            mimeType: 'image/jpeg',
            body: thumbnailStream
          }
        });
        console.log(`[YouTubeService] Uploaded thumbnail for broadcast ${broadcast.id} using path: ${thumbnailPathStr}`);
      }
    } catch (thumbError) {
      console.log('[YouTubeService] Note: Could not upload thumbnail:', thumbError.message);
    }
  }

  const streamResponse = await youtube.liveStreams.insert({
    part: 'snippet,cdn,contentDetails,status',
    requestBody: {
      snippet: {
        title: `${(stream.title || 'Live Stream').substring(0, 90)} - Stream`
      },
      cdn: {
        frameRate: '30fps',
        ingestionType: 'rtmp',
        resolution: '1080p'
      },
      contentDetails: {
        isReusable: false
      }
    }
  });

  const liveStream = streamResponse.data;
  console.log(`[YouTubeService] Created live stream: ${liveStream.id}`);

  await youtube.liveBroadcasts.bind({
    part: 'id,contentDetails',
    id: broadcast.id,
    streamId: liveStream.id
  });

  const rtmpUrl = liveStream.cdn.ingestionInfo.ingestionAddress;
  const streamKey = liveStream.cdn.ingestionInfo.streamName;

  await Stream.update(streamId, {
    youtube_broadcast_id: broadcast.id,
    youtube_stream_id: liveStream.id,
    rtmp_url: rtmpUrl,
    stream_key: streamKey
  });

  console.log(`[YouTubeService] YouTube broadcast created successfully for stream ${streamId}`);

  return {
    success: true,
    broadcastId: broadcast.id,
    streamId: liveStream.id,
    rtmpUrl: rtmpUrl,
    streamKey: streamKey
  };
  }); // end ytThrottle
}

async function deleteYouTubeBroadcast(streamId) {
  try {
    loggedAlreadyHasBroadcast.delete(streamId);
    
    const stream = await Stream.findById(streamId);
    if (!stream || !stream.is_youtube_api || !stream.youtube_broadcast_id) {
      return { success: true, message: 'No YouTube broadcast to clean up' };
    }

    await Stream.update(streamId, {
      rtmp_url: '',
      stream_key: ''
    });

    console.log(`[YouTubeService] Cleared RTMP credentials for stream ${streamId} (broadcast ID kept for YouTube Studio access)`);

    return { success: true };
  } catch (error) {
    console.error('[YouTubeService] Error clearing YouTube broadcast data:', error);
    return { success: false, error: error.message };
  }
}

async function deleteYouTubeBroadcastIfUpcoming(streamId) {
  try {
    loggedAlreadyHasBroadcast.delete(streamId);

    const stream = await Stream.findById(streamId);
    if (!stream || !stream.is_youtube_api || !stream.youtube_broadcast_id) {
      return { success: true, message: 'No YouTube broadcast to clean up' };
    }

    const user = await User.findById(stream.user_id);
    if (!user || !user.youtube_client_id || !user.youtube_client_secret) {
      return { success: false, error: 'User credentials missing' };
    }

    let selectedChannel = stream.youtube_channel_id ? await YoutubeChannel.findById(stream.youtube_channel_id) : null;
    if (!selectedChannel) selectedChannel = await YoutubeChannel.findDefault(stream.user_id);
    if (!selectedChannel || selectedChannel.user_id !== stream.user_id) return { success: false };

    const clientSecret = decrypt(user.youtube_client_secret);
    const accessToken = decrypt(selectedChannel.access_token);
    const refreshToken = decrypt(selectedChannel.refresh_token);
    if (!clientSecret || !accessToken) return { success: false };

    const port = process.env.PORT || 7575;
    const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, `http://localhost:${port}/auth/youtube/callback`);
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // CRITICAL SAFETY CHECK: Fetch status from YouTube API before any delete operation
    const listRes = await youtube.liveBroadcasts.list({
      part: 'status',
      id: stream.youtube_broadcast_id
    });

    const broadcastItem = listRes.data.items?.[0];
    if (broadcastItem) {
      const lifeCycleStatus = broadcastItem.status?.lifeCycleStatus;
      // STRICT SAFETY: ONLY delete if it is UPCOMING or CREATED or READY. NEVER delete complete or live VODs!
      if (lifeCycleStatus === 'upcoming' || lifeCycleStatus === 'created' || lifeCycleStatus === 'ready') {
        await youtube.liveBroadcasts.delete({ id: stream.youtube_broadcast_id });
        console.log(`[YouTubeService] Safely deleted UPCOMING broadcast ${stream.youtube_broadcast_id} from YouTube Studio`);
      } else {
        console.log(`[YouTubeService] Preserving broadcast ${stream.youtube_broadcast_id} on YouTube Studio (status: '${lifeCycleStatus}', NOT upcoming)`);
      }
    }

    await Stream.update(streamId, {
      rtmp_url: '',
      stream_key: ''
    });

    return { success: true };
  } catch (error) {
    console.error(`[YouTubeService] Error in deleteYouTubeBroadcastIfUpcoming for stream ${streamId}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function completeYouTubeBroadcast(streamId) {
  try {
    loggedAlreadyHasBroadcast.delete(streamId);

    const stream = await Stream.findById(streamId);
    if (!stream || !stream.is_youtube_api || !stream.youtube_broadcast_id) {
      return { success: true, message: 'No YouTube broadcast to complete' };
    }

    const user = await User.findById(stream.user_id);
    if (!user || !user.youtube_client_id || !user.youtube_client_secret) {
      return { success: false, error: 'User credentials missing' };
    }

    let selectedChannel = stream.youtube_channel_id ? await YoutubeChannel.findById(stream.youtube_channel_id) : null;
    if (!selectedChannel) selectedChannel = await YoutubeChannel.findDefault(stream.user_id);
    if (!selectedChannel || selectedChannel.user_id !== stream.user_id) {
      return { success: false, error: 'YouTube channel not found or unauthorized' };
    }

    const clientSecret = decrypt(user.youtube_client_secret);
    const accessToken = decrypt(selectedChannel.access_token);
    const refreshToken = decrypt(selectedChannel.refresh_token);
    if (!clientSecret || !accessToken) return { success: false, error: 'Tokens missing' };

    const port = process.env.PORT || 7575;
    const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, `http://localhost:${port}/auth/youtube/callback`);
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await YoutubeChannel.update(selectedChannel.id, { access_token: encrypt(tokens.access_token) });
      }
      if (tokens.refresh_token) {
        await YoutubeChannel.update(selectedChannel.id, { refresh_token: encrypt(tokens.refresh_token) });
      }
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    try {
      const listRes = await youtube.liveBroadcasts.list({
        part: 'status',
        id: stream.youtube_broadcast_id
      });
      const broadcastItem = listRes.data.items?.[0];
      const lifeCycleStatus = broadcastItem?.status?.lifeCycleStatus;

      if (lifeCycleStatus === 'live' || lifeCycleStatus === 'testing') {
        await youtube.liveBroadcasts.transition({
          broadcastStatus: 'complete',
          id: stream.youtube_broadcast_id,
          part: 'id,status'
        });
        console.log(`[YouTubeService] Successfully transitioned broadcast ${stream.youtube_broadcast_id} to complete`);
      } else {
        console.log(`[YouTubeService] Broadcast ${stream.youtube_broadcast_id} status is '${lifeCycleStatus}', no transition needed`);
      }
    } catch (transitionErr) {
      console.warn(`[YouTubeService] Transition broadcast error for ${stream.youtube_broadcast_id}:`, transitionErr.message);
    }

    await Stream.update(streamId, {
      rtmp_url: '',
      stream_key: ''
    });

    return { success: true };
  } catch (error) {
    console.error(`[YouTubeService] Error in completeYouTubeBroadcast for stream ${streamId}:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  createYouTubeBroadcast,
  deleteYouTubeBroadcast,
  deleteYouTubeBroadcastIfUpcoming,
  completeYouTubeBroadcast,
  getYouTubeOAuth2Client,
  syncBroadcastMonetization,
  sanitizeYouTubeTags
};

