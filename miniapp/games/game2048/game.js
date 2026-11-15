
// Gachimuchi Sound FX Engine
const gachiAudio = {
  merge: Array.from({ length: 4 }, () => new Audio('../../assets/gachi_audio/spank.mp3')),
  boss: new Audio('../../assets/gachi_audio/boss_of_this_gym.mp3'),
  idx: 0
};
function playMergeSpank() {
  try {
    const a = gachiAudio.merge[gachiAudio.idx % gachiAudio.merge.length];
    gachiAudio.idx++;
    a.currentTime = 0; a.volume = 0.8; a.play().catch(()=>{});
  } catch(_) {}
}
function playBossSound() {
  try { gachiAudio.boss.currentTime = 0; gachiAudio.boss.volume = 1.0; gachiAudio.boss.play().catch(()=>{}); } catch(_) {}
}
(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Gym Master';

  // Ранги качалки по ТЗ
  const GACHI_RANKS = {
    2: 'Slave',
    4: 'Jabroni',
    8: 'Boy Next Door',
    16: 'Leather Boy',
    32: 'Fisting King',
    64: 'Gym Gladiator',
    128: 'Dungeon Master',
    256: 'Master of Gym',
    512: 'Deep Dark',
    1024: 'Billy Legend',
    2048: '👑 BOSS OF THIS GYM',
    4096: '⚡ TITAN OF 300 BUCKS'
  };

  // Звуковой синтезатор Web Audio API
  let soundEnabled = true;
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function playTone(freq, type = 'sine', duration = 0.08, gainVal = 0.2, pitchShift = 0) {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      const now = audioCtx.currentTime;
      osc.frequency.setValueAtTime(freq, now);
      if (pitchShift !== 0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + pitchShift), now + duration);
      }
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch (_) {}
  }

  function soundMove() {
    playTone(280, 'sine', 0.05, 0.15, 60);
  }

  function soundMerge(value) {
    const base = Math.min(800, 320 + Math.log2(value) * 50);
    playTone(base, 'triangle', 0.12, 0.25, 120);
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('medium');
    }
  }

  function soundWin() {
    [400, 500, 600, 800].forEach((freq, idx) => {
      setTimeout(() => playTone(freq, 'triangle', 0.2, 0.3), idx * 100);
    });
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('success');
    }
  }

  function soundGameOver() {
    [350, 300, 240, 180].forEach((freq, idx) => {
      setTimeout(() => playTone(freq, 'sawtooth', 0.25, 0.25, -50), idx * 120);
    });
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('error');
    }
  }

  // Элементы DOM
  const scoreNode = document.getElementById('current-score');
  const bestScoreNode = document.getElementById('best-score');
  const tilesLayer = document.getElementById('tiles-layer');
  const boardContainer = document.getElementById('board-container');
  const gameMsgNode = document.getElementById('game-message');
  const msgTitleNode = document.getElementById('msg-title');
  const msgDescNode = document.getElementById('msg-desc');
  const btnRetry = document.getElementById('btn-retry');
  const btnKeep = document.getElementById('btn-keep');
  const btnRestart = document.getElementById('btn-restart');
  const btnBack = document.getElementById('btn-back');
  const btnSound = document.getElementById('btn-sound');

  // Состояние игры
  const SIZE = 4;
  let grid = []; // 4x4: null или { id, value, row, col, merged }
  let score = 0;
  let bestScore = parseInt(localStorage.getItem('game_2048_best') || '0', 10);
  let over = false;
  let won = false;
  let keepPlaying = false;
  let tileIdCounter = 0;

  bestScoreNode.textContent = bestScore;

  // Инициализация сетки
  function emptyGrid() {
    const arr = [];
    for (let r = 0; r < SIZE; r++) {
      arr[r] = [];
      for (let c = 0; c < SIZE; c++) {
        arr[r][c] = null;
      }
    }
    return arr;
  }

  function getAvailableCells() {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!grid[r][c]) {
          cells.push({ r, c });
        }
      }
    }
    return cells;
  }

  function addRandomTile() {
    const cells = getAvailableCells();
    if (cells.length === 0) return null;
    const spot = cells[Math.floor(Math.random() * cells.length)];
    const val = Math.random() < 0.9 ? 2 : 4;
    const tile = {
      id: ++tileIdCounter,
      value: val,
      row: spot.r,
      col: spot.c,
      isNew: true
    };
    grid[spot.r][spot.c] = tile;
    return tile;
  }

  function restartGame() {
    grid = emptyGrid();
    score = 0;
    over = false;
    won = false;
    keepPlaying = false;
    scoreNode.textContent = '0';
    gameMsgNode.classList.remove('active');
    btnKeep.style.display = 'none';
    addRandomTile();
    addRandomTile();
    renderTiles();
  }

  // Отрисовка плиток
  function renderTiles(addedPoints = 0) {
    tilesLayer.innerHTML = '';
    const layerRect = tilesLayer.getBoundingClientRect();
    const cellSize = (layerRect.width - (SIZE - 1) * 12) / SIZE;
    const gap = 12;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = grid[r][c];
        if (!tile) continue;

        const tileEl = document.createElement('div');
        tileEl.className = `tile tile-${tile.value <= 2048 ? tile.value : 'super'}`;
        if (tile.isNew) {
          tileEl.classList.add('tile-appear');
          delete tile.isNew;
        } else if (tile.merged) {
          tileEl.classList.add('tile-merged');
          delete tile.merged;
        }

        tileEl.style.width = `${cellSize}px`;
        tileEl.style.height = `${cellSize}px`;
        tileEl.style.top = `${r * (cellSize + gap)}px`;
        tileEl.style.left = `${c * (cellSize + gap)}px`;

        const rankName = GACHI_RANKS[tile.value] || (tile.value >= 4096 ? '⚡ TITAN OF 300 BUCKS' : `Rank ${tile.value}`);
        tileEl.innerHTML = `
          <div class="tile-title">${rankName}</div>
          <div class="tile-num">(${tile.value})</div>
        `;

        tilesLayer.appendChild(tileEl);
      }
    }

    if (addedPoints > 0) {
      const floatEl = document.createElement('div');
      floatEl.className = 'score-addition';
      floatEl.textContent = `+${addedPoints}`;
      scoreNode.parentElement.appendChild(floatEl);
      setTimeout(() => floatEl.remove(), 600);
    }
  }

  // Логика перемещения плиток Gabriele Cirulli
  // Направления: 0: вверх, 1: вправо, 2: вниз, 3: влево
  const vectors = {
    0: { x: 0, y: -1 }, // Вверх
    1: { x: 1, y: 0 },  // Вправо
    2: { x: 0, y: 1 },  // Вниз
    3: { x: -1, y: 0 }  // Влево
  };

  function buildTraversals(vector) {
    const traversals = { x: [], y: [] };
    for (let pos = 0; pos < SIZE; pos++) {
      traversals.x.push(pos);
      traversals.y.push(pos);
    }
    if (vector.x === 1) traversals.x.reverse();
    if (vector.y === 1) traversals.y.reverse();
    return traversals;
  }

  function findFarthestPosition(cell, vector) {
    let previous;
    let current = { x: cell.c, y: cell.r };
    do {
      previous = current;
      current = { x: previous.x + vector.x, y: previous.y + vector.y };
    } while (
      current.x >= 0 && current.x < SIZE &&
      current.y >= 0 && current.y < SIZE &&
      !grid[current.y][current.x]
    );

    return {
      farthest: previous,
      next: current
    };
  }

  function move(direction) {
    if (over) return;
    initAudio();

    const vector = vectors[direction];
    const traversals = buildTraversals(vector);
    let moved = false;
    let addedScore = 0;
    let hasMerged = false;

    // Сброс флагов merged
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c]) grid[r][c].merged = false;
      }
    }

    traversals.y.forEach(r => {
      traversals.x.forEach(c => {
        const tile = grid[r][c];
        if (!tile) return;

        const positions = findFarthestPosition({ r, c }, vector);
        const nextTile = (positions.next.y >= 0 && positions.next.y < SIZE && positions.next.x >= 0 && positions.next.x < SIZE)
          ? grid[positions.next.y][positions.next.x]
          : null;

        if (nextTile && nextTile.value === tile.value && !nextTile.merged) {
          // Объединяем плитки
          const mergedValue = tile.value * 2;
          const mergedTile = {
            id: ++tileIdCounter,
            value: mergedValue,
            row: positions.next.y,
            col: positions.next.x,
            merged: true
          };

          grid[r][c] = null;
          grid[positions.next.y][positions.next.x] = mergedTile;

          score += mergedValue;
          addedScore += mergedValue;
          moved = true;
          hasMerged = true;
          soundMerge(mergedValue);

          if (mergedValue === 2048 && !won && !keepPlaying) {
            won = true;
          }
        } else {
          // Просто перемещаем на самую дальнюю свободную позицию
          if (positions.farthest.y !== r || positions.farthest.x !== c) {
            grid[r][c] = null;
            tile.row = positions.farthest.y;
            tile.col = positions.farthest.x;
            grid[positions.farthest.y][positions.farthest.x] = tile;
            moved = true;
          }
        }
      });
    });

    if (moved) {
      if (!hasMerged) {
        soundMove();
      }
      addRandomTile();
      scoreNode.textContent = score;

      if (score > bestScore) {
        bestScore = score;
        bestScoreNode.textContent = bestScore;
        try {
          localStorage.setItem('game_2048_best', bestScore);
        } catch (_) {}
      }

      renderTiles(addedScore);

      if (won && !keepPlaying) {
        handleWin();
      } else if (!movesAvailable()) {
        over = true;
        handleGameOver();
      }
    }
  }

  function movesAvailable() {
    if (getAvailableCells().length > 0) return true;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = grid[r][c];
        if (tile) {
          for (let d = 0; d < 4; d++) {
            const v = vectors[d];
            const nr = r + v.y;
            const nc = c + v.x;
            if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
              const other = grid[nr][nc];
              if (other && other.value === tile.value) return true;
            }
          }
        }
      }
    }
    return false;
  }

  async function submitScoreToServer(finalScore) {
    try {
      const payload = {
        game: 'game_2048',
        game_name: 'game_2048',
        score: finalScore,
        chat_id: chatId,
        user_name: userName
      };
      const headers = { 'Content-Type': 'application/json' };
      if (initData) headers['X-Telegram-Init-Data'] = initData;

      await fetch('/api/game/submit_score', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn('Failed to submit 2048 score:', err);
    }
  }

  function handleWin() {
    soundWin();
    msgTitleNode.textContent = '👑 BOSS OF THIS GYM (2048)!';
    msgDescNode.textContent = `Ты доказал превосходство в Данжене! Счёт: ${score} 💰`;
    btnKeep.style.display = 'inline-block';
    gameMsgNode.classList.add('active');
    submitScoreToServer(score);
  }

  function handleGameOver() {
    soundGameOver();
    msgTitleNode.textContent = '💀 СЛЕЙВ УПАЛ БЕЗ СИЛ!';
    msgDescNode.textContent = `Заработанные Bucks: ${score} 💰`;
    btnKeep.style.display = 'none';
    gameMsgNode.classList.add('active');
    submitScoreToServer(score);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'GAME_OVER', game: 'game_2048', score: score }, '*');
    }
  }

  // Обработка свайпов (Touch Events)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  const MIN_SWIPE_DISTANCE = 30;

  boardContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    e.preventDefault();
  }, { passive: false });

  boardContainer.addEventListener('touchmove', (e) => {
    e.preventDefault();
  }, { passive: false });

  boardContainer.addEventListener('touchend', (e) => {
    if (over && !won) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const dx = touchEndX - touchStartX;
    const dy = touchEndY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) > MIN_SWIPE_DISTANCE) {
      if (absDx > absDy) {
        // Горизонтальный свайп: 1 = вправо, 3 = влево
        move(dx > 0 ? 1 : 3);
      } else {
        // Вертикальный свайп: 0 = вверх, 2 = вниз
        move(dy > 0 ? 2 : 0);
      }
    }
  }, { passive: false });

  // Поддержка стрелок на клавиатуре для отладки и десктопа
  window.addEventListener('keydown', (e) => {
    const keyMap = {
      ArrowUp: 0,
      KeyW: 0,
      ArrowRight: 1,
      KeyD: 1,
      ArrowDown: 2,
      KeyS: 2,
      ArrowLeft: 3,
      KeyA: 3
    };
    if (keyMap[e.code] !== undefined) {
      e.preventDefault();
      move(keyMap[e.code]);
    }
  });

  // Кнопки интерфейса
  btnRetry.addEventListener('click', () => {
    restartGame();
  });

  btnKeep.addEventListener('click', () => {
    keepPlaying = true;
    gameMsgNode.classList.remove('active');
  });

  btnRestart.addEventListener('click', () => {
    if (confirm('Сбросить текущую партию?')) {
      restartGame();
    }
  });

  btnSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    btnSound.textContent = soundEnabled ? '🔊 Звук: Вкл' : '🔇 Звук: Выкл';
  });

  btnBack.addEventListener('click', () => {
    if (score > 0) {
      submitScoreToServer(score);
    }
    const modal = window.parent?.document?.getElementById('game-modal');
    if (modal && typeof modal.close === 'function') {
      modal.close();
    } else {
      window.history.back();
    }
  });

  // Перерисовка при изменении размера окна/ориентации
  window.addEventListener('resize', () => {
    renderTiles();
  });

  // Старт
  restartGame();
})();