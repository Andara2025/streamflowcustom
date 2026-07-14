const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { getVideoDurationInSeconds } = require('get-video-duration');
const fs = require('fs');
const path = require('path');
const { getUniqueFilename, paths } = require('./storage');
ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfprobePath(ffprobePath);

const getVideoInfo = (filepath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filepath, (err, metadata) => {
      if (err) {
        console.error('Error getting video info:', err);
        return reject(err);
      }
      
      let duration = 0;
      let width = 0;
      let height = 0;
      let fps = 0;
      let bitrate = 0;
      
      if (metadata.format && metadata.format.duration) {
        duration = parseFloat(metadata.format.duration);
      }
      if (metadata.format && metadata.format.bit_rate) {
        bitrate = parseInt(metadata.format.bit_rate);
      }
      
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (videoStream) {
        width = videoStream.width || 0;
        height = videoStream.height || 0;
        
        if (videoStream.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split('/');
          if (num && den && parseInt(den) !== 0) {
            fps = Math.round(parseInt(num) / parseInt(den));
          }
        }
      }
      
      const stats = fs.statSync(filepath);
      
      resolve({
        duration,
        fileSize: stats.size,
        width,
        height,
        fps,
        bitrate
      });
    });
  });
};
const generateThumbnail = (videoPath, thumbnailName) => {
  return new Promise((resolve, reject) => {
    const thumbnailPath = path.join(paths.thumbnails, thumbnailName);
    ffmpeg(videoPath)
      .screenshots({
        count: 1,
        folder: paths.thumbnails,
        filename: thumbnailName,
        size: '320x180'
      })
      .on('end', () => {
        resolve(thumbnailPath);
      })
      .on('error', (err) => {
        console.error('Error generating thumbnail:', err);
        reject(err);
      });
  });
};

const generateImageThumbnail = (imagePath, thumbnailName) => {
  return new Promise((resolve, reject) => {
    const thumbnailPath = path.join(paths.thumbnails, thumbnailName);
    ffmpeg(imagePath)
      .outputOptions([
        '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2'
      ])
      .output(thumbnailPath)
      .on('end', () => {
        resolve(thumbnailPath);
      })
      .on('error', (err) => {
        console.error('Error generating image thumbnail:', err);
        reject(err);
      })
      .run();
  });
};

module.exports = {
  getVideoInfo,
  generateThumbnail,
  generateImageThumbnail
};