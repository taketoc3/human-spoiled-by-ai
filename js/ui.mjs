// ai-minesweeper UI v2 — レトロピクセル演出
// preview() → 思考ウェイト → 疑似カーソル → step() commit の1手ずつ駆動
// on-the-loop / in-the-loop モード、業務指示書（ワークオーダー）、タスクランナー搭載
// 2領域: ゲームアプリ（Minesweeperウィンドウ） / エージェントコンソール（外から制御する側）

import { createAgent } from './agent.mjs';
import { t, getLocale } from './i18n.mjs';
import { setupI18n, wireLangToggles } from './i18n-dom.mjs';

// --- 難易度プリセット ---
const DIFFICULTIES = {
  beginner:     { rows: 9,   cols: 9,   mineCount: 10 },
  intermediate: { rows: 16,  cols: 16,  mineCount: 40 },
  expert:       { rows: 16,  cols: 30,  mineCount: 99 },
  huge:         { rows: 50,  cols: 50,  mineCount: 500 },
  mega:         { rows: 100, cols: 100, mineCount: 2000 },
};

/** 難易度ラベル生成（マス数・地雷数入り） */
function diffLabel(key) {
  const d = DIFFICULTIES[key];
  const name = key.charAt(0).toUpperCase() + key.slice(1);
  const cells = d.rows * d.cols;
  return t('diff.label', { name, rows: d.rows, cols: d.cols, cells, mines: d.mineCount });
}

// --- セルサイズ定数 ---
const CELL_MAX = 24;
const CELL_MIN = 12; // 数字が常に判読できる最小サイズ
const BOARD_MAX_PX = 860;

// --- 爆発余韻定数 ---
const BOOM_HOLD_MS = 1100;
// --- クリア余韻定数 ---
const CLEAR_HOLD_MS = 1400;

// 速度・判断速度スライダー（細かい調整UI）の表示。
// 既定は非表示でユーザー調整をなくす。true にすればいつでも復活できる。
// （高速モード・PAUSE・業務を変更ボタンはバーに残す）
const SHOW_SPEED_CONTROLS = false;

// --- 状態 ---
let agent = null;
let difficulty = 'intermediate';
let moveSpeed = 100;   // 速度: カーソル移動・クリック・ステップ間隔の体感ペース
let thinkDelay = 1000; // 判断速度: 賭け時の迷いカーソル演出の総時間（0で即決）
let playing = false;
let animating = false;
// 盤面リセット/業務変更ごとに増える世代カウンタ。実行中の executeAnimatedStep を中断するために使う
let stepGeneration = 0;
let currentCellSize = CELL_MAX;
let fastMode = false;
let autoScroll = true; // カーソル追随オートスクロール
let loopMode = 'on'; // 'on' = on-the-loop, 'in' = in-the-loop
let awaitingHumanGamble = false; // in-the-loop: 人間の賭けを待っている
// 一時停止ゲート（実行中ステップのアニメを即座にサスペンドする）
let paused = false;
let resumeWaiters = [];
function pauseGate() { return paused ? new Promise(r => resumeWaiters.push(r)) : Promise.resolve(); }
function resumeAll() { const w = resumeWaiters; resumeWaiters = []; for (const r of w) r(); }

// グリッド再構築スキップ用
let prevBoardRows = 0;
let prevBoardCols = 0;

// --- タスクランナー ---
let workOrder = null;  // { tasks: [{difficulty, quota:1}], loopMode }
let taskIndex = 0;
let clearsDone = 0;
// per-task 統計: タスク開始時の基準値を記録し差分で算出
let taskBaseline = { attempts: 0, aiJudgments: 0, startTime: 0 };
// 完了タスクの確定統計
let taskResults = [];  // [{ attempts, aiJudgments, elapsedMs }]
// 証跡用: セッション全体のログ [{ type, time, text }]
let sessionLog = [];
// 累積統計（work-order レベル）。showReview で表示する項目のみ保持する。
let runnerStats = {
  totalFailures: 0,
  totalGambles: 0,
  startTime: 0,
  elapsedMs: 0,
};

// --- DOM 要素 ---
const $ = (id) => document.getElementById(id);

// 面ヘッダ（ゲームアプリ内）
const ledMines       = $('ledMines');
const ledGameTime    = $('ledGameTime');
const faceBtn        = $('faceBtn');

// エージェント集計帯

// 盤面
const boardGrid      = $('boardGrid');
const boardWrapper   = $('boardWrapper');
const fakeCursor     = $('fakeCursor');
const heatmapCanvas  = $('heatmapCanvas');

// メッセージ
const msgEntries     = $('msgEntries');
const msgBody        = $('msgBody');

// コントロール
const moveSlider     = $('moveSlider');
const moveSliderVal  = $('moveSliderVal');
const thinkSlider    = $('thinkSlider');
const thinkSliderVal = $('thinkSliderVal');
const playPauseBtn   = $('playPauseBtn');
const fastModeCheck  = $('fastModeCheck');
const autoScrollCheck = $('autoScrollCheck');
const speedControlGroup = $('speedControlGroup');
const thinkControlGroup = $('thinkControlGroup');

// 速度/判断速度スライダーのみ非表示（既定）。高速モード・PAUSE・業務を変更は残す。
if (!SHOW_SPEED_CONTROLS) {
  if (speedControlGroup) speedControlGroup.style.display = 'none';
  if (thinkControlGroup) thinkControlGroup.style.display = 'none';
}

// ワークオーダー
const workOrderOverlay = $('workOrderOverlay');
const woTaskRows       = $('woTaskRows');
const woStartBtn       = $('woStartBtn');
const woChangeBtn      = $('woChangeBtn');
const woCancelBtn      = $('woCancelBtn');

// クリアオーバーレイ
const clearOverlay     = $('clearOverlay');
const clearSummaryText = $('clearSummaryText');
const replayBtn        = $('replayBtn');

// 業務レビュー
const reviewOverlay     = $('reviewOverlay');
const reviewBody        = $('reviewBody');
const reviewNewBtn      = $('reviewNewBtn');
const reviewRetryBtn    = $('reviewRetryBtn');

// アバターストリップ
const avatarEmoji      = $('avatarEmoji');
const avatarAttempts   = $('avatarAttempts');
const avatarJudgments  = $('avatarJudgments');
const avatarTime       = $('avatarTime');
const loopToggleBtns   = [...document.querySelectorAll('.loop-toggle')];
const loopToggleBtnBar = $('loopToggleBtnBar'); // 操作バーの「AIに判断を任せる」トグル（retro-btn）

// タスクリスト
const taskListPanel  = $('taskListPanel');
const taskListItems  = $('taskListItems');

// ヒートマップ凡例
const heatmapLegend = $('heatmapLegend');

// --- ワークオーダー: 難易度セレクタのみのタスク行を動的生成 ---
function buildWoTaskRows() {
  const diffKeys = Object.keys(DIFFICULTIES);
  woTaskRows.innerHTML = '';

  // 既定で3タスクをプリセット（難易度の階段: Beginner → Intermediate → Expert）。
  // 各行は変更可。'---' を選べばその行は無効（タスクなし）にできる。
  const defaults = ['beginner', 'intermediate', 'expert'];

  for (let i = 0; i < defaults.length; i++) {
    const row = document.createElement('div');
    row.className = 'wo-task-row';

    const num = document.createElement('span');
    num.className = 'wo-num';
    num.textContent = (i + 1) + '.';

    const sel = document.createElement('select');
    sel.className = 'retro-select wo-diff';

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = t('diff.none');
    sel.appendChild(emptyOpt);

    for (const key of diffKeys) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = diffLabel(key);
      if (key === defaults[i]) opt.selected = true;
      sel.appendChild(opt);
    }

    row.appendChild(num);
    row.appendChild(sel);
    woTaskRows.appendChild(row);
  }
}

// --- セルサイズ計算 ---
function calcCellSize(rows, cols) {
  const maxDim = Math.max(rows, cols);
  const raw = Math.floor(BOARD_MAX_PX / maxDim);
  return Math.max(CELL_MIN, Math.min(CELL_MAX, raw));
}

// --- HH:MM:SS 整形 ---
function formatHMS(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// --- 顔アイコン ---
function setFace(state) {
  const faces = { normal: '\u{1F642}', thinking: '\u{1F62E}', boom: '\u{1F635}', clear: '\u{1F60E}' };
  faceBtn.textContent = faces[state] || faces.normal;
}

// --- アバター状態管理 ---
// 'active' = 😐, 'thinking' = 🤔, 'sleeping' = 😴
function setAvatar(state) {
  // in-the-loop は判断を人間に委ねるため、エージェントは常に睡眠（活性/思考にしない）
  if (loopMode === 'in') state = 'sleeping';
  const emojis = { active: '\u{1F610}', thinking: '\u{1F914}', sleeping: '\u{1F634}' };
  avatarEmoji.textContent = emojis[state] || emojis.active;
  avatarEmoji.classList.remove('thinking', 'sleeping');
  if (state === 'thinking') avatarEmoji.classList.add('thinking');
  if (state === 'sleeping') avatarEmoji.classList.add('sleeping');
}

// --- ループモード切替（ライブ） ---
function switchLoopMode(newMode) {
  if (newMode === loopMode) return;
  loopMode = newMode;

  // agent の gambleMode を同期
  if (agent) agent.setGambleMode(loopMode === 'in' ? 'human' : 'auto');

  // トグルボタン表示更新
  updateLoopToggleUI();

  // アバター更新
  setAvatar(loopMode === 'in' ? 'sleeping' : 'active');

  // ヒートマップ凡例: in-the-loop では非表示
  if (heatmapLegend) {
    heatmapLegend.style.display = ''; // 両モードでヒートマップ凡例を表示
  }

  // エッジ処理
  if (loopMode === 'on' && awaitingHumanGamble) {
    // in→on 切替: 人間待ちを解除し AI 自動賭けに戻す
    awaitingHumanGamble = false;
    clearFrontierHighlight();
    clearGambleOverlay();
    setFace('normal');
    addMsg('system', t('mode.on'));
    startLoop();
  } else if (loopMode === 'in') {
    // on→in 切替: 次の gamble で自然に await-human になる
    addMsg('system', t('mode.in'));
  }
}

function updateLoopToggleUI() {
  for (const btn of loopToggleBtns) {
    if (loopMode === 'on') {
      btn.textContent = 'on-the-loop';
      btn.classList.remove('mode-in');
      btn.classList.add('mode-on');
    } else {
      btn.textContent = 'in-the-loop';
      btn.classList.remove('mode-on');
      btn.classList.add('mode-in');
    }
  }
  // 操作バーの「AIに判断を任せる」トグル: on-the-loop のとき押し込み(active)
  if (loopToggleBtnBar) {
    loopToggleBtnBar.classList.toggle('active', loopMode === 'on');
  }
}

function updateAvatar() {
  if (!agent) return;
  const stats = agent.getStats();
  avatarAttempts.textContent = Math.max(0, stats.attempts - 1);
  avatarJudgments.textContent = agent.getAiJudgments();
  avatarTime.textContent = formatHMS(stats.elapsedMs);
}

// --- タスクリスト管理 ---
/** 難易度の盤面サイズ表記（タスクリスト用） */
function diffShortName(key) {
  const d = DIFFICULTIES[key];
  return d ? `${d.rows}×${d.cols}` : key;
}

/** タスクリストパネルを構築・表示 */
function buildTaskList() {
  if (!workOrder || !taskListPanel) return;
  taskListItems.innerHTML = '';
  for (let i = 0; i < workOrder.tasks.length; i++) {
    const item = document.createElement('span');
    item.className = 'task-list-item';
    item.dataset.taskIdx = i;
    const icon = i < taskIndex ? '✓' : (i === taskIndex ? '▶' : '·');
    const state = i < taskIndex ? 'done' : (i === taskIndex ? 'active' : 'pending');
    item.classList.add('task-' + state);
    item.textContent = icon + ' ' + diffShortName(workOrder.tasks[i].difficulty);
    taskListItems.appendChild(item);
  }
  taskListPanel.style.display = '';
}

/** m:ss 形式の時間表示 */
function formatMSS(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/** タスクリストの状態アイコン＋per-task統計を更新 */
function updateTaskList() {
  if (!workOrder || !taskListPanel) return;
  const items = taskListItems.querySelectorAll('.task-list-item');
  items.forEach(item => {
    const idx = parseInt(item.dataset.taskIdx, 10);
    item.classList.remove('task-done', 'task-active', 'task-pending');
    const name = diffShortName(workOrder.tasks[idx].difficulty);

    if (idx < taskIndex && taskResults[idx]) {
      // 完了タスク: 確定統計
      const r = taskResults[idx];
      item.classList.add('task-done');
      item.textContent = t('task.itemDone', { name, attempts: r.attempts, judgments: r.aiJudgments, time: formatMSS(r.elapsedMs) });
    } else if (idx === taskIndex && agent) {
      // 進行中: リアルタイム差分
      const nowStats = agent.getStats();
      const att = nowStats.attempts - taskBaseline.attempts;
      const aj = agent.getAiJudgments() - taskBaseline.aiJudgments;
      const elapsed = Date.now() - taskBaseline.startTime;
      item.classList.add('task-active');
      item.textContent = t('task.itemActive', { name, attempts: att, judgments: aj, time: formatMSS(elapsed) });
    } else {
      // 待機
      item.classList.add('task-pending');
      item.textContent = '· ' + name;
    }
  });
}

// --- 初期化（単一盤面） ---
function initBoard() {
  // 世代を進めて、実行中の旧アニメーションステップを中断させる（業務変更・リセット時の盤面破壊を防ぐ）
  stepGeneration++;
  const preset = DIFFICULTIES[difficulty];
  agent = createAgent({ rows: preset.rows, cols: preset.cols, mineCount: preset.mineCount });

  // loopMode に応じて gambleMode 設定
  agent.setGambleMode(loopMode === 'in' ? 'human' : 'auto');

  msgEntries.innerHTML = '';
  clearOverlay.style.display = 'none';
  awaitingHumanGamble = false;
  animating = false;
  // 進行中のクリア/爆発余韻の残骸を除去する。
  // 余韻中（clearEffect/boomEffect の hold 中）に再試行・業務変更で盤面を作り直すと、
  // 緑フラッシュや CLEAR バナーが新しい盤面に最大ホールド時間ぶん残ってしまうのを防ぐ。
  boardGrid.classList.remove('clear-flash', 'boom-flash');
  if (boardWrapper) {
    const staleBanner = boardWrapper.querySelector('.clear-banner');
    if (staleBanner) staleBanner.remove();
  }
  clearGambleOverlay(); // ヒートマップを消す（盤面リセット時）
  buildBoard();
  setFace('normal');
  setAvatar(loopMode === 'in' ? 'sleeping' : 'active');
  updateLoopToggleUI();
  updateDisplay();
  updateAvatar();
}

// --- ワークオーダー開始 ---
function startWorkOrder(order) {
  workOrder = order;
  loopMode = order.loopMode;
  taskIndex = 0;
  clearsDone = 0;
  sessionLog = []; // 証跡ログを新しい業務でリセット
  runnerStats = {
    totalFailures: 0,
    totalGambles: 0,
    startTime: Date.now(),
    elapsedMs: 0,
  };

  // 凡例: in-the-loop では非表示
  if (heatmapLegend) {
    heatmapLegend.style.display = ''; // 両モードでヒートマップ凡例を表示
  }

  // トグルボタン同期
  updateLoopToggleUI();

  taskResults = [];
  workOrderOverlay.style.display = 'none';
  if (woCancelBtn) woCancelBtn.style.display = 'none';
  // 先に startCurrentTask で taskBaseline.startTime を設定してから描画する
  // （順序が逆だと初回のタスクリスト時刻が Date.now()-0 の異常値になる）
  startCurrentTask();
  buildTaskList();
}

function startCurrentTask() {
  if (!workOrder || taskIndex >= workOrder.tasks.length) {
    showReview();
    return;
  }

  const task = workOrder.tasks[taskIndex];
  difficulty = task.difficulty;
  clearsDone = 0;
  initBoard();
  // per-task 基準値を記録
  const stats = agent.getStats();
  taskBaseline = {
    attempts: stats.attempts,
    aiJudgments: agent.getAiJudgments(),
    startTime: Date.now(),
  };
  const d = DIFFICULTIES[difficulty];
  const dname = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  addMsg('system', t('task.start', { idx: taskIndex + 1, total: workOrder.tasks.length, name: dname, rows: d.rows, cols: d.cols, mines: d.mineCount }));
  if (loopMode === 'in') addMsg('system', t('mode.in'));
  startLoop();
}

// --- 盤面構築 ---
function buildBoard() {
  const state = agent.getState();
  const { rows, cols } = state;
  const totalCells = rows * cols;

  currentCellSize = calcCellSize(rows, cols);
  const cs = currentCellSize + 'px';

  boardGrid.style.setProperty('--cell-size', cs);
  boardGrid.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;

  if (rows !== prevBoardRows || cols !== prevBoardCols) {
    boardGrid.innerHTML = '';
    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell unrevealed';
      cell.dataset.idx = i;
      boardGrid.appendChild(cell);
    }
    prevBoardRows = rows;
    prevBoardCols = cols;
  } else {
    const cells = boardGrid.children;
    for (let i = 0; i < totalCells; i++) {
      const cell = cells[i];
      cell.className = 'cell unrevealed';
      cell.textContent = '';
      const overlay = cell.querySelector('.heatmap-overlay');
      if (overlay) overlay.remove();
    }
  }
}

// --- セル単体 DOM 更新 ---
function revealCellDOM(idx) {
  const state = agent.getState();
  const cell = boardGrid.children[idx];
  if (!cell) return;

  cell.className = 'cell revealed';
  cell.textContent = '';

  if (state.value[idx] > 0) {
    cell.classList.add('n' + state.value[idx]);
    cell.textContent = state.value[idx];
  }
}

function flagCellDOM(idx) {
  const cell = boardGrid.children[idx];
  if (!cell) return;

  cell.className = 'cell flagged';
  cell.textContent = '▶';
}

// event の revealGroups を即時に全開放する（演出なし）。
// revealGroups が無い場合は fallbackField（'indices' | 'revealed'）の index 配列を開く。
function applyRevealGroupsImmediate(event, fallbackField) {
  if (event.revealGroups) {
    for (const group of event.revealGroups) {
      for (const idx of group.opened) revealCellDOM(idx);
    }
  } else if (event[fallbackField]) {
    for (const idx of event[fallbackField]) revealCellDOM(idx);
  }
}

// --- 盤面描画（全セル一括） ---
function renderBoard() {
  const state = agent.getState();
  if (!state.revealed) return;
  const { rows, cols, revealed, value, flagged } = state;
  const cells = boardGrid.children;
  const phase = agent.getPhase();
  const trueBoard = (phase === 'boom' || phase === 'idle') ? agent.getTrueBoard() : null;

  for (let i = 0; i < rows * cols; i++) {
    const cell = cells[i];
    if (!cell) continue;

    cell.className = 'cell';
    cell.textContent = '';

    if (flagged[i]) {
      cell.classList.add('flagged');
      cell.textContent = '▶';
    } else if (revealed[i]) {
      cell.classList.add('revealed');
      if (value[i] > 0) {
        cell.classList.add('n' + value[i]);
        cell.textContent = value[i];
      }
    } else {
      cell.classList.add('unrevealed');
      if (trueBoard && trueBoard.mines.has(i)) {
        cell.classList.remove('unrevealed');
        cell.classList.add('mine');
        cell.textContent = '\u{1F4A3}'; // 💣 埋まっている地雷は爆弾アイコン
      }
    }
  }
}

// --- 表示更新 ---
function updateDisplay() {
  const preset = DIFFICULTIES[difficulty];

  // 面ヘッダ: 残り地雷数 — 内部状態ではなく「画面に表示されている旗の数」に同期する
  // （高速/並列アニメ中に内部が先行してカウンタだけ進むのを防ぐ）
  const padLen = preset.mineCount >= 1000 ? 4 : 3;
  const displayedFlags = boardGrid.querySelectorAll('.cell.flagged').length;
  ledMines.textContent = String(preset.mineCount - displayedFlags).padStart(padLen, '0');

  // 面ヘッダ: ゲーム内タイマー（この試行の経過秒、3桁）
  const gameElapsedSec = Math.floor(agent.getGameElapsedMs() / 1000);
  ledGameTime.textContent = String(Math.min(gameElapsedSec, 999)).padStart(3, '0');

  // タスクリスト更新
  updateTaskList();

  // アバターストリップ（AI AGENT 行）更新
  updateAvatar();
}

// --- メッセージ追加 ---
function addMsg(type, text) {
  const entry = document.createElement('div');
  entry.className = 'msg-entry ' + type;

  const time = document.createElement('span');
  time.className = 'msg-time';
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 8);
  time.textContent = timeStr;

  entry.appendChild(time);
  entry.appendChild(document.createTextNode(text));

  // 証跡用にセッション全体のログを蓄積（ライブ表示は盤面ごとにクリアされるため別保持）
  sessionLog.push({ type, time: timeStr, text });
  if (sessionLog.length > 2000) sessionLog.shift();

  const prev = msgEntries.querySelector('.latest');
  if (prev) prev.classList.remove('latest');
  entry.classList.add('latest');

  msgEntries.appendChild(entry);
  msgBody.scrollTop = msgBody.scrollHeight;

  while (msgEntries.children.length > 300) {
    msgEntries.removeChild(msgEntries.firstChild);
  }
}

// 地雷確率 p (0..1) に対応するヒートマップ背景色（安全=緑寄り / 危険=赤寄り）
function heatColor(p) {
  const r = Math.round(p * 255);
  const g = Math.round((1 - p) * 200);
  return `rgba(${r}, ${g}, 40, 0.5)`;
}

// --- 確率ヒートマップ（判断時のみ表示。盤面に重ねる単一 canvas レイヤー） ---
// セル個別の DOM オーバーレイをやめ、1枚の canvas にまとめて描く。
// renderBoard（セル要素の操作）と干渉しないため、判断が連続しても「全消去→全再生成」の
// 点滅が起きない。大盤面でも DOM を増やさず描画コストが軽い。
function showGambleOverlay() {
  if (!heatmapCanvas || !boardGrid) return;
  const probs = agent.getProbabilities();
  const state = agent.getState();
  if (!probs || !state.revealed) return;
  const { rows, cols, revealed, flagged } = state;
  const cs = currentCellSize;

  // canvas を board-grid の offset ボックス（境界線込み）にぴったり重ねる
  const w = boardGrid.offsetWidth;
  const h = boardGrid.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  heatmapCanvas.style.left = boardGrid.offsetLeft + 'px';
  heatmapCanvas.style.top = boardGrid.offsetTop + 'px';
  heatmapCanvas.style.width = w + 'px';
  heatmapCanvas.style.height = h + 'px';
  heatmapCanvas.width = Math.max(1, Math.round(w * dpr));
  heatmapCanvas.height = Math.max(1, Math.round(h * dpr));

  const ctx = heatmapCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const ox = boardGrid.clientLeft; // grid の境界線幅（= セル原点オフセット）
  const oy = boardGrid.clientTop;
  const showText = cs >= 16;
  if (showText) {
    const fontStack = getComputedStyle(document.documentElement).getPropertyValue('--font-jp').trim() || 'sans-serif';
    ctx.font = `${Math.round(cs * 0.42)}px ${fontStack}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }

  for (let i = 0; i < rows * cols; i++) {
    if (revealed[i] || flagged[i]) continue;
    const p = probs[i];
    if (p === undefined || p <= 0) continue;
    const x = ox + (i % cols) * cs;
    const y = oy + Math.floor(i / cols) * cs;
    ctx.fillStyle = heatColor(p);
    ctx.fillRect(x, y, cs, cs);
    if (showText) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText((p * 100).toFixed(0) + '%', x + cs / 2, y + cs / 2 + 1);
    }
  }

  heatmapCanvas.style.display = 'block';
}

function clearGambleOverlay() {
  if (!heatmapCanvas) return;
  if (heatmapCanvas.style.display !== 'none') heatmapCanvas.style.display = 'none';
  const ctx = heatmapCanvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
}

// --- in-the-loop: フロンティア強調（確率なし） ---
function showFrontierHighlight(frontier) {
  const cells = boardGrid.children;
  for (const idx of frontier) {
    const cell = cells[idx];
    if (cell) cell.classList.add('frontier-highlight');
  }
}

function clearFrontierHighlight() {
  const highlighted = boardGrid.querySelectorAll('.frontier-highlight');
  for (const h of highlighted) h.classList.remove('frontier-highlight');
}

// --- カーソル ---
function showCursor() {
  fakeCursor.style.display = '';
}

function hideCursor() {
  fakeCursor.style.display = 'none';
}

// 速度スライダー連動: カーソルの移動・クリック時間
function cursorTravelMs() { return Math.max(40, Math.min(moveSpeed, 600)); }
function cursorClickMs()  { return Math.max(50, Math.min(Math.round(moveSpeed * 0.6), 240)); }

function moveCursorToCell(idx) {
  return new Promise(resolve => {
    const cell = boardGrid.children[idx];
    if (!cell || !boardWrapper) { resolve(); return; }

    // カーソルが表示中かつオートスクロールONなら、対象セルを可視領域へスクロール追随
    if (autoScroll && fakeCursor.style.display !== 'none') {
      const scrollContainer = boardGrid.closest('.game-app-area');
      if (scrollContainer) {
        // scrollIntoView で block/inline:nearest だと最小移動でセルを見せる
        // ただし scrollContainer 内でのスクロールに限定するため、
        // セルの位置をコンテナ基準で計算して scrollLeft/scrollTop を調整
        const containerRect = scrollContainer.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const margin = 40; // 先読み余白

        // 水平方向
        if (cellRect.right + margin > containerRect.right) {
          scrollContainer.scrollLeft += (cellRect.right + margin) - containerRect.right;
        } else if (cellRect.left - margin < containerRect.left) {
          scrollContainer.scrollLeft -= containerRect.left - (cellRect.left - margin);
        }

        // 垂直方向
        if (cellRect.bottom + margin > containerRect.bottom) {
          scrollContainer.scrollTop += (cellRect.bottom + margin) - containerRect.bottom;
        } else if (cellRect.top - margin < containerRect.top) {
          scrollContainer.scrollTop -= containerRect.top - (cellRect.top - margin);
        }
      }
    }

    const wrapperRect = boardWrapper.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    const targetX = cellRect.left - wrapperRect.left + cellRect.width / 2;
    const targetY = cellRect.top - wrapperRect.top + cellRect.height / 2 - 4;

    const travel = cursorTravelMs();
    fakeCursor.style.transitionDuration = travel + 'ms';
    fakeCursor.style.left = targetX + 'px';
    fakeCursor.style.top = targetY + 'px';

    setTimeout(resolve, travel + 10);
  });
}

function cursorClick() {
  return new Promise(resolve => {
    fakeCursor.classList.add('clicking');
    setTimeout(() => {
      fakeCursor.classList.remove('clicking');
      resolve();
    }, cursorClickMs());
  });
}

// --- ソート ---
function sortByDistance(indices, originIdx, cols) {
  const oR = Math.floor(originIdx / cols);
  const oC = originIdx % cols;
  return indices.slice().sort((a, b) => {
    const aR = Math.floor(a / cols); const aC = a % cols;
    const bR = Math.floor(b / cols); const bC = b % cols;
    return (Math.abs(aR - oR) + Math.abs(aC - oC)) - (Math.abs(bR - oR) + Math.abs(bC - oC));
  });
}

// --- gamble思考ウェイト演出 ---
async function showGambleThinking(previewResult) {
  // ログには出さない（「試算中／評価完了」はノイズ）。演出のみ行う。
  // ヒートマップは判断（賭け）時のみ表示する（仕様）。
  showGambleOverlay();
  setFace('thinking');
  setAvatar('thinking');

  // 高速モード or 判断速度0: 迷いカーソル演出なし。即決する。
  if (fastMode || thinkDelay <= 0) {
    setAvatar('active');
    return;
  }

  // 判断速度 = 迷いカーソル演出の総時間（budget）
  const budget = thinkDelay;
  showCursor();
  const state = agent.getState();
  const probs = agent.getProbabilities();
  if (probs) {
    // 迷いカーソルは「最終選択予定マスの近く」で行う（その先を眺めて迷う演出）
    const target = previewResult.index;
    const tR = Math.floor(target / state.cols);
    const tC = target % state.cols;
    const near = [];
    for (let i = 0; i < state.rows * state.cols; i++) {
      if (i === target) continue;
      if (!state.revealed[i] && !state.flagged[i] && probs[i] > 0) {
        const dR = Math.floor(i / state.cols) - tR;
        const dC = (i % state.cols) - tC;
        near.push({ idx: i, d: dR * dR + dC * dC });
      }
    }
    near.sort((a, b) => a.d - b.d);

    // 迷いマス数: 500ms ごとに 1 マス（1000ms → 別の 2 マスを迷ってから選択予定マスを選ぶ）
    const hops = Math.min(near.length, Math.max(1, Math.round(budget / 500)));
    const pause = (budget * 0.5) / hops;
    const startT = Date.now();
    for (let i = 0; i < hops; i++) {
      if (fastMode) break; // 途中で高速ONになったら迷いを打ち切る
      await moveCursorToCell(near[i].idx);
      if (pause > 0) await new Promise(r => setTimeout(r, pause));
    }
    const rest = budget - (Date.now() - startT);
    if (!fastMode && rest > 0) await new Promise(r => setTimeout(r, rest));
  } else {
    await new Promise(r => setTimeout(r, budget));
  }

  setAvatar('active');
}

// --- セル順次演出 ---
// indices を1マスずつカーソル演出付きで適用する（apply = revealCellDOM | flagCellDOM）。
// 高速モードに切り替わったら残りを即時適用して打ち切る（apply は冪等）。
async function animateCells(indices, apply) {
  const cellDelay = Math.max(30, Math.floor(moveSpeed / 4));
  for (const idx of indices) {
    await pauseGate();
    if (fastMode) { for (const i of indices) apply(i); break; }
    await moveCursorToCell(idx);
    await cursorClick();
    apply(idx);
    if (cellDelay > 0 && indices.length > 1) {
      await new Promise(r => setTimeout(r, cellDelay));
    }
  }
}

// --- 高速モード: 並列ストリームで段階的に開く（一括ダンプ禁止・カーソル非表示でOK） ---
// units: [{flag: idx} | {open: [idx,...]}]。複数レーンに分配し、各レーンが小ビートで適用する。
// 内部で複数カーソルが並列に開けていくイメージ。過程は必ず見える。
async function fastRevealUnits(units, stale) {
  if (!units || units.length === 0) return;
  const STREAMS = Math.min(8, units.length);
  const BEAT = 16; // ms/ビート（並列なので体感は STREAMS 倍速）
  const lanes = Array.from({ length: STREAMS }, () => []);
  units.forEach((u, i) => lanes[i % STREAMS].push(u));
  await Promise.all(lanes.map(async (lane) => {
    for (const u of lane) {
      await pauseGate();
      if (stale && stale()) return;
      if (u.flag !== undefined) flagCellDOM(u.flag);
      else if (u.open) for (const idx of u.open) revealCellDOM(idx);
      await new Promise(r => setTimeout(r, BEAT));
    }
  }));
}

// event から「開く単位」を作る。flood は1セルずつに分割して段階表示する。
function buildFastUnits(event, { splitFlood = false } = {}) {
  const units = [];
  if (event.actions && event.actions.length > 0) {
    for (const act of event.actions) {
      if (act.type === 'flag') units.push({ flag: act.index });
      else if (splitFlood) { for (const idx of act.opened) units.push({ open: [idx] }); }
      else units.push({ open: act.opened });
    }
    return units;
  }
  if (event.flagged) for (const i of event.flagged) units.push({ flag: i });
  const groups = event.revealGroups || (event.revealed ? [{ opened: event.revealed }] : []);
  for (const g of groups) {
    const opened = g.opened || [];
    if (splitFlood) { for (const idx of opened) units.push({ open: [idx] }); }
    else units.push({ open: opened });
  }
  return units;
}

// --- boom 余韻 ---
async function boomEffect(boomIdx) {
  setFace('boom');
  clearGambleOverlay(); // 判断→爆発: ヒートマップを消す

  // 盤面赤フラッシュ
  boardGrid.classList.add('boom-flash');

  // 踏んだセルに爆弾表示
  if (boomIdx !== undefined) {
    const boomCell = boardGrid.children[boomIdx];
    if (boomCell) {
      boomCell.classList.add('boom-cell');
      boomCell.textContent = '\u{1F4A3}';
    }
  }

  // boom のログは agent 側の判断行（✗ ...→ 地雷）で出すのでここでは出さない

  // 全地雷を一瞬見せる
  updateDisplay();
  renderBoard();

  // 踏んだセルを再度強調（renderBoardが上書きするので）
  if (boomIdx !== undefined) {
    const boomCell = boardGrid.children[boomIdx];
    if (boomCell) {
      boomCell.classList.add('boom-cell');
      boomCell.textContent = '\u{1F4A3}';
    }
  }

  // ホールド
  await new Promise(r => setTimeout(r, BOOM_HOLD_MS));

  boardGrid.classList.remove('boom-flash');
}

// --- クリア余韻（緑フラッシュ＋CLEARバナー＋ホールド） ---
async function clearEffect() {
  setFace('clear');
  clearGambleOverlay(); // クリア時: ヒートマップを消す

  // 勝利時は残った地雷も全て旗にして見せる（爆弾ではなく「全部見つけた」＝クリアの証）。
  // クリアは「安全マスを全開」で成立するため未フラグの地雷が残ることがあり、
  // renderBoard では爆弾💣として見えてしまうのを防ぐ。
  const tb = agent.getTrueBoard();
  if (tb && tb.mines) {
    const cells = boardGrid.children;
    for (const idx of tb.mines) {
      const cell = cells[idx];
      if (!cell) continue;
      cell.className = 'cell flagged';
      cell.textContent = '▶';
    }
  }

  boardGrid.classList.add('clear-flash');

  // 盤面中央に CLEAR バナー
  let banner = null;
  if (boardWrapper) {
    banner = document.createElement('div');
    banner.className = 'clear-banner';
    banner.textContent = 'CLEAR';
    boardWrapper.appendChild(banner);
  }

  await new Promise(r => setTimeout(r, CLEAR_HOLD_MS));

  boardGrid.classList.remove('clear-flash');
  if (banner) banner.remove();
}

// --- ステップ実行 ---
async function executeAnimatedStep() {
  if (animating) return;
  animating = true;
  // このステップ開始時の世代。盤面リセット/業務変更で世代が変わったら中断する。
  const gen = stepGeneration;
  const stale = () => gen !== stepGeneration;

  try {
    const previewResult = agent.preview();
    const state = agent.getState();
    const cols = state.cols;

    // アバター: ステップ実行中は基本 active（await-human/gamble 思考で上書き）
    if (previewResult.type !== 'await-human') {
      setAvatar('active');
    }

    // ヒートマップは判断（gamble / await-human）時のみ表示する。
    // 高速モードは賭け後すぐ消さない方式なので、非判断ステップに入るこの時点で確実に消す。
    // （連続する判断ではヒートマップが消えずに更新され点滅しないが、推論等へ移る瞬間に消える）
    if (fastMode && previewResult.type !== 'gamble' && previewResult.type !== 'await-human') {
      clearGambleOverlay();
    }

    // --- await-human (in-the-loop: 賭けは人間) ---
    if (previewResult.type === 'await-human') {
      const event = agent.step();
      // event.type === 'await-human', state 不変

      awaitingHumanGamble = true;
      stopLoop();
      setFace('thinking');
      setAvatar('sleeping');

      // フロンティアを強調 ＋ 確率ヒートマップを表示（人間の判断材料として）
      // 「あなたの番です」等のプロンプトはログに出さない（判断行のみ追う）。
      // 手番はカーソル停止・ヒートマップ・アバター睡眠で示す。
      if (event.frontier) showFrontierHighlight(event.frontier);
      showGambleOverlay();

      updateDisplay();
      animating = false;
      return;
    }

    // --- first ---
    if (previewResult.type === 'first') {
      if (fastMode) {
        // 高速モード: カーソルは非表示。初手 flood を並列段階表示で開く（スキップしない）。
        hideCursor();
        const event = agent.step();
        if (event.type === 'idle') { animating = false; return; }
        await fastRevealUnits(buildFastUnits(event, { splitFlood: true }), stale);
        if (stale()) return;
        if (event.log) addMsg(event.type, event.log);
        setFace('normal');
        updateDisplay();
        renderBoard();
      } else {
        showCursor();
        await moveCursorToCell(previewResult.index);
        await cursorClick();
        if (stale()) return;

        const event = agent.step();
        if (event.type === 'idle') { animating = false; return; }

        // revealGroups ベース: 1クリックの flood を一括展開
        applyRevealGroupsImmediate(event, 'indices');

        if (event.log) addMsg(event.type, event.log);
        setFace('normal');
        updateDisplay();
        renderBoard();
      }

    // --- gamble (on-the-loop AI自動) ---
    } else if (previewResult.type === 'gamble') {
      await showGambleThinking(previewResult);
      if (stale()) return;
      // 判断（賭け）は明示する: 高速モードでもカーソルを表示し、選んだマスへ移動してクリックする
      showCursor();
      await moveCursorToCell(previewResult.index);
      await cursorClick();
      if (stale()) return;
      // 非高速はクリック直後にヒートマップを消す（従来どおり）。
      // 高速モードは消さずに残し、次が非判断ステップに入る時点（executeAnimatedStep 冒頭）で消す。
      // → 連続する判断ではヒートマップが消えずに更新され、点滅しない。
      if (!fastMode) clearGambleOverlay();

      const event = agent.step();
      if (event.type === 'idle') { animating = false; return; }

      if (event.type === 'boom') {
        if (event.log) addMsg('boom', event.log);
        await boomEffect(event.index);
        if (stale()) return;
        animating = false;
        return;
      }

      // 賭けの flood を開く（高速は並列段階表示、通常は一括）
      if (fastMode) {
        await fastRevealUnits(buildFastUnits(event, { splitFlood: true }), stale);
        if (stale()) return;
      } else {
        applyRevealGroupsImmediate(event, 'revealed');
      }

      if (event.log) {
        let logType = event.type;
        if (event.humanIntervention) logType = 'human';
        addMsg(logType, event.log);
      }
      setFace('normal');
      updateDisplay();
      renderBoard();

      if (!stale() && agent.getPhase() === 'clear') {
        await handleClear();
      }

    // --- deduce ---
    } else if (previewResult.type === 'deduce') {
      if (fastMode) {
        // 高速モード: カーソル非表示。旗と開放を並列ストリームで段階表示（一括ダンプしない）。
        hideCursor();
        const event = agent.step();
        if (event.type === 'idle') { animating = false; return; }

        await fastRevealUnits(buildFastUnits(event, { splitFlood: true }), stale);
        if (stale()) return;

        updateDisplay();
        renderBoard();
        if (!stale() && agent.getPhase() === 'clear') { await handleClear(); }
      } else {
        showCursor();
        const event = agent.step();
        if (event.type === 'idle') { animating = false; return; }

        const origin = (previewResult.targets && previewResult.targets.length > 0)
          ? previewResult.targets[0] : 0;

        // 発見順に flag/reveal を交互にカーソル演出（event.actions）。
        // 「旗を立てる→その旗で確定した空白を開く」が交互に進み、全フラグ→全開放の偏りを防ぐ。
        if (event.actions && event.actions.length > 0) {
          const stepDelay = Math.max(30, Math.floor(moveSpeed / 4));
          let i = 0;
          for (; i < event.actions.length; i++) {
            await pauseGate();
            if (stale()) return;
            if (fastMode) break; // 途中で高速ONになったら残りは並列開放へ切替
            const act = event.actions[i];
            const target = act.type === 'flag' ? act.index : act.click;
            await moveCursorToCell(target);
            await cursorClick();
            if (stale()) return;
            if (act.type === 'flag') {
              flagCellDOM(act.index);
            } else {
              for (const idx of act.opened) revealCellDOM(idx);
            }
            if (event.actions.length > 1) {
              await new Promise(r => setTimeout(r, stepDelay));
            }
          }
          // 途中で高速モードに切り替わった場合、残りアクションを並列段階表示で開く
          if (fastMode && i < event.actions.length) {
            hideCursor();
            const units = [];
            for (const act of event.actions.slice(i)) {
              if (act.type === 'flag') units.push({ flag: act.index });
              else for (const idx of act.opened) units.push({ open: [idx] });
            }
            await fastRevealUnits(units, stale);
            if (stale()) return;
          }
        } else {
          // フォールバック（古い経路）: フラグ→revealGroups
          if (event.flagged && event.flagged.length > 0) {
            const sorted = sortByDistance(event.flagged, origin, cols);
            await animateCells(sorted, flagCellDOM);
          }
          if (event.revealGroups && event.revealGroups.length > 0) {
            const groupDelay = Math.max(30, Math.floor(moveSpeed / 4));
            for (const group of event.revealGroups) {
              await pauseGate();
              if (stale()) return;
              if (fastMode) break; // 残りは後続 renderBoard で補完
              await moveCursorToCell(group.click);
              await cursorClick();
              if (stale()) return;
              for (const idx of group.opened) revealCellDOM(idx);
              if (event.revealGroups.length > 1) {
                await new Promise(r => setTimeout(r, groupDelay));
              }
            }
          } else if (event.revealed && event.revealed.length > 0) {
            const sorted = sortByDistance(event.revealed, origin, cols);
            await animateCells(sorted, revealCellDOM);
          }
        }

        updateDisplay();
        renderBoard();
        if (!stale() && agent.getPhase() === 'clear') { await handleClear(); }
      }

    // --- restart ---
    } else if (previewResult.type === 'restart') {
      const event = agent.step();
      if (event.log) addMsg(event.type, event.log);
      buildBoard();
      setFace('normal');
      updateDisplay();
      renderBoard();

    // --- clear ---
    } else if (previewResult.type === 'clear') {
      const event = agent.step();
      if (event.log) addMsg(event.type, event.log);
      updateDisplay();
      renderBoard();
      if (event.type === 'clear') {
        await handleClear(event);
      }

    } else {
      animating = false;
      return;
    }

  } finally {
    // 自分の世代がまだ現役のときだけ animating を解除する
    // （古いステップの finally が新しいステップの animating を消さないようにする）
    if (!stale()) animating = false;
  }
}

// --- クリア ---
async function handleClear(eventOverride) {
  stopLoop();
  // この余韻処理が始まった時点の世代。盤面リセット/業務変更（initBoard）で世代が変わったら、
  // 各 await から復帰したあとの「次タスク開始・レビュー表示」を中断する。
  // （旧クリアの継続が新しいゲームの taskIndex/盤面を上書きするのを防ぐ）
  const gen = stepGeneration;
  let event = eventOverride;
  if (!event || event.type !== 'clear') {
    event = agent.step();
  }
  if (event.log) addMsg(event.type, event.log);
  setFace('clear');
  updateDisplay();
  renderBoard();

  // runner 累積（showReview で表示する項目のみ）
  if (event.stats) {
    runnerStats.totalGambles += event.stats.gambles;
    runnerStats.totalFailures += event.stats.failures;
  }

  // クリアの余韻（緑フラッシュ＋CLEAR表示＋ウェイト）。クリアしたことを分かりやすく。
  await clearEffect();
  if (gen !== stepGeneration) return; // 余韻中に業務変更/リセットされた → 中断

  // ワークオーダー処理
  if (workOrder) {
    clearsDone++;
    const task = workOrder.tasks[taskIndex];

    if (clearsDone >= task.quota) {
      // per-task 統計を確定
      const nowStats = agent.getStats();
      taskResults.push({
        difficulty: task.difficulty,
        attempts: nowStats.attempts - taskBaseline.attempts,
        aiJudgments: agent.getAiJudgments() - taskBaseline.aiJudgments,
        elapsedMs: Date.now() - taskBaseline.startTime,
      });
      taskIndex++;

      if (taskIndex >= workOrder.tasks.length) {
        runnerStats.elapsedMs = Date.now() - runnerStats.startTime;
        await new Promise(r => setTimeout(r, 800));
        if (gen !== stepGeneration) return;
        showReview();
        return;
      }

      await new Promise(r => setTimeout(r, 600));
      if (gen !== stepGeneration) return;
      startCurrentTask();
      return;
    }

    await new Promise(r => setTimeout(r, 400));
    if (gen !== stepGeneration) return;
    initBoard();
    startLoop();
  } else {
    if (event.stats) {
      const stats = event.stats;
      clearSummaryText.innerHTML = t('clear.summary', {
        attempts: Math.max(0, stats.attempts - 1),
        failures: stats.failures,
        gambles: stats.gambles,
        deductions: stats.deductions,
        time: formatHMS(stats.elapsedMs),
      });
      clearOverlay.style.display = 'flex';
    }
  }
}

// --- 業務レビュー ---
function showReview() {
  stopLoop();
  runnerStats.elapsedMs = Date.now() - runnerStats.startTime;

  const s = runnerStats;
  const gambleLabel = loopMode === 'on' ? t('review.gambleAI') : t('review.gambleHuman');

  // 各タスク内訳
  let taskBreakdown = '';
  if (taskResults.length > 0) {
    taskBreakdown = `<div class="review-section-title">${t('review.taskTitle')}</div>`;
    for (const r of taskResults) {
      const d = DIFFICULTIES[r.difficulty];
      const size = d ? `${d.rows}×${d.cols}` : r.difficulty;
      taskBreakdown += `<div class="review-task">${t('review.task', { size, attempts: r.attempts, judgments: r.aiJudgments, time: formatMSS(r.elapsedMs) })}</div>`;
    }
  }

  // 証跡ログ（判断の記録・セッション全体）
  const esc = (str) => str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const logHtml = sessionLog.length === 0
    ? `<div class="review-log-line">${t('review.noLog')}</div>`
    : sessionLog.map(e =>
        `<div class="review-log-line ${e.type}"><span class="review-log-time">${e.time}</span>${esc(e.text)}</div>`
      ).join('');

  reviewBody.innerHTML =
    taskBreakdown +
    `<div class="review-section-title">${t('review.summaryTitle')}</div>` +
    `<div class="review-stat">${t('review.failures', { n: s.totalFailures })}</div>` +
    `<div class="review-stat">${t('review.gambleCount', { label: gambleLabel, n: s.totalGambles })}</div>` +
    `<div class="review-stat">${t('review.supervisorTime', { time: formatHMS(s.elapsedMs) })}</div>` +
    `<div class="review-section-title">${t('review.logTitle')}</div>` +
    `<div class="review-log">${logHtml}</div>`;

  reviewOverlay.style.display = 'flex';
}

// --- ループ制御 ---
let loopTimer = null;

function startLoop() {
  stopLoop();
  paused = false;
  resumeAll(); // 旧盤面の suspend 中ステップがあれば解放（stale で自然に bail する）
  playing = true;
  playPauseBtn.textContent = 'PAUSE';
  playPauseBtn.classList.remove('active');
  scheduleNext();
}

function stopLoop() {
  playing = false;
  playPauseBtn.textContent = 'PLAY';
  playPauseBtn.classList.add('active');
  if (loopTimer !== null) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
}

function scheduleNext() {
  if (!playing) return;
  if (agent.getPhase() === 'idle') return;
  // 既存タイマーを必ず破棄してから再スケジュール（速度変更時の多重ループを防ぐ）
  if (loopTimer !== null) { clearTimeout(loopTimer); loopTimer = null; }

  // 高速モードはステップ間隔をほぼゼロに（演出を挟まないので一気に進める）
  const stepInterval = fastMode ? 0 : moveSpeed;
  loopTimer = setTimeout(async () => {
    loopTimer = null;
    await executeAnimatedStep();
    scheduleNext();
  }, stepInterval);
}

// --- イベントハンドラ ---

// 速度
moveSlider.addEventListener('input', () => {
  moveSpeed = parseInt(moveSlider.value, 10);
  moveSliderVal.textContent = moveSpeed + 'ms';
  if (playing) scheduleNext(); // 新しい速度で即時に取り直す（多重ループ防止は scheduleNext 内）
});

// 思考
thinkSlider.addEventListener('input', () => {
  thinkDelay = parseInt(thinkSlider.value, 10);
  thinkSliderVal.textContent = thinkDelay + 'ms';
});

// 高速モード
fastModeCheck.addEventListener('change', () => {
  fastMode = fastModeCheck.checked;
  if (fastMode) hideCursor(); else showCursor();
});

// オートスクロール
autoScrollCheck.addEventListener('change', () => {
  autoScroll = autoScrollCheck.checked;
});

// 再生/一時停止（実行中ステップのアニメも即座にサスペンド/再開する）
playPauseBtn.addEventListener('click', () => {
  if (playing) {
    // 一時停止: 新規ステップを止め、実行中ステップは pauseGate でサスペンド
    paused = true;
    playing = false;
    playPauseBtn.textContent = 'PLAY';
    playPauseBtn.classList.add('active');
    if (loopTimer !== null) { clearTimeout(loopTimer); loopTimer = null; }
  } else {
    // 再開
    paused = false;
    resumeAll();
    playing = true;
    playPauseBtn.textContent = 'PAUSE';
    playPauseBtn.classList.remove('active');
    if (!animating) scheduleNext(); // サスペンド中ステップが無ければループを再開
  }
});

// 顔ボタン → リスタート
faceBtn.addEventListener('click', () => {
  stopLoop();
  awaitingHumanGamble = false;
  clearFrontierHighlight();
  initBoard();
  startLoop();
});

// ループモード切替トグル（アバター帯のボタン）
for (const btn of loopToggleBtns) {
  btn.addEventListener('click', () => {
    switchLoopMode(loopMode === 'on' ? 'in' : 'on');
  });
}
// 操作バーの「AIに判断を任せる」トグル（押し込み=on-the-loop）
if (loopToggleBtnBar) {
  loopToggleBtnBar.addEventListener('click', () => {
    switchLoopMode(loopMode === 'on' ? 'in' : 'on');
  });
}

// セルクリック — event delegation（in-the-loop: 人間の賭け待ちのみ）
boardGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const idx = parseInt(cell.dataset.idx, 10);
  if (isNaN(idx)) return;

  // in-the-loop: 人間の賭け待ち
  if (!awaitingHumanGamble) return;

  awaitingHumanGamble = false;
  clearFrontierHighlight();
  clearGambleOverlay();

  const result = agent.humanReveal(idx);
  if (result.log) {
    const logType = result.type === 'boom' ? 'boom' : 'human';
    addMsg(logType, result.log);
  }

  // 人間クリック → flood 即時一括描画
  if (result.revealed) {
    for (const i of result.revealed) revealCellDOM(i);
  }
  updateDisplay();
  renderBoard();

  if (result.type === 'boom') {
    const gen = stepGeneration;
    (async () => {
      await boomEffect(result.index);
      if (gen !== stepGeneration) return; // 余韻中に業務変更/リセットされた → 中断
      if (workOrder) {
        runnerStats.totalFailures++;
      }
      startLoop();
    })();
    return;
  }

  setFace('normal');

  if (agent.getPhase() === 'clear') {
    handleClear();
    return;
  }

  startLoop();
});

// ワークオーダー「タスクを変更」: 現在のゲームは破棄せず一時停止して表示。
// 「戻る」で現在のタスクに復帰できるよう、workOrder は保持したままにする。
if (woChangeBtn) {
  woChangeBtn.addEventListener('click', () => {
    stopLoop();
    // 進行中のゲームがあれば「戻る」を出す（復帰先がある）
    if (woCancelBtn) woCancelBtn.style.display = workOrder ? '' : 'none';
    workOrderOverlay.style.display = 'flex';
  });
}

// 「戻る（変更しない）」: 変更せずオーバーレイを閉じ、現在のタスクを再開
if (woCancelBtn) {
  woCancelBtn.addEventListener('click', () => {
    workOrderOverlay.style.display = 'none';
    woCancelBtn.style.display = 'none';
    if (workOrder) {
      if (taskListPanel) taskListPanel.style.display = '';
      startLoop(); // 一時停止していた現在のゲームを再開
    }
  });
}

// ワークオーダー開始（各タスク = 1クリアで次へ）
woStartBtn.addEventListener('click', () => {
  const tasks = [];
  const rows = woTaskRows.querySelectorAll('.wo-task-row');
  rows.forEach(row => {
    const diff = row.querySelector('.wo-diff').value;
    if (diff) {
      tasks.push({ difficulty: diff, quota: 1 });
    }
  });

  if (tasks.length === 0) {
    tasks.push({ difficulty: 'intermediate', quota: 1 });
  }

  // モード選択は廃止。既定は on-the-loop（AI自動）。in-the-loop は対局中トグルで切替。
  startWorkOrder({ tasks, loopMode: 'on' });
});

// もう一度眺める（レガシー）
replayBtn.addEventListener('click', () => {
  clearOverlay.style.display = 'none';
  initBoard();
  startLoop();
});

// 業務レビューボタン
reviewNewBtn.addEventListener('click', () => {
  reviewOverlay.style.display = 'none';
  workOrder = null;
  if (taskListPanel) taskListPanel.style.display = 'none';
  if (woCancelBtn) woCancelBtn.style.display = 'none'; // 復帰先なし → 戻る非表示
  workOrderOverlay.style.display = 'flex';
});

reviewRetryBtn.addEventListener('click', () => {
  reviewOverlay.style.display = 'none';
  if (workOrder) {
    startWorkOrder({ ...workOrder });
  } else {
    workOrderOverlay.style.display = 'flex';
  }
});

// --- 起動 ---
// i18n: detectLocale → 静的DOM反映 → 以降のロケール変更で動的UIも再描画
setupI18n({
  onChange: () => {
    buildWoTaskRows();           // タスク指示書の難易度ラベルを再翻訳
    if (workOrder) updateTaskList(); // タスクリストの統計表記を再翻訳
  },
});
wireLangToggles();

buildWoTaskRows();
updateLoopToggleUI(); // トグルボタンの初期モード色を適用
workOrderOverlay.style.display = 'flex';

// 経過時間など時間表示を毎秒なめらかに更新する（ステップ駆動に依存させない）。
// updateDisplay は renderBoard を呼ばずテキスト更新のみなので軽量で、
// 思考ウェイト中・await-human中・低速進行中でも時計が飛ばずに進む。
setInterval(() => { if (agent) updateDisplay(); }, 250);
