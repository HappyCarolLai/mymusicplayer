const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
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
const upload = multer({ storage: multer.memoryStorage() });

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
  await fs.writeFile(PLAYLIST_FILE, JSON.stringify(data, null, 2));
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

    // 生成唯一檔名
    const timestamp = Date.now();
    const fileName = `${timestamp}_${Buffer.from(file.originalname).toString('base64').substring(0, 20)}.${file.originalname.split('.').pop()}`;
    
    // 上傳到 R2
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    });
    
    await s3Client.send(command);
    
    // 生成公開 URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;
    
    // 更新播放清單
    const playlist = await readPlaylist();
    if (!playlist.playlists[playlistName]) {
      playlist.playlists[playlistName] = [];
    }
    
    playlist.playlists[playlistName].push({
      id: timestamp.toString(),
      name: file.originalname.replace(/\.[^/.]+$/, ''),
      url: publicUrl,
      fileName: fileName,
    });
    
    await writePlaylist(playlist);
    
    res.json({ success: true, message: '上傳成功', fileName });
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
    const playlist = await readPlaylist();
    
    if (playlist.playlists[name]) {
      return res.status(400).json({ error: '播放清單已存在' });
    }
    
    playlist.playlists[name] = [];
    await writePlaylist(playlist);
    
    res.json({ success: true, message: '播放清單建立成功' });
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
  console.log(`伺服器運行於 http://localhost:${PORT}`);
});