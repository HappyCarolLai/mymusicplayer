let currentPlaylist = '已上傳歌曲清單';
let allPlaylists = {};
let currentSongs = [];
let currentIndex = 0;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0;
let selectedSongs = new Set();
let batchMode = false;
let shuffleHistory = [];
let availableIndices = [];

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
const addToListBtn = document.getElementById('addToListBtn');
const fileInput = document.getElementById('fileInput');
const newPlaylistBtn = document.getElementById('newPlaylistBtn');
const renamePlaylistBtn = document.getElementById('renamePlaylistBtn');
const deletePlaylistBtn = document.getElementById('deletePlaylistBtn');
const batchActionBar = document.getElementById('batchActionBar');
const selectedCount = document.getElementById('selectedCount');
const addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
const cancelBatchBtn = document.getElementById('cancelBatchBtn');
const playlistDropdown = document.getElementById('playlistDropdown');
const playlistOptions = document.getElementById('playlistOptions');
const albumArt = document.getElementById('albumArt');

// Web Audio API 設定（iOS 相容的音量控制）
let audioContext = null;
let gainNode = null;
let sourceNode = null;
let isAudioContextInitialized = false;

// 設定統一音量為 35%
const STANDARD_VOLUME = 0.35;

// 初始化 Web Audio API
function initializeAudioContext() {
    if (isAudioContextInitialized) return;
    
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        sourceNode = audioContext.createMediaElementSource(audio);
        gainNode = audioContext.createGain();
        sourceNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = STANDARD_VOLUME;
        isAudioContextInitialized = true;
        console.log('✅ Web Audio API 初始化成功，音量設為', STANDARD_VOLUME);
    } catch (error) {
        console.error('❌ Web Audio API 初始化失敗:', error);
        audio.volume = STANDARD_VOLUME;
    }
}

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
    addToListBtn.addEventListener('click', enterBatchMode);
    fileInput.addEventListener('change', (e) => handleUpload(e.target.files));
    newPlaylistBtn.addEventListener('click', createNewPlaylist);
    renamePlaylistBtn.addEventListener('click', renamePlaylist);
    deletePlaylistBtn.addEventListener('click', deletePlaylist);
    addToPlaylistBtn.addEventListener('click', showPlaylistDropdown);
    cancelBatchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exitBatchMode();
    });
    
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleSongEnded);
    
    audio.addEventListener('pause', () => {
        if (isPlaying && !audio.ended) {
            setTimeout(() => {
                if (isPlaying) {
                    audio.play().catch(err => console.error('自動恢復播放失敗:', err));
                }
            }, 100);
        }
    });
    
    audio.addEventListener('error', (e) => {
        console.error('音訊載入錯誤:', e);
        showToast('音訊載入失敗');
        isPlaying = false;
        updatePlayButton();
    });
    
    audio.addEventListener('loadeddata', () => {
        if (gainNode) {
            gainNode.gain.value = STANDARD_VOLUME;
        }
    });
    
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
    });

    document.addEventListener('click', (e) => {
        if (!playlistDropdown.contains(e.target) && !addToPlaylistBtn.contains(e.target)) {
            playlistDropdown.style.display = 'none';
        }
    });

    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => {
            if (audio.src) {
                if (audioContext && audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                audio.play().catch(err => console.error('Media Session 播放失敗:', err));
                isPlaying = true;
                updatePlayButton();
            }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            audio.pause();
            isPlaying = false;
            updatePlayButton();
        });
        navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            audio.currentTime = Math.max(audio.currentTime - (details.seekOffset || 10), 0);
        });
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            audio.currentTime = Math.min(audio.currentTime + (details.seekOffset || 10), audio.duration);
        });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime) {
                audio.currentTime = details.seekTime;
            }
        });
    }
});

async function loadPlaylists() {
    try {
        const res = await fetch('/api/playlists?t=' + Date.now());
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        
        const data = await res.json();
        allPlaylists = data.playlists;
        
        const selected = allPlaylists[currentPlaylist] ? currentPlaylist : '已上傳歌曲清單';
        
        playlistSelector.innerHTML = '';
        Object.keys(allPlaylists).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name === '已上傳歌曲清單' ? '已上傳歌曲清單' : name;
            opt.selected = (name === selected);
            playlistSelector.appendChild(opt);
        });
        
        currentPlaylist = selected;
        currentSongs = allPlaylists[currentPlaylist] || [];
        resetShuffleState();
        renderSongList();
        updatePlaylistButtons();
        updatePlaylistIcon();
    } catch (error) {
        console.error('載入播放清單失敗:', error);
        showToast('載入播放清單失敗: ' + error.message);
    }
}

function updatePlaylistIcon() {
    const playlistIcon = document.getElementById('playlistIcon');
    if (!playlistIcon) return;
    
    if (currentPlaylist === '已上傳歌曲清單') {
        playlistIcon.innerHTML = '<path d="M3 12h18M3 6h18M3 18h18"/>';
    } else {
        playlistIcon.innerHTML = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';
    }
}

function updatePlaylistButtons() {
    const isMainList = currentPlaylist === '已上傳歌曲清單';
    renamePlaylistBtn.style.display = isMainList ? 'none' : 'inline-flex';
    deletePlaylistBtn.style.display = isMainList ? 'none' : 'inline-flex';
    uploadBtn.style.display = isMainList ? 'inline-flex' : 'none';
    addToListBtn.style.display = isMainList ? 'inline-flex' : 'none';
}

async function handlePlaylistChange(e) {
    currentPlaylist = e.target.value;
    currentSongs = allPlaylists[currentPlaylist] || [];
    resetShuffleState();
    renderSongList();
    updatePlaylistButtons();
    updatePlaylistIcon();
    exitBatchMode();
}

function resetShuffleState() {
    shuffleHistory = [];
    availableIndices = currentSongs.map((_, i) => i);
}

function renderSongList() {
    if (currentSongs.length === 0) {
        songList.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
                <div class="empty-text">還沒有音樂</div>
                <div class="empty-hint">點擊上方上傳按鈕</div>
            </div>
        `;
        return;
    }

    const isMainList = currentPlaylist === '已上傳歌曲清單';
    
    songList.innerHTML = currentSongs.map((song, index) => {
        const isSelected = selectedSongs.has(song.id);
        const coverHtml = song.coverUrl 
            ? `<img src="${song.coverUrl}" alt="專輯封面">`
            : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>`;
        
        return `
            <div class="song-item ${index === currentIndex && isPlaying ? 'playing' : ''} ${isSelected ? 'selected' : ''}" 
                 data-song-id="${song.id}"
                 onclick="handleSongClick('${song.id}', ${index})">
                ${batchMode ? `<input type="checkbox" class="song-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSongSelect('${song.id}')">` : ''}
                <div class="song-album-art">
                    ${coverHtml}
                </div>
                <div class="song-info">
                    <div class="song-name">${escapeHtml(song.name)}</div>
                    <div class="song-duration">音樂</div>
                </div>
                ${!batchMode ? `
                    <div class="song-actions">
                        <button class="action-btn delete" onclick="event.stopPropagation(); deleteSong('${song.id}')" title="${isMainList ? '刪除' : '從清單移除'}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                ${isMainList ? 
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
        if (isShuffle) {
            shuffleHistory.push(index);
            availableIndices = availableIndices.filter(i => i !== index);
        }
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
    if (currentSongs.length === 0) {
        showToast('清單中沒有歌曲');
        return;
    }
    batchMode = true;
    selectedSongs.clear();
    batchActionBar.style.display = 'flex';
    uploadBtn.style.display = 'none';
    renderSongList();
}

function exitBatchMode() {
    batchMode = false;
    selectedSongs.clear();
    batchActionBar.style.display = 'none';
    playlistDropdown.style.display = 'none';
    selectedCount.textContent = '已選擇 0 首';
    updatePlaylistButtons();
    renderSongList();
}

function showPlaylistDropdown() {
    if (selectedSongs.size === 0) {
        showToast('請先選擇歌曲');
        return;
    }

    const otherPlaylists = Object.keys(allPlaylists).filter(name => 
        name !== '已上傳歌曲清單' && name !== currentPlaylist
    );
    
    if (otherPlaylists.length === 0) {
        if (confirm('還沒有其他播放清單,是否建立新清單?')) {
            createNewPlaylist();
        }
        return;
    }

    playlistOptions.innerHTML = otherPlaylists.map(name => {
        const safeName = escapeHtml(name).replace(/'/g, '&#39;');
        return `<div class="playlist-option" onclick="addToSelectedPlaylist('${safeName}')">${escapeHtml(name)}</div>`;
    }).join('');
    
    playlistDropdown.style.display = 'block';
}

async function addToSelectedPlaylist(playlistName) {
    try {
        const res = await fetch('/api/playlist/add-songs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                playlistName, 
                songIds: Array.from(selectedSongs) 
            })
        });
        
        if (!res.ok) throw new Error('添加失敗');
        
        showToast(`已添加 ${selectedSongs.size} 首到「${playlistName}」`);
        exitBatchMode();
        await loadPlaylists();
    } catch (error) {
        showToast('添加失敗');
        console.error(error);
    }
}

let pressTimer;
songList.addEventListener('touchstart', (e) => {
    const songItem = e.target.closest('.song-item');
    if (songItem && !batchMode) {
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
    if (songItem && !batchMode) {
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
    
    console.log(`▶️ 播放: ${song.name} (${currentIndex + 1}/${currentSongs.length})`);
    
    audio.src = song.url;
    
    nowPlaying.textContent = song.name;
    updateAlbumArt(song);
    renderSongList();
    updateMediaSession(song);
    
    const playPromise = audio.play();
    
    if (playPromise !== undefined) {
        playPromise
            .then(() => {
                if (!isAudioContextInitialized) {
                    initializeAudioContext();
                }
                
                if (audioContext && audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                
                if (gainNode) {
                    gainNode.gain.value = STANDARD_VOLUME;
                }
                
                isPlaying = true;
                updatePlayButton();
                console.log('✅ 播放成功');
            })
            .catch(err => {
                console.error('❌ 播放失敗:', err);
                showToast('播放失敗，請點擊播放按鈕');
                isPlaying = false;
                updatePlayButton();
            });
    } else {
        isPlaying = true;
        updatePlayButton();
    }
}

function updateMediaSession(song) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name,
            artist: '音巢',
            album: currentPlaylist,
            artwork: song.coverUrl ? [
                { src: song.coverUrl, sizes: '96x96', type: 'image/jpeg' },
                { src: song.coverUrl, sizes: '128x128', type: 'image/jpeg' },
                { src: song.coverUrl, sizes: '192x192', type: 'image/jpeg' },
                { src: song.coverUrl, sizes: '256x256', type: 'image/jpeg' },
                { src: song.coverUrl, sizes: '384x384', type: 'image/jpeg' },
                { src: song.coverUrl, sizes: '512x512', type: 'image/jpeg' }
            ] : [
                { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
            ]
        });
    }
}

function updateAlbumArt(song) {
    if (song.coverUrl) {
        albumArt.innerHTML = `<img src="${song.coverUrl}" alt="專輯封面">`;
    } else {
        albumArt.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="default-cover">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
        `;
    }
}

function togglePlay() {
    if (currentSongs.length === 0) {
        showToast('請先上傳音樂');
        return;
    }
    
    if (!audio.src) {
        if (isShuffle) {
            const randomIndex = getNextShuffleIndex();
            playSong(randomIndex);
        } else {
            playSong(0);
        }
        return;
    }
    
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
    } else {
        if (!isAudioContextInitialized) {
            initializeAudioContext();
        }
        
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        audio.play()
            .then(() => {
                isPlaying = true;
            })
            .catch(err => {
                console.error('播放失敗:', err);
                showToast('播放失敗');
                isPlaying = false;
            });
    }
    updatePlayButton();
}

function updatePlayButton() {
    const playIcon = playBtn.querySelector('.play-icon');
    const pauseIcon = playBtn.querySelector('.pause-icon');
    playIcon.style.display = isPlaying ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
}

function handleSongEnded() {
    console.log('🎵 歌曲播放結束');
    
    if (repeatMode === 1) {
        console.log('🔁 單曲循環');
        audio.currentTime = 0;
        audio.play().catch(err => console.error('播放失敗:', err));
        return;
    }
    
    const hasNext = isShuffle ? 
        (availableIndices.length > 0 || currentSongs.length > 1) : 
        (currentIndex < currentSongs.length - 1 || repeatMode === 2);
    
    if (hasNext || repeatMode === 2) {
        console.log('⏭️ 播放下一首');
        playNext();
    } else {
        console.log('⏹️ 播放完畢');
        isPlaying = false;
        updatePlayButton();
    }
}

function playNext() {
    if (currentSongs.length === 0) return;
    
    let nextIndex;
    
    if (isShuffle) {
        nextIndex = getNextShuffleIndex();
        console.log(`🎲 隨機模式: 下一首索引 ${nextIndex}`);
    } else {
        nextIndex = (currentIndex + 1) % currentSongs.length;
        console.log(`➡️ 順序模式: 下一首索引 ${nextIndex}`);
    }
    
    playSong(nextIndex);
}

function getNextShuffleIndex() {
    if (availableIndices.length === 0) {
        console.log('🔄 隨機池已空，重新填充');
        availableIndices = currentSongs.map((_, i) => i);
        shuffleHistory = [];
        
        if (currentSongs.length > 1) {
            availableIndices = availableIndices.filter(i => i !== currentIndex);
            console.log(`   排除當前歌曲 ${currentIndex}，剩餘 ${availableIndices.length} 首`);
        }
        
        showToast('已播完所有歌曲，重新隨機播放', 2000);
    }
    
    const randomPos = Math.floor(Math.random() * availableIndices.length);
    const selectedIndex = availableIndices[randomPos];
    
    availableIndices.splice(randomPos, 1);
    shuffleHistory.push(selectedIndex);
    
    console.log(`🎲 隨機選擇: ${selectedIndex + 1}/${currentSongs.length}, 剩餘未播: ${availableIndices.length}`);
    
    return selectedIndex;
}

function playPrevious() {
    if (currentSongs.length === 0) return;
    
    let prevIndex;
    
    if (isShuffle) {
        if (shuffleHistory.length > 1) {
            shuffleHistory.pop();
            prevIndex = shuffleHistory[shuffleHistory.length - 1];
            if (!availableIndices.includes(currentIndex)) {
                availableIndices.push(currentIndex);
            }
            console.log(`⏮️ 隨機模式上一首: ${prevIndex}`);
        } else {
            prevIndex = getNextShuffleIndex();
            console.log(`⏮️ 無歷史，隨機選擇: ${prevIndex}`);
        }
    } else {
        prevIndex = (currentIndex - 1 + currentSongs.length) % currentSongs.length;
        console.log(`⏮️ 順序模式上一首: ${prevIndex}`);
    }
    
    playSong(prevIndex);
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
    
    if (isShuffle) {
        resetShuffleState();
        if (currentSongs.length > 0 && audio.src) {
            shuffleHistory = [currentIndex];
            availableIndices = availableIndices.filter(i => i !== currentIndex);
        }
        showToast('隨機播放已開啟 - 不重複播放直到全部播完');
        
        if (repeatMode === 1) {
            repeatMode = 0;
            updateRepeatButton();
        }
    } else {
        showToast('順序播放');
        resetShuffleState();
    }
}

function toggleRepeat() {
    repeatMode = (repeatMode + 1) % 3;
    updateRepeatButton();
    
    const messages = ['循環關閉', '單曲循環', '列表循環'];
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
        showToast(`檔案過大: ${oversizedFiles[0].name} (限制 50MB)`);
        return;
    }

    let successCount = 0;
    let failCount = 0;

    showToast(`上傳中... (0/${fileArray.length})`);

    for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const formData = new FormData();
        formData.append('audio', file);
        
        try {
            showToast(`上傳中... (${i + 1}/${fileArray.length}) - ${file.name}`, 1000);
            
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
        showToast(`成功上傳 ${successCount} 首歌曲`);
    } else if (successCount === 0) {
        showToast(`全部上傳失敗 (${failCount} 首)`);
    } else {
        showToast(`成功 ${successCount} 首,失敗 ${failCount} 首`);
    }
    
    resetShuffleState();
}

async function deleteSong(songId) {
    const isMainList = currentPlaylist === '已上傳歌曲清單';
    const confirmMsg = isMainList 
        ? '這將從雲端永久刪除檔案,確定嗎?' 
        : '確定從此清單移除?(不會刪除檔案)';

    if (!confirm(confirmMsg)) return;
    
    try {
        const res = await fetch('/api/music', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId, playlistName: currentPlaylist })
        });
        
        if (!res.ok) throw new Error('刪除失敗');
        
        showToast(isMainList ? '已徹底刪除雲端檔案' : '已從清單移除');
        
        await loadPlaylists();
        
        if (currentSongs.length > 0 && currentIndex >= currentSongs.length) {
            currentIndex = 0;
        }
        
        resetShuffleState();
    } catch (error) {
        showToast('刪除失敗');
        console.error(error);
    }
}

async function createNewPlaylist() {
    const name = prompt('新清單名稱:');
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
        
        showToast('清單建立成功');
        await loadPlaylists();
    } catch (error) {
        showToast(error.message);
        console.error(error);
    }
}

async function renamePlaylist() {
    const newName = prompt('重新命名清單:', currentPlaylist);
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
        
        showToast('重新命名成功');
        currentPlaylist = newName;
        await loadPlaylists();
    } catch (error) {
        showToast(error.message);
        console.error(error);
    }
}

async function deletePlaylist() {
    if (!confirm(`確定刪除「${currentPlaylist}」清單?(不會刪除音樂檔案)`)) return;
    
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
        
        showToast('清單已刪除');
        currentPlaylist = '已上傳歌曲清單';
        await loadPlaylists();
    } catch (error) {
        showToast(error.message);
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