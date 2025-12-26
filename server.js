const express = require('express');
const multer = require('multer');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage");
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static('public', {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// --- MongoDB ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// 歌曲主資料庫（儲存實際檔案資訊）
const Song = mongoose.model('Song', new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  url: { type: String, required: true },
  fileName: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
}));

// 播放清單（只儲存歌曲 ID 引用）
const Playlist = mongoose.model('Playlist', new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  songIds: [String],
  createdAt: { type: Date, default: Date.now }
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

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// --- 初始化函數 ---
async function ensureAllSongsPlaylist() {
  const existing = await Playlist.findOne({ name: '所有歌曲' });
  if (!existing) {
    await Playlist.create({ name: '所有歌曲', songIds: [] });
  }
}

// --- API ---

// 獲取所有清單
app.get('/api/playlists', async (req, res) => {
  try {
    await ensureAllSongsPlaylist();
    
    const playlists = await Playlist.find().sort({ createdAt: 1 });
    const allSongs = await Song.find();
    
    const result = { playlists: {} };
    
    for (const playlist of playlists) {
      const songs = playlist.songIds
        .map(id => allSongs.find(s => s.id === id))
        .filter(s => s)
        .map(s => ({
          id: s.id,
          name: s.name,
          url: s.url,
          fileName: s.fileName
        }));
      
      result.playlists[playlist.name] = songs;
    }
    
    res.json(result);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// 上傳音樂（自動加入「所有歌曲」）
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const cleanName = originalName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    const safeFileName = `${Date.now()}-${cleanName}`; 

    console.log(`開始上傳: ${originalName}`);

    const parallelUploads3 = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: safeFileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      },
    });

    await parallelUploads3.done();

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${encodeURIComponent(safeFileName)}`;
    const songId = Date.now().toString();
    
    // 儲存到主歌曲資料庫
    const newSong = await Song.create({ 
      id: songId,
      name: originalName, 
      url: publicUrl, 
      fileName: safeFileName 
    });

    // 加入「所有歌曲」清單
    await Playlist.findOneAndUpdate(
      { name: '所有歌曲' },
      { $push: { songIds: songId } },
      { upsert: true }
    );

    res.json({ 
      success: true, 
      song: {
        id: newSong.id,
        name: newSong.name,
        url: newSong.url,
        fileName: newSong.fileName
      }
    });
  } catch (err) {
    console.error('上傳失敗:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// 重命名歌曲
app.put('/api/music/rename', async (req, res) => {
  try {
    const { songId, newName } = req.body;
    await Song.updateOne({ id: songId }, { $set: { name: newName } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 從「所有歌曲」刪除（真正刪除）
app.delete('/api/music', async (req, res) => {
  try {
    const { songId, playlistName } = req.body;
    
    if (playlistName === '所有歌曲') {
      // 從所有歌曲刪除 = 徹底刪除
      const song = await Song.findOne({ id: songId });
      if (!song) {
        return res.status(404).json({ error: '歌曲不存在' });
      }

      // 從 R2 刪除檔案
      await s3Client.send(new DeleteObjectCommand({ 
        Bucket: BUCKET_NAME, 
        Key: song.fileName 
      }));

      // 從所有播放清單移除
      await Playlist.updateMany(
        { songIds: songId },
        { $pull: { songIds: songId } }
      );

      // 從主資料庫刪除
      await Song.deleteOne({ id: songId });

      console.log(`實體檔案 ${song.fileName} 已從雲端及所有清單徹底刪除`);
    } else {
      // 從其他清單移除（不刪除檔案）
      await Playlist.findOneAndUpdate(
        { name: playlistName },
        { $pull: { songIds: songId } }
      );
      
      console.log(`僅將歌曲從清單「${playlistName}」移除，保留 R2 檔案`);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 批量添加歌曲到播放清單
app.post('/api/playlist/add-songs', async (req, res) => {
  try {
    const { playlistName, songIds } = req.body;
    
    await Playlist.findOneAndUpdate(
      { name: playlistName },
      { $addToSet: { songIds: { $each: songIds } } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增播放清單
app.post('/api/playlist', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (name === '所有歌曲') {
      return res.status(400).json({ error: '此名稱為保留名稱' });
    }

    await Playlist.create({ name, songIds: [] });
    res.json({ success: true });
  } catch (err) { 
    res.status(400).json({ error: '名稱重複或無效' }); 
  }
});

// 重命名播放清單
app.put('/api/playlist/rename', async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    
    if (oldName === '所有歌曲') {
      return res.status(400).json({ error: '無法重命名「所有歌曲」' });
    }

    if (newName === '所有歌曲') {
      return res.status(400).json({ error: '此名稱為保留名稱' });
    }

    const existing = await Playlist.findOne({ name: newName });
    if (existing) {
      return res.status(400).json({ error: '名稱已存在' });
    }

    await Playlist.updateOne({ name: oldName }, { $set: { name: newName } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 刪除播放清單（不刪除歌曲檔案）
app.delete('/api/playlist', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (name === '所有歌曲') {
      return res.status(400).json({ error: '無法刪除「所有歌曲」' });
    }

    await Playlist.deleteOne({ name });
    console.log(`播放清單「${name}」已移除，保留原始音樂檔案`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));