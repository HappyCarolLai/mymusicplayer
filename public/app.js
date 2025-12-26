let currentPlaylist = '所有歌曲';
let allPlaylists = {};
let currentSongs = [];
let currentIndex = 0;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0; // 0: 不循環, 1: 單曲循環, 2: 列表循環
let selectedSongs = new Set();
let batchMode = false;

const audio = document.getElementById('audioPlayer');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const progressBar = document.getElementById('progressBar');
const nowPlaying = document.getElementById('nowPlaying');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const songList = document.getElementById('songList');
const playlistSelector = document.getElementById('playlistSelector');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const newPlaylistBtn = document.getElementById('newPlaylistBtn');
const renamePlaylistBtn = document.getElementById('renamePlaylistBtn');
const deletePlaylistBtn = document.getElementById('deletePlaylistBtn');
const batchActionBar = document.getElementById('batchActionBar');
const selectedCount = document.getElementById('selectedCount');
const addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
const cancelBatchBtn = document.getElementById('cancelBatchBtn');

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
    repeatBtn.addEventListener('click', toggleRepeat);
    progressBar.addEventListener('input', seek);
    playlistSelector.addEventListener('change', handlePlaylistChange);
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleUpload(e.target.files));
    newPlaylistBtn.addEventListener('click', createNewPlaylist);
    renamePlaylistBtn.addEventListener('click', renamePlaylist);
    deletePlaylistBtn.addEventListener('click', deletePlaylist);
    addToPlaylistBtn.addEventListener('click', showAddToPlaylistDialog);
    cancelBatchBtn.addEventListener('click', exitBatchMode);
    
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleSongEnded);

    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }
});

async function loadPlaylists() {
    try {
        const res = await fetch('/api/playlists?t=' + Date.now());
        if (!res.ok) throw new Error('無法載入播放清單');
        
        const data = await res.json();
        allPlaylists = data.playlists;
        const selected = playlistSelector.value || '所有歌曲';
        
        playlistSelector.innerHTML = '';
        Object.keys(allPlaylists).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name === '所有歌曲' ? '🏠 所有歌曲' : `📁 ${name}`;
            opt.selected = (name === selected);
            playlistSelector.appendChild(opt);
        });
        
        currentPlaylist = selected;
        currentSongs = allPlaylists[currentPlaylist] || [];
        renderSongList();
        updatePlaylistButtons();
    } catch (error) {
        showToast('❌ 載入播放清單失敗');
        console.error(error);
    }
}

function updatePlaylistButtons() {
    const isAllSongs = currentPlaylist === '所有歌曲';
    renamePlaylistBtn.style.display = isAllSongs ? 'none' : 'inline-flex';
    deletePlaylistBtn.style.display = isAllSongs ? 'none' : 'inline-flex';
}

async function handlePlaylistChange(e) {
    currentPlaylist = e.target.value;
    await loadPlaylists();
    exitBatchMode();
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

    const isAllSongs = currentPlaylist === '所有歌曲';
    
    songList.innerHTML = currentSongs.map((song, index) => {
        const isSelected = selectedSongs.has(song.id);
        return `
            <div class="song-item ${index === currentIndex && isPlaying ? 'playing' : ''} ${isSelected ? 'selected' : ''}" 
                 data-song-id="${song.id}"
                 onclick="handleSongClick('${song.id}', ${index})">
                ${batchMode ? `<input type="checkbox" class="song-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSongSelect('${song.id}')">` : ''}
                <div class="song-album-art">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                </div>
                <div class="song-info">
                    <div class="song-name">${escapeHtml(song.name)}</div>
                    <div class="song-duration">音樂</div>
                </div>
                ${!batchMode ? `
                    <div class="song-actions">
                        ${isAllSongs ? '' : `
                            <button class="action-btn" onclick="event.stopPropagation(); addSingleToPlaylist('${song.id}')" title="添加到其他清單">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="12" y1="5" x2="12" y2="19"/>
                                    <line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                            </button>
                        `}
                        <button class="action-btn delete" onclick="event.stopPropagation(); deleteSong('${song.id}')" title="${isAllSongs ? '刪除' : '從清單移除'}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                ${isAllSongs ? 
                                    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' :
                                    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
                                }
                            </svg>
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function handleSongClick(songId, index) {
    if (batchMode) {
        toggleSongSelect(songId);
    } else {
        playSong(index);
    }
}

function toggleSongSelect(songId) {
    if (selectedSongs.has(songId)) {
        selectedSongs.delete(songId);
    } else {
        selectedSongs.add(songId);
    }
    selectedCount.textContent = `已選擇 ${selectedSongs.size} 首`;
    renderSongList();
}

function enterBatchMode() {
    if (currentPlaylist !== '所有歌曲') {
        showToast('⚠️ 批量操作僅在「所有歌曲」中可用');
        return;
    }
    batchMode = true;
    selectedSongs.clear();
    batchActionBar.style.display = 'flex';
    renderSongList();
}

function exitBatchMode() {
    batchMode = false;
    selectedSongs.clear();
    batchActionBar.style.display = 'none';
    renderSongList();
}

async function addSingleToPlaylist(songId) {
    selectedSongs.clear();
    selectedSongs.add(songId);
    await showAddToPlaylistDialog();
    selectedSongs.clear();
}

async function showAddToPlaylistDialog() {
    if (selectedSongs.size === 0) {
        showToast('⚠️ 請先選擇歌曲');
        return;
    }

    const otherPlaylists = Object.keys(allPlaylists).filter(name => name !== '所有歌曲' && name !== currentPlaylist);
    
    if (otherPlaylists.length === 0) {
        if (confirm('還沒有其他播放清單，是否建立新清單？')) {
            await createNewPlaylist();
        }
        return;
    }

    const playlistOptions = otherPlaylists.map((name, i) => `${i + 1}. ${name}`).join('\n');
    const input = prompt(`輸入清單編號或名稱：\n\n${playlistOptions}`);
    
    if (!input) return;
    
    let targetPlaylist;
    const num = parseInt(input);
    if (!isNaN(num) && num > 0 && num <= otherPlaylists.length) {
        targetPlaylist = otherPlaylists[num - 1];
    } else {
        targetPlaylist = input.trim();
    }
    
    if (!allPlaylists[targetPlaylist]) {
        showToast('❌ 播放清單不存在');
        return;
    }

    try {
        const res = await fetch('/api/playlist/add-songs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                playlistName: targetPlaylist, 
                songIds: Array.from(selectedSongs) 
            })
        });
        
        if (!res.ok) throw new Error('添加失敗');
        
        showToast(`✅ 已添加 ${selectedSongs.size} 首到「${targetPlaylist}」`);
        exitBatchMode();
        await loadPlaylists();
    } catch (error) {
        showToast('❌ 添加失敗');
        console.error(error);
    }
}

// 長按進入批量模式
let pressTimer;
songList.addEventListener('touchstart', (e) => {
    const songItem = e.target.closest('.song-item');
    if (songItem && currentPlaylist === '所有歌曲' && !batchMode) {
        pressTimer = setTimeout(() => {
            const songId = songItem.dataset.songId;
            enterBatchMode();
            toggleSongSelect(songId);
        }, 500);
    }
});

songList.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
});

songList.addEventListener('contextmenu', (e) => {
    const songItem = e.target.closest('.song-item');
    if (songItem && currentPlaylist === '所有歌曲' && !batchMode) {
        e.preventDefault();
        const songId = songItem.dataset.songId;
        enterBatchMode();
        toggleSongSelect(songId);
    }
});

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
            artist: '音巢',
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

function handleSongEnded() {
    if (repeatMode === 1) {
        audio.currentTime = 0;
        audio.play();
    } else if (repeatMode === 2 || isShuffle) {
        playNext();
    } else {
        if (currentIndex < currentSongs.length - 1) {
            playNext();
        } else {
            isPlaying = false;
            updatePlayButton();
        }
    }
}

function playNext() {
    if (currentSongs.length === 0) return;
    
    if (isShuffle) {
        currentIndex = Math.floor(Math.random() * currentSongs.length);
    } else {
        currentIndex = (currentIndex + 1) % currentSongs.length;
    }
    
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
    if (isShuffle && repeatMode === 1) {
        repeatMode = 0;
        updateRepeatButton();
    }
    showToast(isShuffle ? '🔀 隨機播放已開啟' : '▶️ 順序播放');
}

function toggleRepeat() {
    repeatMode = (repeatMode + 1) % 3;
    updateRepeatButton();
    
    const messages = ['🔁 循環關閉', '🔂 單曲循環', '🔁 列表循環'];
    showToast(messages[repeatMode]);
    
    if (repeatMode === 1 && isShuffle) {
        isShuffle = false;
        shuffleBtn.classList.remove('active');
    }
}

function updateRepeatButton() {
    repeatBtn.classList.toggle('active', repeatMode > 0);
    repeatBtn.style.opacity = repeatMode === 0 ? '0.5' : '1';
}

async function handleUpload(files) {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const maxSize = 50 * 1024 * 1024;
    
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

    await loadPlaylists();
    fileInput.value = '';

    if (failCount === 0) {
        showToast(`✅ 成功上傳 ${successCount} 首歌曲`);
    } else if (successCount === 0) {
        showToast(`❌ 全部上傳失敗 (${failCount} 首)`);
    } else {
        showToast(`⚠️ 成功 ${successCount} 首，失敗 ${failCount} 首`);
    }
}

async function deleteSong(songId) {
    const isAllSongs = currentPlaylist === '所有歌曲';
    const confirmMsg = isAllSongs 
        ? '⚠️ 這將從雲端永久刪除檔案，確定嗎？' 
        : '確定從此清單移除？（不會刪除檔案）';

    if (!confirm(confirmMsg)) return;
    
    try {
        const res = await fetch('/api/music', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId, playlistName: currentPlaylist })
        });
        
        if (!res.ok) throw new Error('刪除失敗');
        
        showToast(isAllSongs ? '✅ 已徹底刪除雲端檔案' : '✅ 已從清單移除');
        await loadPlaylists();
        
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

async function renamePlaylist() {
    const newName = prompt('重新命名清單：', currentPlaylist);
    if (!newName || newName === currentPlaylist) return;
    
    try {
        const res = await fetch('/api/playlist/rename', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName: currentPlaylist, newName })
        });
        
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '重新命名失敗');
        }
        
        showToast('✅ 重新命名成功');
        currentPlaylist = newName;
        await loadPlaylists();
    } catch (error) {
        showToast(`❌ ${error.message}`);
        console.error(error);
    }
}

async function deletePlaylist() {
    if (!confirm(`確定刪除「${currentPlaylist}」清單？（不會刪除音樂檔案）`)) return;
    
    try {
        const res = await fetch('/api/playlist', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: currentPlaylist })
        });
        
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '刪除失敗');
        }
        
        showToast('✅ 清單已刪除');
        currentPlaylist = '所有歌曲';
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