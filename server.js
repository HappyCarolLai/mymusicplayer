const express = require('express');
const multer = require('multer');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage"); // 新增：支援串流上傳
const cors = require('cors');
const mongoose = require('mongoose');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { Readable, PassThrough } = require('stream');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- MongoDB ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const Playlist = mongoose.model('Playlist', new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  songs: [{ id: String, name: String, url: String, fileName: String }]
}));

// --- R2 ---
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

// --- API ---

// 獲取所有清單
app.get('/api/playlists', async (req, res) => {
  try {
    const data = await Playlist.find();
    const result = { playlists: {} };
    data.forEach(p => result.playlists[p.name] = p.songs);
    if (!result.playlists['default']) result.playlists['default'] = [];
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 修改後的 server.js 上傳部分
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    const { playlistName } = req.body;

    // 【新增內容】：修正中文亂碼問題，將編碼從 latin1 轉回 utf8
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    
    // 【修正內容】：清理檔名，確保 URL 安全但保留正確的中文字元
    // 我們先過濾掉一些可能導致 URL 報錯的特殊符號，但保留中文字
    const cleanName = originalName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    const safeFileName = `${Date.now()}-${cleanName}`; 

    console.log(`開始處理串流: ${originalName}`);

    // --- 以下保持不變 ---
    const passThrough = new PassThrough();
    const ffmpegCommand = ffmpeg(Readable.from(req.file.buffer))
      .audioFilters('volume=0.5')
      .format('mp3')
      .on('error', (err) => {
        console.error('FFmpeg 錯誤:', err.message);
        passThrough.destroy();
      });

    ffmpegCommand.pipe(passThrough);

    const parallelUploads3 = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: safeFileName,
        Body: passThrough,
        ContentType: 'audio/mpeg',
      },
    });

    await parallelUploads3.done();

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${encodeURIComponent(safeFileName)}`;
    
    const newSong = { 
        id: Date.now().toString(), 
        name: originalName, 
        url: publicUrl, 
        fileName: safeFileName 
    };

    await Playlist.findOneAndUpdate(
      { name: playlistName || 'default' },
      { $push: { songs: newSong } },
      { upsert: true, new: true }
    );

    res.json({ success: true, song: newSong });
  } catch (err) {
    console.error('上傳失敗:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// 其他管理 API
app.put('/api/music/rename', async (req, res) => {
  const { songId, newName, playlistName } = req.body;
  await Playlist.updateOne({ name: playlistName, "songs.id": songId }, { $set: { "songs.$.name": newName } });
  res.json({ success: true });
});

app.delete('/api/music', async (req, res) => {
  const { fileName, playlistName, songId } = req.body;
  await Playlist.findOneAndUpdate({ name: playlistName }, { $pull: { songs: { id: songId } } });
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: fileName }));
  res.json({ success: true });
});

app.post('/api/playlist', async (req, res) => {
  try {
    await Playlist.create({ name: req.body.name, songs: [] });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: '名稱重複' }); }
});

app.delete('/api/playlist', async (req, res) => {
  const target = await Playlist.findOne({ name: req.body.name });
  if (target) {
    for (const song of target.songs) {
      await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: song.fileName }));
    }
    await Playlist.deleteOne({ name: req.body.name });
  }
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));