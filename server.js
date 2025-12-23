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

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- MongoDB 連線 ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const Playlist = mongoose.model('Playlist', new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  songs: [{ id: String, name: String, url: String, fileName: String }]
}));

// --- R2 客戶端 ---
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

// 1. 取得所有清單 (從資料庫)
app.get('/api/playlists', async (req, res) => {
  try {
    const data = await Playlist.find();
    const result = { playlists: {} };
    data.forEach(p => result.playlists[p.name] = p.songs);
    if (Object.keys(result.playlists).length === 0) {
      result.playlists['預設清單'] = []; // 確保至少有一個清單
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. 上傳 + 音量減半 (0.5)
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    const { playlistName } = req.body;
    const originalName = req.file.originalname;
    const safeFileName = `${Date.now()}-${encodeURIComponent(originalName)}`;

    const inputStream = Readable.from(req.file.buffer);
    const chunks = [];

    ffmpeg(inputStream)
      .audioFilters('volume=0.5') // 音量減半
      .format('mp3')
      .on('error', (err) => { throw err; })
      .pipe()
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', async () => {
        const processedBuffer = Buffer.concat(chunks);
        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET_NAME, Key: safeFileName, Body: processedBuffer, ContentType: 'audio/mpeg'
        }));

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${safeFileName}`;
        const newSong = { id: Date.now().toString(), name: originalName, url: publicUrl, fileName: safeFileName };

        await Playlist.findOneAndUpdate(
          { name: playlistName || '預設清單' },
          { $push: { songs: newSong } },
          { upsert: true, new: true }
        );
        res.json({ success: true, song: newSong });
      });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. 新增清單
app.post('/api/playlist', async (req, res) => {
  try {
    const { name } = req.body;
    await Playlist.create({ name, songs: [] });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: '清單名稱重複或無效' }); }
});

// 4. 刪除歌曲
app.delete('/api/music', async (req, res) => {
  const { fileName, playlistName, songId } = req.body;
  try {
    await Playlist.findOneAndUpdate({ name: playlistName }, { $pull: { songs: { id: songId } } });
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: fileName }));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));