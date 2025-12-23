// 全域變數
let currentPlaylist = 'default';
let currentSongs = [];
let currentIndex = 0;
let isPlaying = false;
let isShuffle = false;

// DOM 元素
const audio = document.getElementById('audioPlayer');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const progressBar = document.getElementById('progressBar');
const nowPlaying = document.getElementById('nowPlaying');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const songList = document.getElementById('songList');
const playlistSelector = document.getElementById('playlistSelector');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const newPlaylistBtn = document.getElementById('newPlaylistBtn');
const albumArt = document.getElementById('albumArt');

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 註冊 Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    
    // 載入播放清單
    await loadPlaylists();
    
    // 事件監聽
    playBtn.addEventListener('click', togglePlay);
    prevBtn.addEventListener('click', playPrevious);
    nextBtn.addEventListener('click', playNext);
    shuffleBtn.addEventListener('click', toggleShuffle);
    progressBar.addEventListener('input', seek);
    playlistSelector.addEventListener('change', handlePlaylistChange);
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleUpload);
    newPlaylistBtn.addEventListener('click', createNewPlaylist);
    
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', playNext);
    
    // Media Session API
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }
});

// 載入所有播放清單
async function loadPlaylists() {
    try {
        const response = await fetch('/api/playlists');
        const data = await response.json();
        
        // 保存當前選擇的播放清單
        const selectedPlaylist = playlistSelector.value || currentPlaylist;
        
        // 更新選單
        playlistSelector.innerHTML = '';
        const playlistNames = Object.keys(data.playlists);
        
        playlistNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name === 'default' ? '🎵 預設清單' : `📁 ${name}`;
            if (name === selectedPlaylist) {
                option.selected = true;
            }
            playlistSelector.appendChild(option);
        });
        
        // 載入當前播放清單的歌曲
        currentPlaylist = selectedPlaylist;
        currentSongs = data.playlists[currentPlaylist] || [];
        renderSongList();
    } catch (error) {
        console.error('載入播放清單失敗:', error);
    }
}

// 處理播放清單切換
async function handlePlaylistChange(event) {
    currentPlaylist = event.target.value;
    
    // 重新載入播放清單數據
    const response = await fetch('/api/playlists');
    const data = await response.json();
    currentSongs = data.playlists[currentPlaylist] || [];
    
    // 停止當前播放
    audio.pause();
    audio.src = '';
    isPlaying = false;
    updatePlayButton();
    nowPlaying.textContent = '未播放';
    currentIndex = 0;
    
    // 更新封面
    updateAlbumArt();
    
    // 重新渲染清單
    renderSongList();
}

// 提取音樂封面（使用 jsmediatags）
function extractAlbumArt(url, callback) {
    // 由於瀏覽器限制，我們無法直接從 R2 提取封面
    // 改用預設漸層背景
    callback(null);
}

// 更新專輯封面
function updateAlbumArt(imageData = null) {
    if (imageData) {
        albumArt.innerHTML = `<img src="${imageData}" alt="Album Art">`;
    } else {
        albumArt.innerHTML = '<div class="default-cover">🎵</div>';
    }
}

// 渲染歌曲清單
function renderSongList() {
    if (currentSongs.length === 0) {
        songList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎵</div>
                <div class="empty-text">還沒有音樂</div>
                <div class="empty-hint">點擊上方 📁 按鈕上傳</div>
            </div>
        `;
        return;
    }
    
    songList.innerHTML = currentSongs.map((song, index) => `
        <div class="song-item ${index === currentIndex && isPlaying ? 'playing' : ''}" 
             onclick="playSong(${index})">
            <div class="song-album-art">
                ${index === currentIndex && isPlaying ? '▶️' : '🎵'}
            </div>
            <div class="song-info">
                <div class="song-name">${escapeHtml(song.name)}</div>
                <div class="song-duration">點擊播放</div>
            </div>
            <button class="delete-btn" onclick="deleteSong(event, '${song.id}', '${song.fileName}')">刪除</button>
        </div>
    `).join('');
}

// HTML 跳脫函數
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 播放指定歌曲
function playSong(index) {
    if (currentSongs.length === 0) return;
    
    currentIndex = index;
    const song = currentSongs[currentIndex];
    
    audio.src = song.url;
    audio.play().catch(err => console.error('播放失敗:', err));
    isPlaying = true;
    
    updatePlayButton();
    nowPlaying.textContent = song.name;
    
    // 更新專輯封面
    updateAlbumArt();
    
    // 更新 Media Session
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name,
            artist: '私人音樂庫',
            album: currentPlaylist === 'default' ? '預設清單' : currentPlaylist,
        });
    }
    
    renderSongList();
}

// 更新播放按鈕
function updatePlayButton() {
    const playIcon = playBtn.querySelector('.play-icon');
    const pauseIcon = playBtn.querySelector('.pause-icon');
    
    if (isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

// 播放/暫停
function togglePlay() {
    if (currentSongs.length === 0) return;
    
    if (isPlaying) {
        audio.pause();
    } else {
        if (!audio.src) {
            playSong(0);
        } else {
            audio.play().catch(err => console.error('播放失敗:', err));
        }
    }
    isPlaying = !isPlaying;
    updatePlayButton();
}

// 上一首
function playPrevious() {
    if (currentSongs.length === 0) return;
    currentIndex = (currentIndex - 1 + currentSongs.length) % currentSongs.length;
    playSong(currentIndex);
}

// 下一首
function playNext() {
    if (currentSongs.length === 0) return;
    
    if (isShuffle) {
        currentIndex = Math.floor(Math.random() * currentSongs.length);
    } else {
        currentIndex = (currentIndex + 1) % currentSongs.length;
    }
    playSong(currentIndex);
}

// 隨機播放
function toggleShuffle() {
    isShuffle = !isShuffle;
    if (isShuffle) {
        shuffleBtn.classList.add('active');
    } else {
        shuffleBtn.classList.remove('active');
    }
}

// 進度條
function updateProgress() {
    if (audio.duration) {
        progressBar.value = (audio.currentTime / audio.duration) * 100;
        currentTimeEl.textContent = formatTime(audio.currentTime);
    }
}

function updateDuration() {
    durationEl.textContent = formatTime(audio.duration);
}

function seek() {
    const time = (progressBar.value / 100) * audio.duration;
    audio.currentTime = time;
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 顯示上傳提示
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'upload-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 2000);
}

// 上傳音樂
async function handleUpload(event) {
    const files = event.target.files;
    if (files.length === 0) return;
    
    showToast(`正在上傳 ${files.length} 個檔案...`);
    
    let successCount = 0;
    
    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('playlist', currentPlaylist);
        
        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                successCount++;
            }
        } catch (error) {
            console.error('上傳失敗:', error);
        }
    }
    
    showToast(`成功上傳 ${successCount}/${files.length} 個檔案`);
    
    // 重新載入播放清單
    await loadPlaylists();
    fileInput.value = '';
}

// 刪除歌曲
async function deleteSong(event, songId, fileName) {
    event.stopPropagation();
    
    if (!confirm('確定要刪除這首歌嗎？')) return;
    
    try {
        const response = await fetch('/api/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                fileName, 
                playlistName: currentPlaylist,
                songId 
            })
        });
        
        if (response.ok) {
            showToast('刪除成功');
            await loadPlaylists();
        }
    } catch (error) {
        console.error('刪除失敗:', error);
        showToast('刪除失敗');
    }
}

// 新增播放清單
async function createNewPlaylist() {
    const name = prompt('請輸入播放清單名稱：');
    if (!name || name.trim() === '') return;
    
    try {
        const response = await fetch('/api/playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast('播放清單建立成功');
            await loadPlaylists();
            
            // 切換到新建立的播放清單
            playlistSelector.value = name.trim();
            currentPlaylist = name.trim();
            
            // 重新載入該播放清單的內容
            const playlistResponse = await fetch('/api/playlists');
            const data = await playlistResponse.json();
            currentSongs = data.playlists[currentPlaylist] || [];
            renderSongList();
        } else {
            showToast(result.error || '建立失敗');
        }
    } catch (error) {
        console.error('建立播放清單失敗:', error);
        showToast('建立失敗');
    }
}