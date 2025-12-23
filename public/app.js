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

document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
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
    const res = await fetch('/api/playlists');
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
}

async function handlePlaylistChange(e) {
    currentPlaylist = e.target.value;
    await loadPlaylists();
    audio.pause();
    isPlaying = false;
    updatePlayButton();
}

function renderSongList() {
    songList.innerHTML = currentSongs.map((song, index) => `
        <div class="song-item ${index === currentIndex && isPlaying ? 'playing' : ''}" onclick="playSong(${index})">
            <div class="song-info">
                <div class="song-name">${song.name}</div>
            </div>
            <div class="song-actions">
                <button class="action-btn" onclick="renameSong(event, '${song.id}', '${song.name}')">✏️</button>
                <button class="action-btn" onclick="deleteSong(event, '${song.id}', '${song.fileName}')">🗑️</button>
            </div>
        </div>
    `).join('') || '<div class="empty">尚未上傳音樂</div>';
}

function playSong(index) {
    if (currentSongs.length === 0) return;
    currentIndex = index;
    const song = currentSongs[currentIndex];
    audio.src = song.url;
    audio.play();
    isPlaying = true;
    nowPlaying.textContent = song.name;
    updatePlayButton();
    renderSongList();

    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name,
            artist: 'SoundNest',
            album: currentPlaylist,
            artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }]
        });
    }
}

function togglePlay() {
    if (currentSongs.length === 0) return;
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
    const fileArray = Array.from(files);
    for (const file of fileArray) {
        const formData = new FormData();
        formData.append('audio', file);
        formData.append('playlistName', currentPlaylist);
        console.log(`正在上傳: ${file.name}`);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!res.ok) throw new Error('伺服器錯誤');
        } catch (e) {
            alert(`上傳失敗: ${file.name}`);
        }
    }
    await loadPlaylists();
    fileInput.value = '';
}

async function renameSong(event, songId, oldName) {
    event.stopPropagation();
    const newName = prompt('重新命名歌曲：', oldName);
    if (!newName) return;
    await fetch('/api/music/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId, newName, playlistName: currentPlaylist })
    });
    await loadPlaylists();
}

async function deleteSong(event, songId, fileName) {
    event.stopPropagation();
    if (!confirm('確定刪除？')) return;
    await fetch('/api/music', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, playlistName: currentPlaylist, songId })
    });
    await loadPlaylists();
}

async function createNewPlaylist() {
    const name = prompt('新清單名稱：');
    if (!name) return;
    await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    await loadPlaylists();
}

function updateProgress() {
    progressBar.value = (audio.currentTime / audio.duration) * 100 || 0;
    currentTimeEl.textContent = formatTime(audio.currentTime);
}
function updateDuration() { durationEl.textContent = formatTime(audio.duration); }
function seek() { audio.currentTime = (progressBar.value / 100) * audio.duration; }
function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}