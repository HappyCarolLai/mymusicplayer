const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const cors = require('cors');
const mongoose = require('mongoose');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { Readable } = require('stream');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 3000;

// --- 中介軟體 ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- MongoDB 設定 ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

const PlaylistSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  songs: [{
    id: String,
    name: String,
    url: String,
    fileName: String
  }]
});
const Playlist = mongoose.model('Playlist', PlaylistSchema);

// --- R2 客戶端設定 ---
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

const upload = multer({ storage: multer.memoryStorage() });

// --- API 路由 ---

// 1. 獲取所有清單
app.get('/api/playlists', async (req, res) => {
  try {
    const data = await Playlist.find();
    const result = { playlists: {} };
    data.forEach(p => result.playlists[p.name] = p.songs);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. 上傳音樂 + 減小音量 50%
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    const { playlistName } = req.body;
    const originalName = req.file.originalname;
    const safeFileName = `${Date.now()}-${encodeURIComponent(originalName)}`;

    // 使用 FFmpeg 處理音量
    const inputStream = Readable.from(req.file.buffer);
    const chunks = [];

    ffmpeg(inputStream)
      .audioFilters('volume=0.5') // 關鍵：音量減半
      .format('mp3')
      .on('error', (err) => { throw err; })
      .pipe()
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', async () => {
        const processedBuffer = Buffer.concat(chunks);
        
        // 上傳至 R2
        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: safeFileName,
          Body: processedBuffer,
          ContentType: 'audio/mpeg'
        }));

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${safeFileName}`;
        const newSong = { id: Date.now().toString(), name: originalName, url: publicUrl, fileName: safeFileName };

        await Playlist.findOneAndUpdate(
          { name: playlistName },
          { $push: { songs: newSong } },
          { upsert: true }
        );

        res.json({ success: true, song: newSong });
      });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. 重新命名清單
app.put('/api/playlist/rename', async (req, res) => {
  const { oldName, newName } = req.body;
  await Playlist.findOneAndUpdate({ name: oldName }, { name: newName });
  res.json({ success: true });
});

// 4. 刪除音樂
app.delete('/api/music', async (req, res) => {
    const { fileName, playlistName, songId } = req.body;
    try {
        // 從資料庫移除
        await Playlist.findOneAndUpdate(
            { name: playlistName },
            { $pull: { songs: { id: songId } } }
        );
        // 從 R2 移除
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: fileName }));
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. 刪除清單
app.delete('/api/playlist', async (req, res) => {
    const { name } = req.body;
    const target = await Playlist.findOne({ name });
    if (target) {
        // 批次刪除 R2 檔案
        for (const song of target.songs) {
            await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: song.fileName }));
        }
        await Playlist.deleteOne({ name });
    }
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));