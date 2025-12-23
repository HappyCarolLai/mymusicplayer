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
const volumeBtn = document.getElementById('volumeBtn');
const volumeContainer = document.getElementById('volumeContainer');
const volumeBar = document.getElementById('volumeBar');
const progressBar = document.getElementById('progressBar');
const nowPlaying = document.getElementById('nowPlaying');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const songList = document.getElementById('songList');
const playlistSelector = document.getElementById('playlistSelector');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const newPlaylistBtn = document.getElementById('newPlaylistBtn');

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 註冊 Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
    
    // 讀取儲存的音量
    const savedVolume = localStorage.getItem('volume');
    if (savedVolume) {
        audio.volume = savedVolume / 100;
        volumeBar.value = savedVolume;
    } else {
        audio.volume = 0.8;
        volumeBar.value = 80;
    }
    
    // 載入播放清單
    await loadPlaylists();
    
    // 事件監聽
    playBtn.addEventListener('click', togglePlay);
    prevBtn.addEventListener('click', playPrevious);
    nextBtn.addEventListener('click', playNext);
    shuffleBtn.addEventListener('click', toggleShuffle);
    volumeBtn.addEventListener('click', toggleVolume);
    volumeBar.addEventListener('input', changeVolume);
    progressBar.addEventListener('input', seek);
    playlistSelector.addEventListener('change', switchPlaylist);
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
        
        // 更新選單
        playlistSelector.innerHTML = '';
        Object.keys(data.playlists).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name === 'default' ? '預設清單' : name;
            playlistSelector.appendChild(option);
        });
        
        // 載入當前播放清單
        currentSongs = data.playlists[currentPlaylist] || [];
        renderSongList();
    } catch (error) {
        console.error('載入播放清單失敗:', error);
    }
}

// 渲染歌曲清單
function renderSongList() {
    if (currentSongs.length === 0) {
        songList.innerHTML = '<div class="empty-state">🎵 還沒有音樂，點擊上方上傳按鈕新增</div>';
        return;
    }
    
    songList.innerHTML = currentSongs.map((song, index) => `
        <div class="song-item ${index === currentIndex && isPlaying ? 'playing' : ''}" 
             onclick="playSong(${index})">
            <div class="song-icon">${index === currentIndex && isPlaying ? '🎵' : '🎶'}</div>
            <div class="song-info">
                <div class="song-name">${song.name}</div>
            </div>
            <button class="delete-btn" onclick="deleteSong(event, '${song.id}', '${song.fileName}')">刪除</button>
        </div>
    `).join('');
}

// 播放指定歌曲
function playSong(index) {
    if (currentSongs.length === 0) return;
    
    currentIndex = index;
    const song = currentSongs[currentIndex];
    audio.src = song.url;
    audio.play();
    isPlaying = true;
    
    playBtn.textContent = '⏸️';
    nowPlaying.textContent = song.name;
    
    // 更新 Media Session
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name,
            artist: '私人音樂庫',
            album: currentPlaylist,
        });
    }
    
    renderSongList();
}

// 播放/暫停
function togglePlay() {
    if (currentSongs.length === 0) return;
    
    if (isPlaying) {
        audio.pause();
        playBtn.textContent = '▶️';
    } else {
        if (!audio.src) {
            playSong(0);
        } else {
            audio.play();
            playBtn.textContent = '⏸️';
        }
    }
    isPlaying = !isPlaying;
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
    shuffleBtn.style.opacity = isShuffle ? '1' : '0.5';
}

// 音量控制
function toggleVolume() {
    volumeContainer.style.display = 
        volumeContainer.style.display === 'none' ? 'block' : 'none';
}

function changeVolume() {
    const volume = volumeBar.value / 100;
    audio.volume = volume;
    localStorage.setItem('volume', volumeBar.value);
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
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 切換播放清單
async function switchPlaylist() {
    currentPlaylist = playlistSelector.value;
    await loadPlaylists();
    
    // 停止當前播放
    audio.pause();
    audio.src = '';
    isPlaying = false;
    playBtn.textContent = '▶️';
    nowPlaying.textContent = '未播放';
    currentIndex = 0;
}

// 上傳音樂
async function handleUpload(event) {
    const files = event.target.files;
    if (files.length === 0) return;
    
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
                console.log(`上傳成功: ${file.name}`);
            }
        } catch (error) {
            console.error('上傳失敗:', error);
        }
    }
    
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
            await loadPlaylists();
        }
    } catch (error) {
        console.error('刪除失敗:', error);
    }
}

// 新增播放清單
async function createNewPlaylist() {
    const name = prompt('請輸入播放清單名稱：');
    if (!name) return;
    
    try {
        const response = await fetch('/api/playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        if (response.ok) {
            await loadPlaylists();
            playlistSelector.value = name;
            currentPlaylist = name;
            await loadPlaylists();
        }
    } catch (error) {
        console.error('建立播放清單失敗:', error);
    }
}