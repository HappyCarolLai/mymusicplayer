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
    console.log('--- 開始處理上傳 ---');
    try {
        if (!req.file) {
            return res.status(400).json({ error: '未接收到檔案' });
        }

        const { playlistName } = req.body;
        const originalName = req.file.originalname;
        const safeFileName = `${Date.now()}-${encodeURIComponent(originalName)}`;

        console.log('正在處理音訊: ', originalName);

        const inputStream = Readable.from(req.file.buffer);
        const chunks = [];

        // 建立 FFmpeg 處理
        ffmpeg(inputStream)
            .audioFilters('volume=0.5') // 使用者要求的音量減半
            .format('mp3')
            .on('start', (cmd) => console.log('FFmpeg 指令啟動'))
            .on('error', (err) => {
                console.error('FFmpeg 錯誤:', err.message);
                if (!res.headersSent) res.status(500).json({ error: '音訊處理失敗' });
            })
            .pipe()
            .on('data', (chunk) => chunks.push(chunk))
            .on('end', async () => {
                try {
                    console.log('FFmpeg 處理完成，準備上傳至 R2...');
                    const processedBuffer = Buffer.concat(chunks);
                    
                    await s3Client.send(new PutObjectCommand({
                        Bucket: BUCKET_NAME,
                        Key: safeFileName,
                        Body: processedBuffer,
                        ContentType: 'audio/mpeg'
                    }));

                    const publicUrl = `${process.env.R2_PUBLIC_URL}/${safeFileName}`;
                    const newSong = { 
                        id: Date.now().toString(), 
                        name: originalName, 
                        url: publicUrl, 
                        fileName: safeFileName 
                    };

                    // 確保 MongoDB 已連線才執行
                    if (mongoose.connection.readyState !== 1) {
                        throw new Error('MongoDB 未連線');
                    }

                    await Playlist.findOneAndUpdate(
                        { name: playlistName || '預設清單' },
                        { $push: { songs: newSong } },
                        { upsert: true, new: true }
                    );

                    console.log('✅ 全部流程完成');
                    res.json({ success: true, song: newSong });
                } catch (innerError) {
                    console.error('上傳或資料庫寫入錯誤:', innerError);
                    if (!res.headersSent) res.status(500).json({ error: innerError.message });
                }
            });

    } catch (err) {
        console.error('全域捕捉錯誤:', err);
        res.status(500).json({ error: err.message });
    }
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