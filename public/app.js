let currentPlaylist = '所有歌曲'; // 修改預設清單名稱
let currentSongs = [];
let currentIndex = 0;
let isPlaying = false;
let isShuffle = false;

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

// Toast 提示函數
function showToast(message, duration = 3000) {
    const existingToast = document.querySelector('.upload-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'upload-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

document.addEventListener('DOMContentLoaded', async () => {
    // 註銷舊的 Service Worker 以確保更新
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => {
            regs.forEach(reg => reg.unregister());
        });
    }

    await loadPlaylists();
    
    playBtn.addEventListener('click', togglePlay);
    prevBtn.addEventListener('click', playPrevious);
    nextBtn.addEventListener('click', playNext);
    shuffleBtn.addEventListener('click', toggleShuffle);
    progressBar.addEventListener('input', seek);
    playlistSelector.addEventListener('change', handlePlaylistChange);
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleUpload(e.target.files));
    newPlaylistBtn.addEventListener('click', createNewPlaylist);
    
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', playNext); 

    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }
});

async function loadPlaylists() {
    try {
        const res = await fetch('/api/playlists');
        if (!res.ok) throw new Error('無法載入播放清單');
        
        const data = await res.json();
        // 如果原本存的是 default，自動轉向「所有歌曲」
        const selected = playlistSelector.value || '所有歌曲';
        
        playlistSelector.innerHTML = '';
        Object.keys(data.playlists).forEach(name => {
            const opt = document.createElement('option');
            // 將後端可能傳回的 'default' 顯示為 '所有歌曲'
            const displayName = (name === 'default' || name === '所有歌曲') ? '所有歌曲' : name;
            opt.value = name; 
            opt.textContent = (displayName === '所有歌曲') ? '🏠 所有歌曲' : `📁 ${displayName}`;
            opt.selected = (name === selected);
            playlistSelector.appendChild(opt);
        });
        
        currentPlaylist = selected;
        currentSongs = data.playlists[currentPlaylist] || [];
        renderSongList();
    } catch (error) {
        showToast('❌ 載入播放清單失敗');
        console.error(error);
    }
}

async function handlePlaylistChange(e) {
    currentPlaylist = e.target.value;
    await loadPlaylists();
    audio.pause();
    isPlaying = false;
    updatePlayButton();
}

function renderSongList() {
    if (currentSongs.length === 0) {
        songList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎵</div>
                <div class="empty-text">還沒有音樂</div>
                <div class="empty-hint">點擊上方按鈕上傳</div>
            </div>
        `;
        return;
    }

    songList.innerHTML = currentSongs.map((song, index) => `
        <div class="song-item ${index === currentIndex && isPlaying ? 'playing' : ''}" onclick="playSong(${index})">
            <div class="song-album-art"></div> 
            <div class="song-info">
                <div class="song-name">${escapeHtml(song.name)}</div>
                <div class="song-duration">音樂</div>
            </div>
            <div class="song-actions">
                <button class="move-btn" onclick="openMoveMenu(event, ${index})" title="加入到清單">➕</button>
                <button class="delete-btn" onclick="deleteSong(event, '${song.id}', '${escapeHtml(song.fileName)}')" title="刪除">🗑️</button>
            </div>
        </div>
    `).join('');
}

// 刪除重複的 openMoveMenu，統一使用這一個版本
async function openMoveMenu(event, index) {
    event.stopPropagation();
    const song = currentSongs[index];
    const target = prompt('請輸入要【加入/移動】到的播放清單名稱：');
    if (!target || target.trim() === '') return;

    // 這裡可以加一個防呆：如果目標就是當前清單，提醒使用者
    if (target.trim() === currentPlaylist) {
        showToast('⚠️ 歌曲已在該清單中');
        return;
    }

    try {
        const res = await fetch('/api/music/copy-to-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                song: song,
                targetPlaylistName: target.trim(),
                deleteFromOriginal: false 
            })
        });
        
        if (res.ok) {
            showToast(`✅ 已將歌曲加入到 ${target}`);
            await loadPlaylists(); // 重新載入以更新下拉選單
        } else {
            throw new Error();
        }
    } catch (err) {
        showToast('❌ 搬移失敗');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ... (其餘 playSong, togglePlay, handleUpload 等函式保持不變) ...

function playSong(index) {
    if (currentSongs.length === 0) return;
    currentIndex = index;
    const song = currentSongs[currentIndex];
    audio.src = song.url;
    audio.play().catch(err => {
        showToast('❌ 播放失敗');
        console.error(err);
    });
    isPlaying = true;
    nowPlaying.textContent = song.name;
    updatePlayButton();
    renderSongList();
}

function togglePlay() {
    if (currentSongs.length === 0) return;
    if (!audio.src) { playSong(0); return; }
    if (isPlaying) audio.pause(); else audio.play();
    isPlaying = !isPlaying;
    updatePlayButton();
}

function updatePlayButton() {
    const playIcon = playBtn.querySelector('.play-icon');
    const pauseIcon = playBtn.querySelector('.pause-icon');
    playIcon.style.display = isPlaying ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
}

function playNext() {
    if (currentSongs.length === 0) return;
    currentIndex = isShuffle ? Math.floor(Math.random() * currentSongs.length) : (currentIndex + 1) % currentSongs.length;
    playSong(currentIndex);
}

function playPrevious() {
    if (currentSongs.length === 0) return;
    currentIndex = (currentIndex - 1 + currentSongs.length) % currentSongs.length;
    playSong(currentIndex);
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
}

async function handleUpload(files) {
    if (!files || files.length === 0) return;
    for (let file of files) {
        const formData = new FormData();
        formData.append('audio', file);
        formData.append('playlistName', currentPlaylist);
        await fetch('/api/upload', { method: 'POST', body: formData });
    }
    await loadPlaylists();
}

async function deleteSong(event, songId, fileName) {
    event.stopPropagation(); // 防止點擊刪除按鈕時觸發播放歌曲
    
    // 判斷目前是否在「所有歌曲」清單
    const isMainList = (currentPlaylist === '所有歌曲');
    
    // 根據清單顯示不同的提示字句
    const confirmMsg = isMainList 
        ? '⚠️ 這是「所有歌曲」清單，刪除將會【徹底從雲端移除】檔案！確定嗎？' 
        : '確定要將此歌曲從【本播放清單】移除嗎？\n(這不會刪除原始檔案，您仍可在「所有歌曲」中找到它)';

    if (!confirm(confirmMsg)) return;
    
    try {
        const res = await fetch('/api/music', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                fileName, 
                playlistName: currentPlaylist, 
                songId 
            })
        });
        
        if (!res.ok) throw new Error('刪除失敗');
        
        showToast(isMainList ? '✅ 已徹底刪除雲端檔案' : '✅ 已從清單移除');
        
        // 重新載入清單畫面
        await loadPlaylists();
        
    } catch (error) {
        showToast('❌ 刪除失敗');
        console.error(error);
    }
}

async function createNewPlaylist() {
    const name = prompt('新清單名稱：');
    if (!name) return;
    await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
    });
    await loadPlaylists();
}

async function openMoveMenu(event, index) {
    event.stopPropagation();
    const song = currentSongs[index];
    const target = prompt('請輸入要【加入/移動】到的播放清單名稱：');
    if (!target || target.trim() === '') return;

    try {
        const res = await fetch('/api/music/copy-to-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                song: song,
                targetPlaylistName: target.trim(),
                deleteFromOriginal: false // 設為 false 是「複製」，設為 true 就是「移動」
            })
        });
        
        if (res.ok) {
            showToast(`✅ 已將歌曲加入到 ${target}`);
            loadPlaylists();
        } else {
            throw new Error();
        }
    } catch (err) {
        showToast('❌ 搬移失敗');
    }
}

function updateProgress() {
    if (audio.duration) progressBar.value = (audio.currentTime / audio.duration) * 100 || 0;
}

function updateDuration() { durationEl.textContent = formatTime(audio.duration); }
function seek() { audio.currentTime = (progressBar.value / 100) * audio.duration; }
function formatTime(s) {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}