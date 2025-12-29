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
  .then(async () => {
    console.log('✅ MongoDB Connected');
    await migrateOldData();
    await ensureAllSongsPlaylist();
  })
  .catch(err => console.error('❌ MongoDB Error:', err));

// 歌曲主資料庫
const Song = mongoose.model('Song', new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  url: { type: String, required: true },
  fileName: { type: String, required: true },
  coverUrl: { type: String },
  uploadedAt: { type: Date, default: Date.now }
}));

// 播放清單
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
  try {
    const existing = await Playlist.findOne({ name: '已上傳歌曲清單' });
    if (!existing) {
      await Playlist.create({ name: '已上傳歌曲清單', songIds: [] });
      console.log('✅ 已創建「已上傳歌曲清單」');
    }
  } catch (err) {
    console.error('❌ 創建默認清單失敗:', err);
  }
}

// 遷移舊資料架構到新架構
async function migrateOldData() {
  try {
    const oldPlaylists = await Playlist.find({ songs: { $exists: true, $ne: [] } });
    
    if (oldPlaylists.length === 0) {
      console.log('✅ 沒有需要遷移的舊資料');
      return;
    }

    console.log(`🔄 發現 ${oldPlaylists.length} 個播放清單需要遷移...`);

    for (const playlist of oldPlaylists) {
      if (playlist.songIds && playlist.songIds.length > 0) {
        continue;
      }

      console.log(`   處理播放清單: ${playlist.name}`);
      const songIds = [];

      for (const oldSong of playlist.songs) {
        let song = await Song.findOne({ fileName: oldSong.fileName });
        
        if (!song) {
          song = await Song.create({
            id: oldSong.id || Date.now().toString(),
            name: oldSong.name,
            url: oldSong.url,
            fileName: oldSong.fileName,
            coverUrl: oldSong.coverUrl || null
          });
          console.log(`      新增歌曲: ${song.name}`);
        }

        songIds.push(song.id);
      }

      await Playlist.updateOne(
        { _id: playlist._id },
        { 
          $set: { songIds: songIds },
          $unset: { songs: "" }
        }
      );

      console.log(`   ✅ ${playlist.name} 遷移完成 (${songIds.length} 首歌)`);
    }

    const oldAllSongs = await Playlist.findOne({ name: '所有歌曲' });
    if (oldAllSongs) {
      await Playlist.updateOne(
        { name: '所有歌曲' },
        { $set: { name: '已上傳歌曲清單' } }
      );
      console.log('✅ 已將「所有歌曲」重命名為「已上傳歌曲清單」');
    }

    console.log('🎉 資料遷移完成!');
  } catch (err) {
    console.error('❌ 資料遷移失敗:', err);
  }
}

// 從音訊檔案提取封面的函數
async function extractAlbumCover(buffer) {
  try {
    const musicMetadata = await import('music-metadata');
    const metadata = await musicMetadata.parseBuffer(buffer, { skipCovers: false });
    
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      return {
        data: picture.data,
        format: picture.format
      };
    }
    return null;
  } catch (err) {
    console.log('無法提取封面:', err.message);
    return null;
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
          fileName: s.fileName,
          coverUrl: s.coverUrl || null
        }));
      
      result.playlists[playlist.name] = songs;
    }
    
    res.json(result);
  } catch (err) { 
    console.error('獲取播放清單失敗:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// 上傳音樂
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '沒有上傳檔案' });
    }

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const cleanName = originalName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    const safeFileName = `${Date.now()}-${cleanName}`; 

    console.log(`開始上傳: ${originalName}`);

    // 嘗試提取封面
    let coverUrl = null;
    try {
      const cover = await extractAlbumCover(req.file.buffer);
      
      if (cover) {
        const coverFileName = `cover-${Date.now()}.${cover.format === 'image/jpeg' ? 'jpg' : 'png'}`;
        console.log(`上傳封面: ${coverFileName}`);
        
        const coverUpload = new Upload({
          client: s3Client,
          params: {
            Bucket: BUCKET_NAME,
            Key: coverFileName,
            Body: cover.data,
            ContentType: cover.format,
          },
        });

        await coverUpload.done();
        coverUrl = `${process.env.R2_PUBLIC_URL}/${encodeURIComponent(coverFileName)}`;
        console.log(`封面上傳成功: ${coverUrl}`);
      }
    } catch (coverErr) {
      console.log('封面處理失敗(繼續上傳音訊):', coverErr.message);
    }

    // 上傳音訊檔案
    const audioUpload = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: safeFileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      },
    });

    await audioUpload.done();

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${encodeURIComponent(safeFileName)}`;
    const songId = Date.now().toString();
    
    // 儲存到主歌曲資料庫
    const newSong = await Song.create({ 
      id: songId,
      name: originalName, 
      url: publicUrl, 
      fileName: safeFileName,
      coverUrl: coverUrl
    });

    // 加入「已上傳歌曲清單」清單
    await Playlist.findOneAndUpdate(
      { name: '已上傳歌曲清單' },
      { $push: { songIds: songId } },
      { upsert: true }
    );

    console.log(`✅ 上傳成功: ${originalName}`);

    res.json({ 
      success: true, 
      song: {
        id: newSong.id,
        name: newSong.name,
        url: newSong.url,
        fileName: newSong.fileName,
        coverUrl: newSong.coverUrl
      }
    });
  } catch (err) {
    console.error('上傳失敗:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
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

// 從「已上傳歌曲清單」刪除(真正刪除)
app.delete('/api/music', async (req, res) => {
  try {
    const { songId, playlistName } = req.body;
    
    if (playlistName === '已上傳歌曲清單') {
      const song = await Song.findOne({ id: songId });
      if (!song) {
        return res.status(404).json({ error: '歌曲不存在' });
      }

      // 從 R2 刪除音訊檔案
      try {
        await s3Client.send(new DeleteObjectCommand({ 
          Bucket: BUCKET_NAME, 
          Key: song.fileName 
        }));
        console.log(`已刪除音訊檔案: ${song.fileName}`);
      } catch (err) {
        console.error('刪除音訊檔案失敗:', err);
      }

      // 如果有封面,也刪除封面
      if (song.coverUrl) {
        try {
          const coverFileName = song.coverUrl.split('/').pop();
          await s3Client.send(new DeleteObjectCommand({ 
            Bucket: BUCKET_NAME, 
            Key: decodeURIComponent(coverFileName)
          }));
          console.log(`已刪除封面: ${coverFileName}`);
        } catch (err) {
          console.error('刪除封面失敗:', err);
        }
      }

      // 從所有播放清單移除
      await Playlist.updateMany(
        { songIds: songId },
        { $pull: { songIds: songId } }
      );

      // 從主資料庫刪除
      await Song.deleteOne({ id: songId });

      console.log(`✅ 歌曲 ${song.name} 已徹底刪除`);
    } else {
      // 從其他清單移除(不刪除檔案)
      await Playlist.findOneAndUpdate(
        { name: playlistName },
        { $pull: { songIds: songId } }
      );
      
      console.log(`✅ 僅將歌曲從清單「${playlistName}」移除`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('刪除失敗:', err);
    res.status(500).json({ error: err.message });
  }
});

// 批量添加歌曲到播放清單
app.post('/api/playlist/add-songs', async (req, res) => {
  try {
    const { playlistName, songIds } = req.body;
    
    if (!playlistName || !songIds || !Array.isArray(songIds)) {
      return res.status(400).json({ error: '參數錯誤' });
    }
    
    await Playlist.findOneAndUpdate(
      { name: playlistName },
      { $addToSet: { songIds: { $each: songIds } } },
      { upsert: true }
    );

    console.log(`✅ 已添加 ${songIds.length} 首歌曲到「${playlistName}」`);
    res.json({ success: true });
  } catch (err) {
    console.error('添加歌曲失敗:', err);
    res.status(500).json({ error: err.message });
  }
});

// 新增播放清單
app.post('/api/playlist', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: '清單名稱不能為空' });
    }
    
    if (name === '已上傳歌曲清單') {
      return res.status(400).json({ error: '此名稱為保留名稱' });
    }

    await Playlist.create({ name: name.trim(), songIds: [] });
    console.log(`✅ 創建播放清單: ${name}`);
    res.json({ success: true });
  } catch (err) { 
    console.error('創建播放清單失敗:', err);
    if (err.code === 11000) {
      res.status(400).json({ error: '名稱重複' });
    } else {
      res.status(400).json({ error: '創建失敗' }); 
    }
  }
});

// 重命名播放清單
app.put('/api/playlist/rename', async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    
    if (!oldName || !newName) {
      return res.status(400).json({ error: '參數錯誤' });
    }
    
    if (oldName === '已上傳歌曲清單') {
      return res.status(400).json({ error: '無法重命名「已上傳歌曲清單」' });
    }

    if (newName === '已上傳歌曲清單') {
      return res.status(400).json({ error: '此名稱為保留名稱' });
    }

    const existing = await Playlist.findOne({ name: newName });
    if (existing) {
      return res.status(400).json({ error: '名稱已存在' });
    }

    const result = await Playlist.updateOne({ name: oldName }, { $set: { name: newName } });
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: '播放清單不存在' });
    }

    console.log(`✅ 重命名播放清單: ${oldName} → ${newName}`);
    res.json({ success: true });
  } catch (err) {
    console.error('重命名播放清單失敗:', err);
    res.status(500).json({ error: err.message });
  }
});

// 刪除播放清單(不刪除歌曲檔案)
app.delete('/api/playlist', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: '參數錯誤' });
    }
    
    if (name === '已上傳歌曲清單') {
      return res.status(400).json({ error: '無法刪除「已上傳歌曲清單」' });
    }

    const result = await Playlist.deleteOne({ name });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: '播放清單不存在' });
    }

    console.log(`✅ 刪除播放清單: ${name}`);
    res.json({ success: true });
  } catch (err) {
    console.error('刪除播放清單失敗:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));