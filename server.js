const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中介軟體
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Multer 記憶體儲存
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// R2 客戶端設定
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PLAYLIST_FILE = path.join(__dirname, 'playlist.json');
const VOLUME_REDUCTION = 0.7; // 音量降低到 70%（降低 30%）

// 讀取播放清單
async function readPlaylist() {
  try {
    const data = await fs.readFile(PLAYLIST_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { playlists: { default: [] } };
  }
}

// 寫入播放清單
async function writePlaylist(data) {
  await fs.writeFile(PLAYLIST_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 生成安全的檔名（支援中文）
function generateSafeFileName(originalName) {
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${randomStr}${ext}`;
}

// 簡單的音量降低處理（針對 WAV/PCM 格式）
function reduceVolume(buffer, reduction = VOLUME_REDUCTION) {
  // 對於 MP3/M4A 等壓縮格式，我們在前端用 Web Audio API 處理
  // 這裡直接返回原始 buffer，並在元數據中標記音量
  return buffer;
}

// API：獲取播放清單
app.get('/api/playlists', async (req, res) => {
  try {
    const playlist = await readPlaylist();
    res.json(playlist);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API：上傳音樂
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const playlistName = req.body.playlist || 'default';
    
    if (!file) {
      return res.status(400).json({ error: '沒有檔案' });
    }

    // 生成安全檔名
    const safeFileName = generateSafeFileName(file.originalname);
    
    // 上傳到 R2（原始音訊）
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: safeFileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(file.originalname)}`,
    });
    
    await s3Client.send(command);
    
    // 生成公開 URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${safeFileName}`;
    
    // 更新播放清單，保留原始檔名（含中文）
    const playlist = await readPlaylist();
    if (!playlist.playlists[playlistName]) {
      playlist.playlists[playlistName] = [];
    }
    
    const originalNameWithoutExt = path.basename(file.originalname, path.extname(file.originalname));
    
    playlist.playlists[playlistName].push({
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      name: originalNameWithoutExt,
      url: publicUrl,
      fileName: safeFileName,
      volumeReduction: VOLUME_REDUCTION, // 標記音量降低比例
    });
    
    await writePlaylist(playlist);
    
    res.json({ 
      success: true, 
      message: '上傳成功（播放時音量將降低 30%）', 
      fileName: safeFileName 
    });
  } catch (error) {
    console.error('上傳錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

// API：刪除音樂
app.delete('/api/delete', async (req, res) => {
  try {
    const { fileName, playlistName, songId } = req.body;
    
    const playlist = await readPlaylist();
    
    // 從指定播放清單中移除
    if (playlist.playlists[playlistName]) {
      playlist.playlists[playlistName] = playlist.playlists[playlistName].filter(
        song => song.id !== songId
      );
    }
    
    // 檢查其他播放清單是否還有此檔案
    let stillUsed = false;
    for (const list of Object.values(playlist.playlists)) {
      if (list.some(song => song.fileName === fileName)) {
        stillUsed = true;
        break;
      }
    }
    
    // 如果沒有其他清單使用，則從 R2 刪除
    if (!stillUsed) {
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
      });
      await s3Client.send(command);
    }
    
    await writePlaylist(playlist);
    
    res.json({ success: true, message: '刪除成功', deletedFromR2: !stillUsed });
  } catch (error) {
    console.error('刪除錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

// API：新增播放清單
app.post('/api/playlist', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: '播放清單名稱不可為空' });
    }
    
    const playlist = await readPlaylist();
    
    if (playlist.playlists[name]) {
      return res.status(400).json({ error: '播放清單已存在' });
    }
    
    playlist.playlists[name] = [];
    await writePlaylist(playlist);
    
    res.json({ success: true, message: '播放清單建立成功', name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API：刪除播放清單
app.delete('/api/playlist', async (req, res) => {
  try {
    const { name } = req.body;
    const playlist = await readPlaylist();
    
    if (name === 'default') {
      return res.status(400).json({ error: '不能刪除預設播放清單' });
    }
    
    delete playlist.playlists[name];
    await writePlaylist(playlist);
    
    res.json({ success: true, message: '播放清單刪除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`伺服器運行於 port ${PORT}`);
});