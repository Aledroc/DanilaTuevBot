
// Gachimuchi Sound FX Engine
const gachiAudio = {
  spank: Array.from({ length: 4 }, () => new Audio('../../assets/gachi_audio/spank.mp3')),
  pass: [new Audio('../../assets/gachi_audio/yes_sir.mp3'), new Audio('../../assets/gachi_audio/ass_we_can.mp3')],
  death: new Audio('../../assets/gachi_audio/aaaaah.mp3'),
  boss: new Audio('../../assets/gachi_audio/boss_of_this_gym.mp3'),
  fisting: new Audio('../../assets/gachi_audio/fisting_300.mp3'),
  idx: 0
};
function playGachiSpank() {
  try {
    const a = gachiAudio.spank[gachiAudio.idx % gachiAudio.spank.length];
    gachiAudio.idx++;
    a.currentTime = 0; a.volume = 0.85; a.play().catch(()=>{});
  } catch(_) {}
}
function playGachiPass() {
  try {
    const a = gachiAudio.pass[Math.floor(Math.random() * gachiAudio.pass.length)];
    a.currentTime = 0; a.volume = 0.9; a.play().catch(()=>{});
  } catch(_) {}
}
function playGachiGoal() {
  try { gachiAudio.boss.currentTime = 0; gachiAudio.boss.volume = 0.9; gachiAudio.boss.play().catch(()=>{}); } catch(_) {}
}
function playGachiMiss() {
  try { gachiAudio.death.currentTime = 0; gachiAudio.death.volume = 0.9; gachiAudio.death.play().catch(()=>{}); } catch(_) {}
}
function playGachiOver() {
  try { gachiAudio.death.currentTime = 0; gachiAudio.death.volume = 0.9; gachiAudio.death.play().catch(()=>{}); } catch(_) {}
}
function playGachiDeath() {
  try { gachiAudio.death.currentTime = 0; gachiAudio.death.volume = 0.9; gachiAudio.death.play().catch(()=>{}); } catch(_) {}
}
(() => {
  const tg = window.parent?.Telegram?.WebApp || window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // Параметры запуска
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id') || tg?.initDataUnsafe?.chat?.id || null;
  const initData = tg?.initData || '';
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Джампер';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Физическое разрешение виртуального экрана (портретный формат)
  const CW = 720;
  const CH = 1280;

  // Неоновые сочные цвета Color Switch
  const COLORS = {
    YELLOW: '#f6e21b',  // Индекс 0: Желтый
    PURPLE: '#8d12d6',  // Индекс 1: Фиолетовый / Пурпурный
    CYAN:   '#16e0e6',  // Индекс 2: Голубой / Бирюзовый
    MAGENTA:'#ff017b',  // Индекс 3: Розовый / Маджента
  };
  const COLOR_KEYS = [COLORS.YELLOW, COLORS.PURPLE, COLORS.CYAN, COLORS.MAGENTA];

  // Звуковой синтезатор через Web Audio API (надежно, без необходимости внешних аудио-файлов)
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

  function playJumpSound() {
    if (!soundEnabled) return;
    initAudio();
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(580, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } catch (_) {}
  }

  function playStarSound() {
    if (!soundEnabled) return;
    initAudio();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1175, now + 0.06);
      osc.frequency.setValueAtTime(1760, now + 0.12);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(now + 0.26);
    } catch (_) {}
  }

  function playSwitchSound() {
    if (!soundEnabled) return;
    initAudio();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(now + 0.16);
    } catch (_) {}
  }

  function playExplosionSound() {
    if (!soundEnabled) return;
    initAudio();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      // Шумовой буфер для сочного взрыва
      const bufferSize = audioCtx.sampleRate * 0.4;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.1));
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(60, now + 0.35);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noise.start();
      noise.stop(now + 0.4);
    } catch (_) {}
  }

  // Состояние игры
  let gameState = 'START'; // 'START' | 'PLAYING' | 'GAMEOVER'
  let score = 0;
  let bestScore = 0;
  try {
    bestScore = parseInt(localStorage.getItem('colorswitch_best_score') || '0', 10);
  } catch (_) {}

  // Камера (вертикальный скролл)
  let cameraY = 0;
  let targetCameraY = 0;

  // Игрок (шарик)
  // Сбалансированная физика: комфортная гравитация и прыжок, достаточный зазор для тайминга
  const player = {
    x: CW / 2,
    y: CH * 0.75,
    radius: 14,
    vy: 0,
    gravity: 0.38,
    jumpForce: -8.8,
    colorIndex: 0,
    color: COLOR_KEYS[0],
    trail: [],
  };

  // Элементы мира: препятствия, переключатели цвета, звёзды
  let obstacles = [];
  let colorSwitchers = [];
  let stars = [];
  let particles = [];
  let scorePopups = [];
  let screenShake = 0;
  let highestObsY = 0;

  function resetGame() {
    player.x = CW / 2;
    player.y = CH * 0.75;
    player.vy = 0;
    player.colorIndex = Math.floor(Math.random() * 4);
    player.color = COLOR_KEYS[player.colorIndex];
    player.trail = [];

    score = 0;
    cameraY = 0;
    targetCameraY = 0;
    screenShake = 0;
    particles = [];
    scorePopups = [];

    obstacles = [];
    colorSwitchers = [];
    stars = [];

    // Стартовая генерация препятствий вверх
    highestObsY = CH * 0.42;
    for (let i = 0; i < 4; i++) {
      spawnObstacleSequence(highestObsY);
      highestObsY -= 480;
    }
  }

  // Типы препятствий
  const OBS_TYPES = ['CIRCLE', 'DOUBLE_CIRCLE', 'SQUARE', 'CROSS', 'COLOR_BARS'];

  function spawnObstacleSequence(y) {
    const typeIndex = Math.floor(Math.random() * OBS_TYPES.length);
    const type = OBS_TYPES[typeIndex];
    // Сбалансированная плавная скорость вращения (чтобы игрок мог спокойно таймить проход)
    const speed = (Math.random() > 0.5 ? 1 : -1) * (0.013 + Math.random() * 0.007);

    if (type === 'CIRCLE') {
      obstacles.push({
        type: 'CIRCLE',
        x: CW / 2,
        y: y,
        radius: 125,
        thickness: 18,
        angle: Math.random() * Math.PI * 2,
        speed: speed,
      });
      stars.push({ x: CW / 2, y: y, size: 20, collected: false, rot: 0 });
    } else if (type === 'DOUBLE_CIRCLE') {
      obstacles.push({
        type: 'CIRCLE',
        x: CW / 2,
        y: y,
        radius: 145,
        thickness: 16,
        angle: Math.random() * Math.PI * 2,
        speed: speed,
      });
      obstacles.push({
        type: 'CIRCLE',
        x: CW / 2,
        y: y,
        radius: 100,
        thickness: 16,
        angle: Math.random() * Math.PI * 2,
        speed: -speed * 1.05,
      });
      stars.push({ x: CW / 2, y: y, size: 20, collected: false, rot: 0 });
    } else if (type === 'SQUARE') {
      obstacles.push({
        type: 'SQUARE',
        x: CW / 2,
        y: y,
        size: 210,
        thickness: 18,
        angle: Math.random() * Math.PI * 2,
        speed: speed * 0.85,
      });
      stars.push({ x: CW / 2, y: y, size: 20, collected: false, rot: 0 });
    } else if (type === 'CROSS') {
      obstacles.push({
        type: 'CROSS',
        x: CW / 2,
        y: y,
        armLength: 100,
        thickness: 18,
        angle: Math.random() * Math.PI * 2,
        speed: speed * 0.9,
      });
      stars.push({ x: CW / 2, y: y - 130, size: 20, collected: false, rot: 0 });
    } else if (type === 'COLOR_BARS') {
      obstacles.push({
        type: 'COLOR_BARS',
        y: y,
        barWidth: 180,
        height: 18,
        offset: Math.random() * CW,
        speed: speed > 0 ? 1.6 : -1.6,
      });
      stars.push({ x: CW / 2, y: y - 80, size: 20, collected: false, rot: 0 });
    }

    // Сфера смены цвета между препятствиями
    colorSwitchers.push({
      x: CW / 2,
      y: y - 240,
      radius: 18,
      collected: false,
      pulse: 0,
    });
  }

  function jump() {
    initAudio();
    if (gameState === 'START') {
      gameState = 'PLAYING';
      player.vy = player.jumpForce;
      playJumpSound();
      return;
    }
    if (gameState === 'GAMEOVER') {
      resetGame();
      gameState = 'PLAYING';
      player.vy = player.jumpForce;
      playJumpSound();
      return;
    }
    if (gameState === 'PLAYING') {
      player.vy = player.jumpForce;
      playJumpSound();
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
      }
    }
  }

  // Создание сочного взрыва частиц при гибели
  function explode(x, y, color) {
    playExplosionSound();
    screenShake = 25;
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('error');
    }

    for (let i = 0; i < 70; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 14;
      const c = Math.random() < 0.6 ? color : COLOR_KEYS[Math.floor(Math.random() * 4)];
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 8,
        color: c,
        life: 1,
        decay: 0.016 + Math.random() * 0.02,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  // Отправка счета на бэкенд
  async function submitScore(finalScore) {
    try {
      const payload = {
        game: 'color_switch',
        game_name: 'color_switch',
        score: finalScore,
        chat_id: chatId,
        user_name: userName,
      };
      const headers = { 'Content-Type': 'application/json' };
      if (initData) headers['X-Telegram-Init-Data'] = initData;

      await fetch('/api/game/submit_score', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn('Failed to submit score:', e);
    }
  }

  function gameOver() {
    gameState = 'GAMEOVER';
    explode(player.x, player.y, player.color);

    if (score > bestScore) {
      bestScore = score;
      try {
        localStorage.setItem('colorswitch_best_score', String(bestScore));
      } catch (_) {}
    }
    submitScore(score);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'GAME_OVER', game: 'colorswitch', score: score }, '*');
    }
  }

  // Нормализация угла в диапазон [0, 2*PI)
  function normAngle(a) {
    let res = a % (Math.PI * 2);
    if (res < 0) res += Math.PI * 2;
    return res;
  }

  // Проверка столкновения точки шарика с цветным сегментом с честным снисходительным буфером
  function checkCollision() {
    const px = player.x;
    const py = player.y;
    // Снисходительный хитбокс (эффективный радиус на 4px меньше визуального, чтобы не наказывать за малейшее касание края)
    const pr = Math.max(8, player.radius - 4);
    const myColor = player.color;

    for (const obs of obstacles) {
      if (obs.type === 'CIRCLE') {
        const dx = px - obs.x;
        const dy = py - obs.y;
        const dist = Math.hypot(dx, dy);
        const innerR = obs.radius - obs.thickness / 2;
        const outerR = obs.radius + obs.thickness / 2;

        // Если шарик пересекает кольцо (с буфером)
        if (dist + pr >= innerR && dist - pr <= outerR) {
          // Точки соприкосновения шарика: центр, а также верх и низ с отступом
          const testYPoints = [py - pr + 2, py + pr - 2, py];
          for (const ty of testYPoints) {
            const tdx = px - obs.x;
            const tdy = ty - obs.y;
            const tdist = Math.hypot(tdx, tdy);
            if (tdist >= innerR && tdist <= outerR) {
              let angle = Math.atan2(tdy, tdx) - obs.angle;
              angle = normAngle(angle);
              const segmentIndex = Math.floor(angle / (Math.PI / 2)) % 4;
              const segColor = COLOR_KEYS[segmentIndex];
              if (segColor !== myColor) {
                return true;
              }
            }
          }
        }
      } else if (obs.type === 'SQUARE') {
        // Отрезки сторон квадрата
        const half = obs.size / 2;
        const corners = [
          { x: -half, y: -half },
          { x: half, y: -half },
          { x: half, y: half },
          { x: -half, y: half },
        ];
        // Поворот вершин
        const cos = Math.cos(obs.angle);
        const sin = Math.sin(obs.angle);
        const rotCorners = corners.map(c => ({
          x: obs.x + c.x * cos - c.y * sin,
          y: obs.y + c.x * sin + c.y * cos,
        }));

        for (let s = 0; s < 4; s++) {
          const segColor = COLOR_KEYS[s];
          if (segColor === myColor) continue; // Наш цвет — безопасен

          const p1 = rotCorners[s];
          const p2 = rotCorners[(s + 1) % 4];

          // Расстояние от точки шарика до отрезка (p1 -> p2)
          const segDist = distToSegment(px, py, p1.x, p1.y, p2.x, p2.y);
          if (segDist <= pr + (obs.thickness / 2) - 4) {
            return true;
          }
        }
      } else if (obs.type === 'CROSS') {
        // 4 цветных луча, исходящих из центра
        for (let arm = 0; arm < 4; arm++) {
          const segColor = COLOR_KEYS[arm];
          if (segColor === myColor) continue;

          const armAngle = obs.angle + arm * (Math.PI / 2);
          const p1 = { x: obs.x, y: obs.y };
          const p2 = {
            x: obs.x + Math.cos(armAngle) * obs.armLength,
            y: obs.y + Math.sin(armAngle) * obs.armLength,
          };

          const segDist = distToSegment(px, py, p1.x, p1.y, p2.x, p2.y);
          if (segDist <= pr + (obs.thickness / 2) - 5) {
            return true;
          }
        }
      } else if (obs.type === 'COLOR_BARS') {
        // Горизонтальные цветные полосы, циклически двигающиеся
        if (py + pr >= obs.y - (obs.height / 2) + 2 && py - pr <= obs.y + (obs.height / 2) - 2) {
          // Определяем, над каким цветным блоком находится x
          let rx = (px - obs.offset) % (obs.barWidth * 4);
          if (rx < 0) rx += obs.barWidth * 4;
          const blockIndex = Math.floor(rx / obs.barWidth) % 4;
          if (COLOR_KEYS[blockIndex] !== myColor) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  // Обновление состояния
  function update() {
    // Вращение препятствий
    for (const obs of obstacles) {
      if (obs.angle !== undefined) {
        obs.angle += obs.speed;
      }
      if (obs.type === 'COLOR_BARS') {
        obs.offset += obs.speed;
      }
    }

    // Анимация звёзд и сфер
    for (const st of stars) {
      st.rot += 0.04;
    }
    for (const cs of colorSwitchers) {
      cs.pulse += 0.05;
    }

    if (gameState === 'PLAYING') {
      player.vy += player.gravity;
      player.y += player.vy;

      // Трейл за шариком
      player.trail.unshift({ x: player.x, y: player.y, color: player.color, alpha: 0.6 });
      if (player.trail.length > 8) player.trail.pop();
      for (const t of player.trail) t.alpha -= 0.06;

      // Скролл камеры: камера следует за игроком вверх, когда он поднимается выше 55% экрана
      const thresholdY = cameraY + CH * 0.55;
      if (player.y < thresholdY) {
        targetCameraY = player.y - CH * 0.55;
      }
      cameraY += (targetCameraY - cameraY) * 0.12;

      // Проверка падения вниз за пределы видимости камеры
      if (player.y - player.radius > cameraY + CH) {
        gameOver();
        return;
      }

      // Сбор звёзд
      for (const st of stars) {
        if (!st.collected && Math.hypot(player.x - st.x, player.y - st.y) < player.radius + st.size) {
          st.collected = true;
          score += 1;
          playStarSound();
          const praiseTexts = ['💪 PERFECT FLEX', '⚡ FISTING IS 300 BUCKS', '🔥 MAXIMUM POWER', '👑 GYM BOSS', '💥 GAINS!'];
          const chosenPraise = praiseTexts[score % praiseTexts.length];
          scorePopups.push({ x: CW / 2, y: st.y - 15, text: `${chosenPraise} (+1)`, life: 1 });
          // Звездные искры
          for (let i = 0; i < 15; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 2 + Math.random() * 6;
            particles.push({
              x: st.x,
              y: st.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              size: 4 + Math.random() * 4,
              color: '#ffffff',
              life: 1,
              decay: 0.03,
              rot: 0,
              vrot: 0,
            });
          }
          if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
          }
        }
      }

      // Сбор сфер переключения цвета
      for (const cs of colorSwitchers) {
        if (!cs.collected && Math.hypot(player.x - cs.x, player.y - cs.y) < player.radius + cs.radius) {
          cs.collected = true;
          playSwitchSound();
          // Выбрать новый цвет, отличный от текущего
          let newIdx;
          do {
            newIdx = Math.floor(Math.random() * 4);
          } while (newIdx === player.colorIndex);
          player.colorIndex = newIdx;
          player.color = COLOR_KEYS[player.colorIndex];

          // Вспышка смены цвета
          for (let i = 0; i < 20; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 2 + Math.random() * 7;
            particles.push({
              x: cs.x,
              y: cs.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              size: 5 + Math.random() * 5,
              color: COLOR_KEYS[i % 4],
              life: 1,
              decay: 0.025,
              rot: 0,
              vrot: 0,
            });
          }
        }
      }

      // Проверка столкновения с чужим цветом
      if (checkCollision()) {
        gameOver();
        return;
      }

      // Генерация новых препятствий по мере подъема
      if (highestObsY > cameraY - 300) {
        spawnObstacleSequence(highestObsY);
        highestObsY -= 480;
      }
    }

    // Тряска экрана
    if (screenShake > 0) screenShake *= 0.88;
    if (screenShake < 0.3) screenShake = 0;

    // Частицы
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // гравитация
      p.rot += p.vrot;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Всплывающий текст очков
    for (let i = scorePopups.length - 1; i >= 0; i--) {
      const sp = scorePopups[i];
      sp.y -= 1.6;
      sp.life -= 0.03;
      if (sp.life <= 0) scorePopups.splice(i, 1);
    }
  }

  // Отрисовка
  function render() {
    ctx.save();
    ctx.clearRect(0, 0, CW, CH);

    // Фоновый градиент и неоновая сетка
    ctx.fillStyle = '#111319';
    ctx.fillRect(0, 0, CW, CH);

    // Смещение экрана при тряске
    if (screenShake > 0) {
      const sx = (Math.random() - 0.5) * screenShake;
      const sy = (Math.random() - 0.5) * screenShake;
      ctx.translate(sx, sy);
    }

    // Мировая трансформация с учётом камеры
    ctx.save();
    ctx.translate(0, -cameraY);

    // Фоновые светящиеся полосы
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    const startGridY = Math.floor(cameraY / 100) * 100;
    for (let gy = startGridY; gy < startGridY + CH + 200; gy += 100) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(CW, gy);
      ctx.stroke();
    }

    // Отрисовка препятствий
    for (const obs of obstacles) {
      // Отсечение невидимых на экране препятствий
      if (obs.y < cameraY - 300 || obs.y > cameraY + CH + 300) continue;

      if (obs.type === 'CIRCLE') {
        renderCircleObstacle(obs);
      } else if (obs.type === 'SQUARE') {
        renderSquareObstacle(obs);
      } else if (obs.type === 'CROSS') {
        renderCrossObstacle(obs);
      } else if (obs.type === 'COLOR_BARS') {
        renderColorBarsObstacle(obs);
      }
    }

    // Отрисовка сфер смены цвета (Color Switch Orb)
    for (const cs of colorSwitchers) {
      if (cs.collected || cs.y < cameraY - 100 || cs.y > cameraY + CH + 100) continue;
      renderColorSwitcher(cs);
    }

    // Отрисовка звёзд с очками
    for (const st of stars) {
      if (st.collected || st.y < cameraY - 100 || st.y > cameraY + CH + 100) continue;
      renderStar(st);
    }

    // Трейл шарика
    for (const t of player.trail) {
      if (t.alpha <= 0) continue;
      ctx.beginPath();
      ctx.arc(t.x, t.y, player.radius * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = t.color;
      ctx.globalAlpha = t.alpha * 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Шарик игрока
    if (gameState !== 'GAMEOVER') {
      ctx.save();
      ctx.shadowColor = player.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
      ctx.fill();

      // Белый внутренний блик для сочности
      ctx.beginPath();
      ctx.arc(player.x - 4, player.y - 4, player.radius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.fill();
      ctx.restore();
    }

    // Частицы
    for (const p of particles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }

    // Всплывающие очки
    for (const sp of scorePopups) {
      ctx.save();
      ctx.font = 'bold 34px sans-serif';
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, sp.life)})`;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 8;
      ctx.textAlign = 'center';
      ctx.fillText(sp.text, sp.x, sp.y);
      ctx.restore();
    }

    ctx.restore(); // Конец мировой трансформации

    // HUD поверх экрана
    renderHUD();

    // Оверлеи
    if (gameState === 'START') {
      renderStartOverlay();
    } else if (gameState === 'GAMEOVER') {
      renderGameOverOverlay();
    }

    ctx.restore();
  }

  // Отрисовка кольца из 4 дуг
  function renderCircleObstacle(obs) {
    ctx.save();
    ctx.lineWidth = obs.thickness;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const segColor = COLOR_KEYS[i];
      const startA = obs.angle + i * (Math.PI / 2);
      const endA = startA + Math.PI / 2;

      ctx.save();
      ctx.strokeStyle = segColor;
      ctx.shadowColor = segColor;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.radius, startA, endA);
      ctx.stroke();

      // Отрисовка силовых "блинов / рукояток" на стыках дуг для стиля кольца силы качалки
      const midA = (startA + endA) / 2;
      const hx = obs.x + Math.cos(midA) * obs.radius;
      const hy = obs.y + Math.sin(midA) * obs.radius;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx, hy, obs.thickness * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
    ctx.restore();
  }

  // Отрисовка вращающегося квадрата
  function renderSquareObstacle(obs) {
    ctx.save();
    ctx.lineWidth = obs.thickness;
    ctx.lineCap = 'round';
    const half = obs.size / 2;
    const corners = [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ];
    const cos = Math.cos(obs.angle);
    const sin = Math.sin(obs.angle);
    const rot = corners.map(c => ({
      x: obs.x + c.x * cos - c.y * sin,
      y: obs.y + c.x * sin + c.y * cos,
    }));

    for (let i = 0; i < 4; i++) {
      const segColor = COLOR_KEYS[i];
      const p1 = rot[i];
      const p2 = rot[(i + 1) % 4];

      ctx.save();
      ctx.strokeStyle = segColor;
      ctx.shadowColor = segColor;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Отрисовка крестовины
  function renderCrossObstacle(obs) {
    ctx.save();
    ctx.lineWidth = obs.thickness;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const segColor = COLOR_KEYS[i];
      const a = obs.angle + i * (Math.PI / 2);
      const px = obs.x + Math.cos(a) * obs.armLength;
      const py = obs.y + Math.sin(a) * obs.armLength;

      ctx.save();
      ctx.strokeStyle = segColor;
      ctx.shadowColor = segColor;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(obs.x, obs.y);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Отрисовка полос
  function renderColorBarsObstacle(obs) {
    ctx.save();
    const bw = obs.barWidth;
    let rx = obs.offset % (bw * 4);
    if (rx > 0) rx -= bw * 4;

    while (rx < CW + bw) {
      for (let i = 0; i < 4; i++) {
        const segColor = COLOR_KEYS[i];
        ctx.fillStyle = segColor;
        ctx.shadowColor = segColor;
        ctx.shadowBlur = 12;
        ctx.fillRect(rx, obs.y - obs.height / 2, bw, obs.height);
        rx += bw;
      }
    }
    ctx.restore();
  }

  // Сфера смены цвета (Color Switch Orb: 4 цветных сектора круга)
  function renderColorSwitcher(cs) {
    ctx.save();
    const r = cs.radius + Math.sin(cs.pulse) * 2;
    for (let i = 0; i < 4; i++) {
      const segColor = COLOR_KEYS[i];
      const startA = i * (Math.PI / 2) + cs.pulse * 0.4;
      const endA = startA + Math.PI / 2;

      ctx.save();
      ctx.fillStyle = segColor;
      ctx.shadowColor = segColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(cs.x, cs.y);
      ctx.arc(cs.x, cs.y, r, startA, endA);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Белая точка в центре
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cs.x, cs.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Звезда с очками
  function renderStar(st) {
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(st.rot);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffe600';
    ctx.shadowBlur = 16;

    // 5-конечная звезда
    ctx.beginPath();
    const spikes = 5;
    const outerR = st.size;
    const innerR = st.size * 0.45;
    let rot = (Math.PI / 2) * 3;
    let step = Math.PI / spikes;

    ctx.moveTo(0, -outerR);
    for (let i = 0; i < spikes; i++) {
      let x = Math.cos(rot) * outerR;
      let y = Math.sin(rot) * outerR;
      ctx.lineTo(x, y);
      rot += step;

      x = Math.cos(rot) * innerR;
      y = Math.sin(rot) * innerR;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(0, -outerR);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // HUD: текущий счёт и рекорд
  function renderHUD() {
    ctx.save();
    ctx.font = '900 64px sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(255, 215, 0, 0.7)';
    ctx.shadowBlur = 12;
    ctx.fillText(`${score}`, 32, 100);

    ctx.font = '800 20px sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = 'rgba(0, 240, 255, 0.6)';
    ctx.shadowBlur = 8;
    ctx.textAlign = 'right';
    ctx.fillText(`🏆 РЕКОРД GYM: ${bestScore}`, CW - 32, 85);
    ctx.restore();
  }

  // Оверлей старта
  function renderStartOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 16, 0.88)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 48px sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 22;
    ctx.fillText('RAINBOW DUNGEON', CW / 2, CH * 0.35);

    ctx.font = '800 24px sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.fillText('ЦВЕТНОЙ ФЛЕКС КАЧАЛКИ', CW / 2, CH * 0.40);

    ctx.shadowBlur = 0;
    ctx.font = '600 20px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('Входи в ритм и проходи сквозь кольца силы!', CW / 2, CH * 0.47);
    ctx.fillText('Касайся только своего цвета • Perfect Flex', CW / 2, CH * 0.51);

    // Мигающая кнопка тапа
    const pulseAlpha = 0.7 + Math.sin(Date.now() * 0.007) * 0.3;
    ctx.font = '900 26px sans-serif';
    ctx.fillStyle = `rgba(255, 215, 0, ${pulseAlpha})`;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 14;
    ctx.fillText('ТАПНИ, ЧТОБЫ ВОЙТИ В РИТМ 💪', CW / 2, CH * 0.62);

    ctx.restore();
  }

  // Оверлей конца игры
  function renderGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 16, 0.92)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 46px sans-serif';
    ctx.fillStyle = '#ff0055';
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 22;
    ctx.fillText('💀 СБИЛСЯ С РИТМА!', CW / 2, CH * 0.34);

    ctx.shadowBlur = 0;
    ctx.font = '700 20px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillText('ИТОГОВЫЙ СИЛОВОЙ СЧЁТ', CW / 2, CH * 0.41);

    ctx.font = '900 76px sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 16;
    ctx.fillText(`${score}`, CW / 2, CH * 0.48);

    ctx.shadowBlur = 0;
    if (score >= bestScore && score > 0) {
      ctx.font = '800 22px sans-serif';
      ctx.fillStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 12;
      ctx.fillText('★ НОВЫЙ РЕКОРД DUNGEON GYM! ★', CW / 2, CH * 0.54);
      ctx.shadowBlur = 0;
    } else {
      ctx.font = '600 20px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(`Лучший рекорд зала: ${bestScore}`, CW / 2, CH * 0.54);
    }

    // Кнопка рестарта
    const grad = ctx.createLinearGradient(CW / 2 - 160, 0, CW / 2 + 160, 0);
    grad.addColorStop(0, '#d4af37');
    grad.addColorStop(0.5, '#ffd700');
    grad.addColorStop(1, '#ff9100');
    ctx.fillStyle = grad;
    roundRect(ctx, CW / 2 - 160, CH * 0.62, 320, 68, 18);
    ctx.fill();

    ctx.font = '900 24px sans-serif';
    ctx.fillStyle = '#080a10';
    ctx.fillText('НАЧАТЬ ПОДХОД ЗАНОВО ↺', CW / 2, CH * 0.62 + 42);

    ctx.restore();
  }

  function roundRect(context, x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + w - r, y);
    context.quadraticCurveTo(x + w, y, x + w, y + r);
    context.lineTo(x + w, y + h - r);
    context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    context.lineTo(x + r, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  // Главный цикл
  function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  // Обработка тапа
  const container = document.getElementById('game-container');
  function handleTap(e) {
    if (e.target.closest('.control-btn')) return;
    e.preventDefault();
    jump();
  }

  container.addEventListener('touchstart', handleTap, { passive: false });
  container.addEventListener('pointerdown', handleTap);

  // Кнопки панели
  document.getElementById('btn-back')?.addEventListener('click', () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'CLOSE_GAME' }, '*');
      const closeBtn = window.parent.document.getElementById('close-game-modal');
      if (closeBtn) closeBtn.click();
    }
  });

  const muteBtn = document.getElementById('btn-mute');
  muteBtn?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    muteBtn.textContent = soundEnabled ? '🔊 Звук: Вкл' : '🔇 Звук: Выкл';
  });

  // Запуск игры
  resetGame();
  requestAnimationFrame(gameLoop);
})();
