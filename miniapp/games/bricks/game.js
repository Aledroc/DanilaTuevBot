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
  const userName = tg?.initDataUnsafe?.user?.first_name || 'Кибер-Игрок';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d', { alpha: false }); // Отключаем прозрачность canvas для ускорения композитинга

  // Виртуальные размеры поля 720 x 1280
  const CW = 720;
  const CH = 1280;

  // Web Audio синтезатор для неоновых ретро-звуков
  let soundEnabled = true;
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.25, pitchDrop = 0) {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      const now = audioCtx.currentTime;
      osc.frequency.setValueAtTime(freq, now);
      if (pitchDrop > 0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq - pitchDrop), now + duration);
      } else if (pitchDrop < 0) {
        osc.frequency.exponentialRampToValueAtTime(freq - pitchDrop, now + duration);
      }

      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (_) {}
  }

  function playSfx(name) {
    if (!soundEnabled) return;
    switch (name) {
      case 'paddle':
        playTone(320, 'triangle', 0.08, 0.3, -80);
        break;
      case 'hit1':
        playTone(520, 'sine', 0.09, 0.3, 100);
        break;
      case 'hit2':
        playTone(740, 'sine', 0.12, 0.35, 150);
        break;
      case 'hit3':
        playTone(1050, 'square', 0.15, 0.25, 300);
        break;
      case 'powerup':
        playTone(400, 'sine', 0.22, 0.35, -500);
        break;
      case 'laser':
        playTone(900, 'sawtooth', 0.12, 0.2, 700);
        break;
      case 'loselife':
        playTone(220, 'sawtooth', 0.35, 0.4, 150);
        break;
      case 'gameover':
        playTone(180, 'sawtooth', 0.7, 0.45, 120);
        break;
      case 'win':
        playTone(600, 'triangle', 0.4, 0.4, -300);
        break;
    }
  }

  // --- Игровое состояние ---
  let gameState = 'START'; // 'START' | 'PLAYING' | 'GAMEOVER' | 'VICTORY'
  let score = 0;
  let lives = 3;
  let combo = 0;
  let maxCombo = 0;
  let level = 1;
  let bestScore = 0;
  try {
    bestScore = parseInt(localStorage.getItem('brick_breaker_best_score') || '0', 10);
  } catch (_) {}

  // Множитель скорости игры (1x, 1.5x, 2x)
  let speedMultiplier = 1.0;

  // Платформа (Paddle) - смещена чуть выше (CH - 180), чтобы сократить дистанцию до кирпичей
  const PADDLE_BASE_WIDTH = 150;
  const PADDLE_HEIGHT = 22;
  const PADDLE_Y = CH - 180;
  let paddle = {
    x: CW / 2,
    y: PADDLE_Y,
    width: PADDLE_BASE_WIDTH,
    height: PADDLE_HEIGHT,
    targetX: CW / 2,
    laserTimer: 0,
    widthTimer: 0,
  };

  // Шарики (динамичная физика: база увеличена с 10.5 до 16.5)
  let balls = [];
  const BALL_RADIUS = 10;
  const BASE_BALL_SPEED = 16.5;

  // Кирпичи (Bricks) - сдвинуты вниз ближе к центру для мгновенного первого удара
  const BRICK_ROWS = 7;
  const BRICK_COLS = 7;
  const BRICK_GAP = 10;
  const BRICK_OFFSET_TOP = 220;
  const BRICK_OFFSET_LEFT = 24;
  const BRICK_WIDTH = Math.floor((CW - BRICK_OFFSET_LEFT * 2 - (BRICK_COLS - 1) * BRICK_GAP) / BRICK_COLS);
  const BRICK_HEIGHT = 32;

  let bricks = [];

  // Бонусы
  let powerUps = [];

  // Лазерные лучи
  let lasers = [];

  // Частицы неонового взрыва (Оптимизированный Particle Pool)
  const MAX_PARTICLES = 160;
  const particlePool = Array.from({ length: MAX_PARTICLES }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 0,
    color: '#00f0ff',
    alpha: 0,
    decay: 0.05,
    active: false,
  }));

  // Всплывающие очки (+100, x3 COMBO)
  let floatingTexts = [];

  // Палитра кирпичей
  const NEON_PALETTES = {
    hp1: { fill: '#142032', stroke: '#00f0ff', glow: '#00f0ff', label: '10KG' },
    hp2: { fill: '#2e1220', stroke: '#ff007f', glow: '#ff007f', label: '25KG' },
    hp3: { fill: '#2e2408', stroke: '#ffd700', glow: '#ffd700', label: '50KG' },
    gold: { fill: '#ffbe0b', stroke: '#fff1a8', glow: '#ffbe0b', label: '300$' },
  };

  // Кэшированные оффскрин-холсты кирпичей для исключения createLinearGradient и shadowBlur в реальном времени
  const brickBitmaps = {};
  function initBrickBitmaps() {
    Object.keys(NEON_PALETTES).forEach(type => {
      brickBitmaps[type] = {};
      [1, 2, 3].forEach(hp => {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = BRICK_WIDTH;
        offCanvas.height = BRICK_HEIGHT;
        const bctx = offCanvas.getContext('2d');
        const pal = NEON_PALETTES[type];

        // Градиент
        const grad = bctx.createLinearGradient(0, 0, 0, BRICK_HEIGHT);
        grad.addColorStop(0, pal.stroke);
        grad.addColorStop(0.2, pal.fill);
        grad.addColorStop(1, '#05070c');
        bctx.fillStyle = grad;

        roundRect(bctx, 1, 1, BRICK_WIDTH - 2, BRICK_HEIGHT - 2, 6);
        bctx.fill();

        // Обводка
        bctx.lineWidth = 2;
        bctx.strokeStyle = pal.stroke;
        bctx.stroke();

        // Надпись
        bctx.fillStyle = '#ffffff';
        bctx.font = '900 12px -apple-system, sans-serif';
        bctx.textAlign = 'center';
        bctx.textBaseline = 'middle';
        const tag = hp > 1 ? `${pal.label} ★${hp}` : pal.label;
        bctx.fillText(tag, BRICK_WIDTH / 2, BRICK_HEIGHT / 2);

        brickBitmaps[type][hp] = offCanvas;
      });
    });
  }
  initBrickBitmaps();

  function createLevel(lvl) {
    bricks = [];
    const rows = Math.min(BRICK_ROWS + Math.floor((lvl - 1) / 2), 9);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        let maxHp = 1;
        if (r < 2) maxHp = 3;
        else if (r < 4) maxHp = 2;
        else maxHp = 1;

        if (lvl > 1 && Math.random() < 0.25) maxHp = Math.min(3, maxHp + 1);

        const x = BRICK_OFFSET_LEFT + c * (BRICK_WIDTH + BRICK_GAP);
        const y = BRICK_OFFSET_TOP + r * (BRICK_HEIGHT + BRICK_GAP);

        bricks.push({
          x,
          y,
          w: BRICK_WIDTH,
          h: BRICK_HEIGHT,
          hp: maxHp,
          maxHp: maxHp,
          active: true,
          colorType: maxHp === 3 ? 'hp3' : maxHp === 2 ? 'hp2' : 'hp1',
        });
      }
    }
  }

  function resetPaddle() {
    paddle.width = PADDLE_BASE_WIDTH;
    paddle.x = CW / 2;
    paddle.targetX = CW / 2;
    paddle.laserTimer = 0;
    paddle.widthTimer = 0;
  }

  // Запуск шарика: гарантированно вертикальный/крутой угол, чтобы мяч сразу долетал до кирпичей
  function spawnBall(isServe = false) {
    const launchAngles = [-Math.PI * 0.44, -Math.PI * 0.48, -Math.PI * 0.52, -Math.PI * 0.56];
    const angle = launchAngles[Math.floor(Math.random() * launchAngles.length)];
    const speed = (BASE_BALL_SPEED + (level - 1) * 0.5) * speedMultiplier;
    return {
      x: paddle.x,
      y: paddle.y - BALL_RADIUS - 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: BALL_RADIUS,
      active: true,
      stuck: isServe,
      trail: [],
    };
  }

  function startGame() {
    initAudio();
    score = 0;
    lives = 3;
    combo = 0;
    maxCombo = 0;
    level = 1;
    powerUps = [];
    lasers = [];
    clearParticles();
    floatingTexts = [];
    resetPaddle();
    createLevel(level);
    balls = [spawnBall(true)];
    gameState = 'PLAYING';
  }

  function nextLevel() {
    level++;
    playSfx('win');
    spawnFloatingText(CW / 2, CH / 2 - 60, `УРОВЕНЬ ${level}!`, '#00f0ff', 44);
    createLevel(level);
    resetPaddle();
    powerUps = [];
    lasers = [];
    balls = [spawnBall(true)];
  }

  function gameOver() {
    gameState = 'GAMEOVER';
    playSfx('gameover');
    if (score > bestScore) {
      bestScore = score;
      try {
        localStorage.setItem('brick_breaker_best_score', bestScore.toString());
      } catch (_) {}
    }
    submitScore(score);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'GAME_OVER', game: 'brick_breaker', score: score }, '*');
    }
  }

  async function submitScore(finalScore) {
    try {
      const payload = {
        game: 'brick_breaker',
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
    } catch (err) {
      console.warn('Failed to submit brick_breaker score:', err);
    }
  }

  // --- Particle Pool реализация (без GC паузы) ---
  function clearParticles() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      particlePool[i].active = false;
    }
  }

  function spawnExplosion(x, y, color, count = 8) {
    let spawned = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!particlePool[i].active) {
        const p = particlePool[i];
        p.active = true;
        p.x = x;
        p.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 8 + 3;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.size = Math.random() * 4 + 3;
        p.color = color;
        p.alpha = 1;
        p.decay = Math.random() * 0.04 + 0.03;
        spawned++;
        if (spawned >= count) break;
      }
    }
  }

  function spawnFloatingText(x, y, text, color = '#fff', size = 26) {
    if (floatingTexts.length >= 8) floatingTexts.shift();
    floatingTexts.push({
      x,
      y,
      text,
      color,
      size,
      alpha: 1,
      vy: -2.2,
    });
  }

  function spawnPowerUp(x, y) {
    if (Math.random() > 0.32) return;
    const types = ['multi', 'wide', 'laser', 'slow'];
    const chosenType = types[Math.floor(Math.random() * types.length)];
    powerUps.push({
      x,
      y,
      vy: 4.5,
      type: chosenType,
      size: 26,
    });
  }

  function applyPowerUp(type) {
    playSfx('powerup');
    if (type === 'multi') {
      spawnFloatingText(paddle.x, paddle.y - 40, '🔥 300 BUCKS MULTIPLIER!', '#ffd700', 28);
      const newBalls = [];
      balls.forEach(b => {
        if (!b.active || b.stuck) return;
        [-0.35, 0.35].forEach(angOffset => {
          const curAng = Math.atan2(b.vy, b.vx);
          const spd = Math.hypot(b.vx, b.vy);
          newBalls.push({
            x: b.x,
            y: b.y,
            vx: Math.cos(curAng + angOffset) * spd,
            vy: Math.sin(curAng + angOffset) * spd,
            radius: BALL_RADIUS,
            active: true,
            stuck: false,
            trail: [],
          });
        });
      });
      balls.push(...newBalls);
    } else if (type === 'wide') {
      spawnFloatingText(paddle.x, paddle.y - 40, '💥 MAXIMUM POWER ГАНТЕЛЬ!', '#00f0ff', 28);
      paddle.width = PADDLE_BASE_WIDTH * 1.5;
      paddle.widthTimer = 600;
    } else if (type === 'laser') {
      spawnFloatingText(paddle.x, paddle.y - 40, '⚡ JABRONI DOWN ЛАЗЕРЫ!', '#ff0055', 28);
      paddle.laserTimer = 450;
    } else if (type === 'slow') {
      spawnFloatingText(paddle.x, paddle.y - 40, '💪 РЕЛАКС В САУНЕ!', '#ffbe0b', 28);
      balls.forEach(b => {
        b.vx *= 0.8;
        b.vy *= 0.8;
      });
    }
  }

  function fireLasers() {
    lasers.push({
      x: paddle.x - paddle.width / 2 + 10,
      y: paddle.y - 10,
      vy: -18,
      w: 4,
      h: 24,
    });
    lasers.push({
      x: paddle.x + paddle.width / 2 - 10,
      y: paddle.y - 10,
      vy: -18,
      w: 4,
      h: 24,
    });
    playSfx('laser');
  }

  let laserCooldown = 0;

  // Функция для предотвращения зависания шарика на горизонтальных углах
  function enforceBallDynamics(b) {
    const speed = Math.hypot(b.vx, b.vy);
    const minSpeed = (BASE_BALL_SPEED + (level - 1) * 0.4) * speedMultiplier;
    const maxSpeed = 26 * speedMultiplier;
    const currentSpeed = Math.min(maxSpeed, Math.max(minSpeed, speed));

    // Минимальная вертикальная составляющая скорости (чтобы мяч не летал только горизонтально)
    const minVy = currentSpeed * 0.35;
    if (Math.abs(b.vy) < minVy) {
      b.vy = (b.vy < 0 ? -1 : 1) * minVy;
    }

    // Нормализация к currentSpeed
    const newSpeed = Math.hypot(b.vx, b.vy);
    b.vx = (b.vx / newSpeed) * currentSpeed;
    b.vy = (b.vy / newSpeed) * currentSpeed;
  }

  // --- Обновление логики игры (Update) ---
  function update() {
    if (gameState !== 'PLAYING') return;

    // Мгновенная и плавная отзывчивость платформы
    paddle.x += (paddle.targetX - paddle.x) * 0.45;
    const halfW = paddle.width / 2;
    if (paddle.x - halfW < 0) paddle.x = halfW;
    if (paddle.x + halfW > CW) paddle.x = CW - halfW;

    // Бонусные таймеры
    if (paddle.widthTimer > 0) {
      paddle.widthTimer--;
      if (paddle.widthTimer <= 0) {
        paddle.width = PADDLE_BASE_WIDTH;
      }
    }

    if (paddle.laserTimer > 0) {
      paddle.laserTimer--;
      laserCooldown++;
      if (laserCooldown >= 16) {
        fireLasers();
        laserCooldown = 0;
      }
    }

    // Обновление лазеров
    for (let i = lasers.length - 1; i >= 0; i--) {
      const l = lasers[i];
      l.y += l.vy;
      let hit = false;
      for (let b of bricks) {
        if (!b.active) continue;
        if (l.x >= b.x && l.x <= b.x + b.w && l.y >= b.y && l.y <= b.y + b.h) {
          hit = true;
          b.hp--;
          spawnExplosion(l.x, l.y, '#ff0055', 6);
          if (b.hp <= 0) {
            b.active = false;
            score += 150;
            spawnPowerUp(b.x + b.w / 2, b.y + b.h / 2);
          }
          break;
        }
      }
      if (hit || l.y < 0) {
        lasers.splice(i, 1);
      }
    }

    // Обновление бонусов
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      p.y += p.vy;

      if (
        p.y + p.size / 2 >= paddle.y - paddle.height / 2 &&
        p.y - p.size / 2 <= paddle.y + paddle.height / 2 &&
        p.x >= paddle.x - paddle.width / 2 &&
        p.x <= paddle.x + paddle.width / 2
      ) {
        applyPowerUp(p.type);
        powerUps.splice(i, 1);
        continue;
      }

      if (p.y > CH + 40) {
        powerUps.splice(i, 1);
      }
    }

    // Обновление шариков
    let activeBallCount = 0;
    for (let b of balls) {
      if (!b.active) continue;

      if (b.stuck) {
        b.x = paddle.x;
        b.y = paddle.y - paddle.height / 2 - b.radius - 2;
        activeBallCount++;
        continue;
      }

      // Оптимизированный след шара
      b.trail.push({ x: b.x, y: b.y, alpha: 0.6 });
      if (b.trail.length > 5) b.trail.shift();

      b.x += b.vx;
      b.y += b.vy;

      // Отскок от стен
      if (b.x - b.radius < 0) {
        b.x = b.radius;
        b.vx = Math.abs(b.vx);
        enforceBallDynamics(b);
        playSfx('paddle');
      } else if (b.x + b.radius > CW) {
        b.x = CW - b.radius;
        b.vx = -Math.abs(b.vx);
        enforceBallDynamics(b);
        playSfx('paddle');
      }

      // Отскок от потолка
      if (b.y - b.radius < 70) {
        b.y = 70 + b.radius;
        b.vy = Math.abs(b.vy);
        enforceBallDynamics(b);
        playSfx('paddle');
      }

      // Отскок от платформы
      const paddleTop = paddle.y - paddle.height / 2;
      const paddleBottom = paddle.y + paddle.height / 2;
      const paddleLeft = paddle.x - paddle.width / 2;
      const paddleRight = paddle.x + paddle.width / 2;

      if (
        b.y + b.radius >= paddleTop &&
        b.y - b.radius <= paddleBottom &&
        b.x >= paddleLeft - b.radius &&
        b.x <= paddleRight + b.radius &&
        b.vy > 0
      ) {
        const hitOffset = (b.x - paddle.x) / (paddle.width / 2);
        const clampedOffset = Math.max(-0.92, Math.min(0.92, hitOffset));
        const maxAngle = Math.PI * 0.38; // Ограничиваем угол, чтобы мяч всегда летел вверх
        const bounceAngle = clampedOffset * maxAngle;
        const currentSpeed = Math.min(26 * speedMultiplier, Math.hypot(b.vx, b.vy) * 1.02);

        b.vx = currentSpeed * Math.sin(bounceAngle);
        b.vy = -currentSpeed * Math.cos(bounceAngle);
        b.y = paddleTop - b.radius;

        enforceBallDynamics(b);

        combo = 0;
        playSfx('paddle');
        spawnExplosion(b.x, paddleTop, '#00f0ff', 6);
      }

      // Столкновение с кирпичами
      for (let brick of bricks) {
        if (!brick.active) continue;

        const nearestX = Math.max(brick.x, Math.min(b.x, brick.x + brick.w));
        const nearestY = Math.max(brick.y, Math.min(b.y, brick.y + brick.h));
        const dx = b.x - nearestX;
        const dy = b.y - nearestY;

        if (dx * dx + dy * dy < b.radius * b.radius) {
          const overlapLeft = (b.x + b.radius) - brick.x;
          const overlapRight = (brick.x + brick.w) - (b.x - b.radius);
          const overlapTop = (b.y + b.radius) - brick.y;
          const overlapBottom = (brick.y + brick.h) - (b.y - b.radius);

          const minOverlapX = Math.min(overlapLeft, overlapRight);
          const minOverlapY = Math.min(overlapTop, overlapBottom);

          if (minOverlapX < minOverlapY) {
            b.vx = -b.vx;
          } else {
            b.vy = -b.vy;
          }

          enforceBallDynamics(b);

          brick.hp--;
          combo++;
          if (combo > maxCombo) maxCombo = combo;

          const comboMultiplier = Math.min(5, 1 + (combo - 1) * 0.5);
          const pointsGained = Math.round(100 * comboMultiplier);
          score += pointsGained;

          const palette = NEON_PALETTES[brick.colorType] || NEON_PALETTES.hp1;
          spawnExplosion(nearestX, nearestY, palette.glow, 8);

          if (combo > 1) {
            const comboText = combo >= 4 ? `💥 MAXIMUM POWER x${combo}!` : combo >= 2 ? `⚡ JABRONI DOWN x${combo}!` : `+${pointsGained}`;
            spawnFloatingText(nearestX, nearestY - 20, `${comboText} (+${pointsGained})`, '#ffd700', 22);
          } else {
            spawnFloatingText(nearestX, nearestY - 20, `+${pointsGained}`, '#ffffff', 20);
          }

          if (brick.hp <= 0) {
            brick.active = false;
            playSfx('hit3');
            spawnPowerUp(brick.x + brick.w / 2, brick.y + brick.h / 2);
          } else {
            playSfx(brick.hp === 2 ? 'hit2' : 'hit1');
          }
          break;
        }
      }

      if (b.y - b.radius > CH) {
        b.active = false;
      } else {
        activeBallCount++;
      }
    }

    // Если все шары упали
    if (activeBallCount === 0) {
      lives--;
      combo = 0;
      playSfx('loselife');
      if (lives <= 0) {
        gameOver();
      } else {
        resetPaddle();
        balls = [spawnBall(true)];
      }
    }

    // Проверка победы
    const remainingBricks = bricks.filter(b => b.active).length;
    if (remainingBricks === 0) {
      nextLevel();
    }

    // Обновление пула частиц
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particlePool[i];
      if (!p.active) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;
      if (p.alpha <= 0) {
        p.active = false;
      }
    }

    // Обновление всплывающего текста
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= 0.025;
      if (ft.alpha <= 0) {
        floatingTexts.splice(i, 1);
      }
    }
  }

  // --- Высокопроизводительный Рендеринг ---
  function render() {
    // Быстрая очистка холста темным фоном
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, CW, CH);

    // Фоновая неоновая сетка (быстрые линии без shadowBlur)
    renderBackgroundGrid();

    // Отрисовка кирпичей из предрассчитанных Bitmap/кэша (0 лагов, 60 FPS)
    for (let b of bricks) {
      if (!b.active) continue;
      const bmp = brickBitmaps[b.colorType]?.[b.hp] || brickBitmaps.hp1[1];
      ctx.drawImage(bmp, b.x, b.y);
    }

    // Отрисовка выпадающих бонусов
    for (let p of powerUps) {
      renderPowerUp(p);
    }

    // Отрисовка лазеров
    for (let l of lasers) {
      renderLaser(l);
    }

    // Отрисовка платформы
    renderPaddle();

    // Отрисовка шаров
    for (let b of balls) {
      if (b.active) renderBall(b);
    }

    // Отрисовка частиц (быстрый batch)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particlePool[i];
      if (!p.active) continue;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Всплывающий текст
    for (let ft of floatingTexts) {
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.textAlign = 'center';
      ctx.font = `900 ${ft.size}px -apple-system, sans-serif`;
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    // Верхняя HUD полоса
    renderHUD();

    // Экраны Start / Game Over
    if (gameState === 'START') {
      renderStartOverlay();
    } else if (gameState === 'GAMEOVER') {
      renderGameOverOverlay();
    }
  }

  function renderBackgroundGrid() {
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.05)';
    ctx.lineWidth = 1;
    const step = 60; // Увеличен шаг сетки для уменьшения числа draw calls
    ctx.beginPath();
    for (let x = 0; x <= CW; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CH);
    }
    for (let y = 0; y <= CH; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(CW, y);
    }
    ctx.stroke();
  }

  function renderPaddle() {
    const px = paddle.x - paddle.width / 2;
    const py = paddle.y - paddle.height / 2;
    const glowColor = paddle.laserTimer > 0 ? '#ff0055' : paddle.widthTimer > 0 ? '#00f0ff' : '#ffd700';

    ctx.fillStyle = '#1e293b';
    roundRect(ctx, px, py, paddle.width, paddle.height, 10);
    ctx.fill();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = glowColor;
    ctx.stroke();

    // Набалдашники гантели
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(px + 8, paddle.y, 7, 0, Math.PI * 2);
    ctx.arc(px + paddle.width - 8, paddle.y, 7, 0, Math.PI * 2);
    ctx.fill();

    // Неоновые пушки лазера
    if (paddle.laserTimer > 0) {
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(px + 4, py - 8, 8, 10);
      ctx.fillRect(px + paddle.width - 12, py - 8, 8, 10);
    }
  }

  function renderBall(b) {
    // Хвост
    for (let t of b.trail) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, b.radius * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${t.alpha * 0.35})`;
      ctx.fill();
    }

    // Сам шар
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  function renderPowerUp(p) {
    let col = '#00f0ff';
    let icon = '⚡';
    if (p.type === 'multi') { col = '#39ff14'; icon = '🟢'; }
    else if (p.type === 'wide') { col = '#00f0ff'; icon = '↔'; }
    else if (p.type === 'laser') { col = '#ff0055'; icon = '⚡'; }
    else if (p.type === 'slow') { col = '#ffbe0b'; icon = '⏱'; }

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#060810';
    ctx.font = '900 14px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, p.x, p.y);
  }

  function renderLaser(l) {
    ctx.fillStyle = '#ff0055';
    ctx.fillRect(l.x - l.w / 2, l.y, l.w, l.h);
  }

  function renderHUD() {
    ctx.fillStyle = 'rgba(5, 7, 12, 0.9)';
    ctx.fillRect(0, 0, CW, 70);

    ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 70);
    ctx.lineTo(CW, 70);
    ctx.stroke();

    // Очки
    ctx.textAlign = 'left';
    ctx.font = '900 22px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`⚡ BUCKS: ${score}`, 24, 44);

    // Уровень качалки
    ctx.textAlign = 'center';
    ctx.font = '800 18px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(`DUNGEON ${level}`, CW / 2, 44);

    // Жизни
    ctx.textAlign = 'right';
    ctx.font = '22px -apple-system, sans-serif';
    ctx.fillStyle = '#ff0055';
    let hearts = '';
    for (let i = 0; i < lives; i++) hearts += '💪 ';
    ctx.fillText(hearts, CW - 24, 44);
  }

  function renderStartOverlay() {
    ctx.fillStyle = 'rgba(5, 7, 12, 0.88)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 48px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('SMASH THE JABRONI', CW / 2, 440);
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('КИБЕР-ДРОБИЛКА', CW / 2, 500);

    ctx.font = '600 20px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillText('Круши титановые блины хромированной гантелью!', CW / 2, 560);
    ctx.fillText('Лови 300 BUCKS бонусы и активируй MAXIMUM POWER!', CW / 2, 595);

    const btnW = 340;
    const btnH = 74;
    const btnX = (CW - btnW) / 2;
    const btnY = 660;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#d4af37');
    grad.addColorStop(0.5, '#ffd700');
    grad.addColorStop(1, '#ff9100');

    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 18);
    ctx.fill();

    ctx.fillStyle = '#05070c';
    ctx.font = '900 24px -apple-system, sans-serif';
    ctx.fillText('НАЧАТЬ ДРОБЛЕНИЕ 💥', CW / 2, btnY + 46);
  }

  function renderGameOverOverlay() {
    ctx.fillStyle = 'rgba(5, 7, 12, 0.92)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.textAlign = 'center';
    ctx.font = '900 50px -apple-system, sans-serif';
    ctx.fillStyle = '#ff0055';
    ctx.fillText('JABRONI DOWN!', CW / 2, 420);

    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillText('ЗАРАБОТАНО BUCKS', CW / 2, 480);

    ctx.font = '900 80px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(score.toString(), CW / 2, 565);

    ctx.font = '700 22px -apple-system, sans-serif';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(`🏆 Рекорд: ${bestScore}`, CW / 2, 625);

    const btnW = 340;
    const btnH = 76;
    const btnX = (CW - btnW) / 2;
    const btnY = 680;

    const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
    grad.addColorStop(0, '#d4af37');
    grad.addColorStop(0.5, '#ffd700');
    grad.addColorStop(1, '#ff9100');

    ctx.fillStyle = grad;
    roundRect(ctx, btnX, btnY, btnW, btnH, 18);
    ctx.fill();

    ctx.fillStyle = '#05070c';
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.fillText('ПОВТОРИТЬ ПОДХОД ↺', CW / 2, btnY + 47);
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

  // --- Высокоскоростное Сенсорное Управление (Pointer Events) ---
  function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CW / rect.width;
    const scaleY = CH / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function handlePointerDown(e) {
    if (e.target && e.target.closest && e.target.closest('.control-btn')) return;
    initAudio();

    if (gameState === 'START' || gameState === 'GAMEOVER') {
      startGame();
      return;
    }

    balls.forEach(b => {
      if (b.stuck) b.stuck = false;
    });

    const pos = getCanvasCoords(e.clientX, e.clientY);
    paddle.targetX = pos.x;
  }

  function handlePointerMove(e) {
    if (gameState !== 'PLAYING') return;
    const pos = getCanvasCoords(e.clientX, e.clientY);
    paddle.targetX = pos.x;
  }

  const container = document.getElementById('game-container');
  // Используем только Pointer Events без конфликтующих touchmove дубликатов
  container.addEventListener('pointerdown', handlePointerDown, { passive: true });
  container.addEventListener('pointermove', handlePointerMove, { passive: true });

  // Кнопки верхней панели
  document.getElementById('btn-back')?.addEventListener('click', () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'CLOSE_GAME' }, '*');
      const closeBtn = window.parent.document.getElementById('close-game-modal');
      if (closeBtn) closeBtn.click();
    }
  });

  const speedBtn = document.getElementById('btn-speed');
  const speedStages = [1.0, 1.35, 1.75];
  let speedIdx = 0;
  speedBtn?.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speedStages.length;
    speedMultiplier = speedStages[speedIdx];
    speedBtn.textContent = `⚡ ${speedMultiplier}x`;
    // Обновляем текущие шары на лету
    balls.forEach(b => {
      enforceBallDynamics(b);
    });
  });

  const muteBtn = document.getElementById('btn-mute');
  muteBtn?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    muteBtn.textContent = soundEnabled ? '🔊 Вкл' : '🔇 Выкл';
  });

  // Главный цикл анимации
  function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
})();
