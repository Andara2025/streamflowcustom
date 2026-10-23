const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getVideoDurationInSeconds } = require('get-video-duration');
const { getUniqueFilename, paths } = require('./storage');

let ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
try {
  ffmpegPath = execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg', { stdio: 'pipe' }).toString().split('\n')[0].trim() || ffmpegPath;
} catch(e) {}
ffmpeg.setFfmpegPath(ffmpegPath);

let ffprobePath = require('@ffprobe-installer/ffprobe').path;
try {
  ffprobePath = execSync(process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe', { stdio: 'pipe' }).toString().split('\n')[0].trim() || ffprobePath;
} catch(e) {}
ffmpeg.setFfprobePath(ffprobePath);

const getVideoInfo = (filepath) => {
  return new Promise((resolve) => {
    let settled = false;
    const fallbackStats = () => {
      let size = 0;
      try {
        size = fs.statSync(filepath).size;
      } catch (e) {}
      return {
        duration: 0,
        fileSize: size,
        width: 0,
        height: 0,
        fps: 0,
        bitrate: 0
      };
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn(`[videoProcessor] getVideoInfo timed out for: ${filepath}`);
        resolve(fallbackStats());
      }
    }, 15000);

    ffmpeg.ffprobe(filepath, (err, metadata) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (err) {
        console.error('[videoProcessor] Error getting video info:', err.message);
        return resolve(fallbackStats());
      }
      
      let duration = 0;
      let width = 0;
      let height = 0;
      let fps = 0;
      let bitrate = 0;
      
      if (metadata.format && metadata.format.duration) {
        duration = parseFloat(metadata.format.duration) || 0;
      }
      if (metadata.format && metadata.format.bit_rate) {
        bitrate = parseInt(metadata.format.bit_rate) || 0;
      }
      
      const videoStream = (metadata.streams || []).find(s => s.codec_type === 'video');
      if (videoStream) {
        width = videoStream.width || 0;
        height = videoStream.height || 0;
        
        if (videoStream.avg_frame_rate || videoStream.r_frame_rate) {
          const rateStr = videoStream.avg_frame_rate || videoStream.r_frame_rate;
          const [num, den] = (rateStr || '').split('/');
          if (num && den && parseInt(den) !== 0) {
            fps = Math.round(parseInt(num) / parseInt(den));
          }
        }
      }
      
      let size = 0;
      try {
        size = fs.statSync(filepath).size;
      } catch (e) {}
      
      resolve({
        duration,
        fileSize: size,
        width,
        height,
        fps,
        bitrate,
        rawMetadata: metadata
      });
    });
  });
};

const generateThumbnail = (videoPath, thumbnailName) => {
  return new Promise((resolve) => {
    let settled = false;
    const thumbnailPath = path.join(paths.thumbnails, thumbnailName);

    try {
      if (!fs.existsSync(paths.thumbnails)) {
        fs.mkdirSync(paths.thumbnails, { recursive: true });
      }
    } catch (e) {
      console.error('[videoProcessor] Failed to create thumbnail dir:', e.message);
      return resolve(null);
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn(`[videoProcessor] generateThumbnail timed out for: ${thumbnailName}`);
        resolve(null);
      }
    }, 15000);

    // Use timestamps: [1] to avoid internal ffprobe duration calculation
    ffmpeg(videoPath)
      .screenshots({
        count: 1,
        timestamps: [1],
        folder: paths.thumbnails,
        filename: thumbnailName,
        size: '320x180'
      })
      .on('end', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(thumbnailPath);
        }
      })
      .on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          console.warn(`[videoProcessor] generateThumbnail failed (non-fatal): ${err.message}`);
          resolve(null);
        }
      });
  });
};

const generateImageThumbnail = (imagePath, thumbnailName) => {
  return new Promise((resolve) => {
    let settled = false;
    const thumbnailPath = path.join(paths.thumbnails, thumbnailName);

    try {
      if (!fs.existsSync(paths.thumbnails)) {
        fs.mkdirSync(paths.thumbnails, { recursive: true });
      }
    } catch (e) {
      console.error('[videoProcessor] Failed to create thumbnail dir:', e.message);
      return resolve(null);
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn(`[videoProcessor] generateImageThumbnail timed out for: ${thumbnailName}`);
        resolve(null);
      }
    }, 15000);

    ffmpeg(imagePath)
      .outputOptions([
        '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2'
      ])
      .output(thumbnailPath)
      .on('end', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(thumbnailPath);
        }
      })
      .on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          console.warn(`[videoProcessor] generateImageThumbnail failed (non-fatal): ${err.message}`);
          resolve(null);
        }
      })
      .run();
  });
};

module.exports = {
  getVideoInfo,
  generateThumbnail,
  generateImageThumbnail
};