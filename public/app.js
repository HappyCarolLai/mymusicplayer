let currentPlaylist = 'default';
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
    // 移除現有的 toast
    const existingToast = document.querySelector('.upload-toast');
    if (existingToast) {
        existingToast.remove();
    }

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
    //if ('serviceWorker' in navigator) {
    //    navigator.serviceWorker.register('/sw.js').catch(() => {});
    //}
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
        const selected = playlistSelector.value || 'default';
        
        playlistSelector.innerHTML = '';
        Object.keys(data.playlists).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name === 'default' ? '🎵 預設清單' : `📁 ${name}`;
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
                <div class="empty-hint">點擊上方 📁 按鈕上傳</div>
            </div>
        `;
        return;
    }

    songList.innerHTML = currentSongs.map((song, index) => `
        <div class="song-item ${index === currentIndex && isPlaying ? 'playing' : ''}" onclick="playSong(${index})">
            <div class="song-album-art">🎵</div>
            <div class="song-info">
                <div class="song-name">${escapeHtml(song.name)}</div>
                <div class="song-duration">音樂</div>
            </div>
            <button class="delete-btn" onclick="deleteSong(event, '${song.id}', '${escapeHtml(song.fileName)}')">刪除</button>
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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

    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name,
            artist: '私人音樂庫',
            album: currentPlaylist,
            artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }]
        });
    }
}

function togglePlay() {
    if (currentSongs.length === 0) {
        showToast('⚠️ 請先上傳音樂');
        return;
    }
    
    if (!audio.src) {
        playSong(0);
        return;
    }
    
    if (isPlaying) {
        audio.pause();
    } else {
        audio.play().catch(err => {
            showToast('❌ 播放失敗');
            console.error(err);
        });
    }
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
    showToast(isShuffle ? '🔀 隨機播放已開啟' : '▶️ 順序播放');
}

async function handleUpload(files) {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const maxSize = 50 * 1024 * 1024; // 50MB
    
    // 檢查檔案大小
    const oversizedFiles = fileArray.filter(f => f.size > maxSize);
    if (oversizedFiles.length > 0) {
        showToast(`❌ 檔案過大: ${oversizedFiles[0].name} (限制 50MB)`);
        return;
    }

    let successCount = 0;
    let failCount = 0;

    showToast(`📤 上傳中... (0/${fileArray.length})`);

    for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const formData = new FormData();
        formData.append('audio', file);
        formData.append('playlistName', currentPlaylist);
        
        try {
            showToast(`📤 上傳中... (${i + 1}/${fileArray.length}) - ${file.name}`, 1000);
            
            const res = await fetch('/api/upload', { 
                method: 'POST', 
                body: formData 
            });
            
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || '伺服器錯誤');
            }
            
            successCount++;
        } catch (e) {
            console.error(`上傳失敗: ${file.name}`, e);
            failCount++;
        }
    }

    // 重新載入播放清單
    await loadPlaylists();
    fileInput.value = '';

    // 顯示結果
    if (failCount === 0) {
        showToast(`✅ 成功上傳 ${successCount} 首歌曲`);
    } else if (successCount === 0) {
        showToast(`❌ 全部上傳失敗 (${failCount} 首)`);
    } else {
        showToast(`⚠️ 成功 ${successCount} 首，失敗 ${failCount} 首`);
    }
}

async function renameSong(event, songId, oldName) {
    event.stopPropagation();
    const newName = prompt('重新命名歌曲：', oldName);
    if (!newName || newName === oldName) return;
    
    try {
        const res = await fetch('/api/music/rename', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId, newName, playlistName: currentPlaylist })
        });
        
        if (!res.ok) throw new Error('重新命名失敗');
        
        showToast('✅ 重新命名成功');
        await loadPlaylists();
    } catch (error) {
        showToast('❌ 重新命名失敗');
        console.error(error);
    }
}

async function deleteSong(event, songId, fileName) {
    event.stopPropagation();
    if (!confirm('確定刪除這首歌曲？')) return;
    
    try {
        const res = await fetch('/api/music', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, playlistName: currentPlaylist, songId })
        });
        
        if (!res.ok) throw new Error('刪除失敗');
        
        showToast('✅ 刪除成功');
        await loadPlaylists();
        
        // 如果刪除的是正在播放的歌曲
        if (currentSongs.length > 0 && currentIndex >= currentSongs.length) {
            currentIndex = 0;
        }
    } catch (error) {
        showToast('❌ 刪除失敗');
        console.error(error);
    }
}

async function createNewPlaylist() {
    const name = prompt('新清單名稱：');
    if (!name || name.trim() === '') return;
    
    try {
        const res = await fetch('/api/playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '建立失敗');
        }
        
        showToast('✅ 清單建立成功');
        await loadPlaylists();
    } catch (error) {
        showToast(`❌ ${error.message}`);
        console.error(error);
    }
}

function updateProgress() {
    if (audio.duration) {
        progressBar.value = (audio.currentTime / audio.duration) * 100 || 0;
        currentTimeEl.textContent = formatTime(audio.currentTime);
    }
}

function updateDuration() { 
    if (audio.duration) {
        durationEl.textContent = formatTime(audio.duration); 
    }
}

function seek() { 
    if (audio.duration) {
        audio.currentTime = (progressBar.value / 100) * audio.duration; 
    }
}

function formatTime(s) {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}