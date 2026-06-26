// ai-minesweeper エージェント — 状態機械
// DOM非依存・決定論的（rng注入可）
// solver を import し、1ステップずつ盤面を進める

import { neighbors, genBoard, deduce, computeProbabilities, pickGuess } from './solver.mjs';
import { t } from './i18n.mjs';
// 思考ログは t() で生成。t() は呼び出し時に現在ロケールを解決するため、
// ロケール未設定（テスト等）では既定の ja 文字列になり、挙動・型は不変。

/**
 * フラッド展開（value=0 のセルから連鎖的に隣接を開放）
 * @param {number} startIdx - 起点セル
 * @param {object} board - 真の盤面 { rows, cols, mines, counts }
 * @param {Uint8Array} revealed - 開放状態
 * @param {Int8Array} value - 知識状態の値
 * @returns {number[]} 新たに開放されたセル一覧
 */
function floodReveal(startIdx, board, revealed, value) {
  const opened = [];
  const queue = [startIdx];

  while (queue.length > 0) {
    const idx = queue.pop();
    if (revealed[idx]) continue;

    revealed[idx] = 1;
    value[idx] = board.counts[idx];
    opened.push(idx);

    // value=0 なら隣接を連鎖
    if (board.counts[idx] === 0) {
      for (const n of neighbors(idx, board.rows, board.cols)) {
        if (!revealed[n]) {
          queue.push(n);
        }
      }
    }
  }
  return opened;
}

// フェーズ定数
const PHASE = {
  INIT: 'init',
  SOLVING: 'solving',
  GAMBLE: 'gamble',
  BOOM: 'boom',
  CLEAR: 'clear',
  IDLE: 'idle',
};

/**
 * エージェントを生成
 * @param {{ rows: number, cols: number, mineCount: number, rng?: function }} params
 */
export function createAgent({ rows, cols, mineCount, rng = Math.random }) {
  const totalCells = rows * cols;
  const safeCells = totalCells - mineCount;

  // --- 内部状態 ---
  let board = null;       // 真の盤面（genBoard の結果）
  let revealed = null;    // Uint8Array — 開放済み
  let value = null;       // Int8Array — 知識上の値（未開放=-1）
  let flagged = null;     // Uint8Array — フラグ済み
  let phase = PHASE.INIT;
  let probabilities = null;

  // gambleMode: 'auto'（既定）= 賭けを自動実行、'human' = 賭けで停止し人間に委ねる
  let gambleMode = 'auto';

  // 統計
  let stats = {
    attempts: 0,
    cellsOpened: 0,
    deductions: 0,
    gambles: 0,
    aiJudgments: 0, // AI自身が賭け判断を下した回数（humanReveal は含まない）
    failures: 0,
    startTime: Date.now(),
    elapsedMs: 0,
  };

  // 試行ごとの開始時刻（ゲーム内タイマー用）
  let attemptStartTime = Date.now();

  /** 新しい試行の準備（盤面は初手まで未生成） */
  function resetInternal() {
    board = null;
    revealed = new Uint8Array(totalCells);
    value = new Int8Array(totalCells).fill(-1);
    flagged = new Uint8Array(totalCells);
    phase = PHASE.INIT;
    probabilities = null;
    attemptStartTime = Date.now();
    stats.attempts++;
  }

  // 初期化
  resetInternal();

  /** 開放セル数を数える */
  function countRevealed() {
    let count = 0;
    for (let i = 0; i < totalCells; i++) {
      if (revealed[i]) count++;
    }
    return count;
  }

  /** フラグ済み数を数える */
  function countFlagged() {
    let count = 0;
    for (let i = 0; i < totalCells; i++) {
      if (flagged[i]) count++;
    }
    return count;
  }

  /** 残り地雷数 */
  function minesRemaining() {
    return mineCount - countFlagged();
  }

  /** 知識状態オブジェクト */
  function getKnowledgeState() {
    return { rows, cols, revealed, value, flagged };
  }

  /** 勝利判定 */
  function isCleared() {
    return countRevealed() >= safeCells;
  }

  /** 開放率(%) */
  function progress() {
    return safeCells > 0 ? (countRevealed() / safeCells) * 100 : 100;
  }

  /** セルを開く（地雷チェック＋フラッド展開） */
  function revealCell(idx) {
    if (board.mines.has(idx)) {
      return { boom: true, opened: [idx] };
    }
    const opened = floodReveal(idx, board, revealed, value);
    stats.cellsOpened += opened.length;
    return { boom: false, opened };
  }

  /** 座標文字列 */
  function coordStr(idx) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    return `(${r},${c})`;
  }

  /** 統計を更新 */
  function updateStats() {
    stats.elapsedMs = Date.now() - stats.startTime;
  }

  /** フロンティア（未開放・未フラグ・隣接に開放セルがある）のindex一覧を返す */
  function getFrontier() {
    const frontier = [];
    for (let i = 0; i < totalCells; i++) {
      if (revealed[i] || flagged[i]) continue;
      // 隣接に開放セルがあるか
      const nbrs = neighbors(i, rows, cols);
      for (const n of nbrs) {
        if (revealed[n]) {
          frontier.push(i);
          break;
        }
      }
    }
    return frontier;
  }

  // ============================
  // 公開 API
  // ============================

  function reset() {
    resetInternal();
  }

  /**
   * 次に step() が行うアクションを先読みして返す（状態を一切変更しない）
   * @returns {{ type: string, targets: number[], index?: number, probability?: number, frontierSize?: number }}
   */
  function preview() {
    // クリア済み / idle
    if (phase === PHASE.IDLE) {
      return { type: 'idle', targets: [] };
    }

    // BOOM 後のリスタート
    if (phase === PHASE.BOOM) {
      return { type: 'restart', targets: [] };
    }

    // CLEAR
    if (phase === PHASE.CLEAR) {
      return { type: 'clear', targets: [] };
    }

    // 盤面未生成 → 初手
    if (phase === PHASE.INIT) {
      // human モードでは初手も人間に選ばせる
      if (gambleMode === 'human') {
        return { type: 'await-human', targets: [], frontier: [], firstMove: true };
      }
      // pickGuess は純関数で rng を消費しない（isFirstMove は固定で index=0）
      const guess = pickGuess(getKnowledgeState(), mineCount);
      return {
        type: 'first',
        targets: [guess.index],
        index: guess.index,
      };
    }

    // SOLVING / GAMBLE: deduce を試行（読み取り専用）
    if (phase === PHASE.SOLVING || phase === PHASE.GAMBLE) {
      const deduction = deduce(getKnowledgeState());

      if (deduction.safe.length > 0 || deduction.mines.length > 0) {
        // 確定手あり — 開くセル + フラグするセルを返す
        const targets = [...deduction.safe, ...deduction.mines];
        return {
          type: 'deduce',
          targets,
        };
      }

      // 確定手なし → 勝利判定
      if (isCleared()) {
        return { type: 'clear', targets: [] };
      }

      // 確定手なし → human モードでは await-human
      if (gambleMode === 'human') {
        return {
          type: 'await-human',
          targets: [],
          frontier: getFrontier(),
        };
      }

      // 確定手なし → 賭け
      const mr = minesRemaining();
      const guess = pickGuess(getKnowledgeState(), mr);
      return {
        type: 'gamble',
        targets: [guess.index],
        index: guess.index,
        probability: guess.probability,
        frontierSize: guess.frontierSize,
      };
    }

    return { type: 'idle', targets: [] };
  }

  function step() {
    updateStats();

    // クリア済み → idle
    if (phase === PHASE.IDLE) {
      return { type: 'idle' };
    }

    // BOOM 後の自動リスタート
    if (phase === PHASE.BOOM) {
      resetInternal();
      return {
        type: 'restart',
        log: t('log.restart', { n: stats.attempts - 1 }),
      };
    }

    // CLEAR
    if (phase === PHASE.CLEAR) {
      phase = PHASE.IDLE;
      const sec = Math.round(stats.elapsedMs / 1000);
      const timeStr = sec >= 60
        ? t('time.ms', { m: Math.floor(sec / 60), s: sec % 60 })
        : t('time.s', { s: sec });
      return {
        type: 'clear',
        log: t('log.clear', { gambles: stats.gambles, time: timeStr }),
        stats: { ...stats },
      };
    }

    // 盤面未生成 → 初手
    if (phase === PHASE.INIT) {
      // human モードでは初手も人間に委ねる（盤面はまだ生成しない）
      if (gambleMode === 'human') {
        const frontier = getFrontier();
        return {
          type: 'await-human',
          firstMove: true,
          frontier,
          log: t('log.firstZero'),
        };
      }
      // 初手は角 (index 0)
      const guess = pickGuess(getKnowledgeState(), mineCount);
      const safeR = Math.floor(guess.index / cols);
      const safeC = guess.index % cols;

      board = genBoard({ rows, cols, mineCount, safeR, safeC, rng });

      const result = revealCell(guess.index);
      phase = PHASE.SOLVING;

      return {
        type: 'first',
        index: guess.index,
        indices: result.opened,
        revealGroups: [{ click: guess.index, opened: result.opened }],
        log: t('log.first', { coord: coordStr(guess.index), mines: minesRemaining() }),
      };
    }

    // SOLVING: deduce を試行
    if (phase === PHASE.SOLVING || phase === PHASE.GAMBLE) {
      // 確定手を fixpoint まで繰り返し適用する。
      // 「地雷を旗にする → その旗で確定した隣接の安全セルを開く」(基本ルールA) が
      // 同じ論理ステップ内で連鎖し、フラグと確定空白オープンが一つのビートで起きる。
      const revealedCells = [];
      const flaggedCells = [];
      const revealGroups = [];
      // 演出用アクション列。各旗の直後に「その旗で確定した安全セル」を開くアクションを置くことで、
      // 「旗を立てる → その旗で決定した空白が開く」が密に対応して進む。
      const actions = [];

      // 安全セルを1つ開く小ヘルパ（未開放・未フラグのときだけフラッド展開して記録）
      const doReveal = (idx) => {
        if (revealed[idx] || flagged[idx]) return;
        const result = revealCell(idx);
        revealedCells.push(...result.opened);
        revealGroups.push({ click: idx, opened: result.opened });
        actions.push({ type: 'reveal', click: idx, opened: result.opened });
      };

      let guard = 0;
      while (guard++ < totalCells) {
        const deduction = deduce(getKnowledgeState());
        if (deduction.safe.length === 0 && deduction.mines.length === 0) break;

        const before = revealedCells.length + flaggedCells.length;

        // 旗不要で確定済みの安全セル（2セル規則 / 既存の旗によるルールA）を先に開く
        for (const idx of deduction.safe) doReveal(idx);

        // 地雷を1つ旗にするたびに、その旗で満たされた近傍の数字から確定する安全セルを即開放する
        for (const idx of deduction.mines) {
          if (flagged[idx]) continue;
          flagged[idx] = 1;
          flaggedCells.push(idx);
          actions.push({ type: 'flag', index: idx });

          // この旗で flaggedCount === value になった近傍の数字セル → 残りの未開放隣接は安全
          for (const y of neighbors(idx, rows, cols)) {
            if (!revealed[y] || value[y] <= 0) continue;
            const yNbrs = neighbors(y, rows, cols);
            const yFlagged = yNbrs.filter((n) => flagged[n]).length;
            if (yFlagged === value[y]) {
              for (const h of yNbrs) doReveal(h);
            }
          }
        }

        if (revealedCells.length + flaggedCells.length === before) break; // 進展なし
        if (isCleared()) break;
      }

      if (revealedCells.length > 0 || flaggedCells.length > 0) {
        stats.deductions++;
        phase = isCleared() ? PHASE.CLEAR : PHASE.SOLVING;

        // 確率を更新
        probabilities = computeProbabilities(getKnowledgeState(), minesRemaining());

        const logParts = [];
        if (flaggedCells.length > 0) {
          logParts.push(t('log.deduceFlag', { n: flaggedCells.length }));
        }
        if (revealedCells.length > 0) {
          logParts.push(t('log.deduceSafe', { n: revealedCells.length }));
        }
        logParts.push(t('log.deduceProgress', { pct: progress().toFixed(1) }));

        return {
          type: 'deduce',
          revealed: revealedCells,
          flagged: flaggedCells,
          revealGroups,
          actions,
          log: t('log.deduce', { body: logParts.join(t('log.deduceSep')) }),
        };
      }

      // 確定手なし → 勝利判定
      if (isCleared()) {
        phase = PHASE.CLEAR;
        return step(); // clear イベントを返す
      }

      // 確定手なし → human モードでは await-human を返して停止
      if (gambleMode === 'human') {
        const frontier = getFrontier();
        return {
          type: 'await-human',
          frontier,
          log: t('log.stuck', { n: frontier.length }),
        };
      }

      // 確定手なし → 賭け
      probabilities = computeProbabilities(getKnowledgeState(), minesRemaining());
      const guess = pickGuess(getKnowledgeState(), minesRemaining());

      const result = revealCell(guess.index);

      if (result.boom) {
        // BOOM（AI自身が賭け判断を下した結果の失敗）
        phase = PHASE.BOOM;
        stats.failures++;
        stats.aiJudgments++;
        const prog = progress().toFixed(1);
        return {
          type: 'boom',
          index: guess.index,
          log: t('log.gambleBoom', { coord: coordStr(guess.index), mines: minesRemaining(), prob: (guess.probability * 100).toFixed(0), candidates: guess.candidates }),
          stats: { ...stats },
        };
      }

      // 賭け成功
      stats.gambles++;
      stats.aiJudgments++;
      phase = PHASE.SOLVING;

      // 勝利判定
      if (isCleared()) {
        phase = PHASE.CLEAR;
      }

      // 確率を更新
      probabilities = computeProbabilities(getKnowledgeState(), minesRemaining());

      return {
        type: 'gamble',
        index: guess.index,
        probability: guess.probability,
        frontierSize: guess.frontierSize,
        revealed: result.opened,
        revealGroups: [{ click: guess.index, opened: result.opened }],
        log: t('log.gambleSafe', { coord: coordStr(guess.index), mines: minesRemaining(), prob: (guess.probability * 100).toFixed(0), candidates: guess.candidates }),
      };
    }

    return { type: 'idle' };
  }

  /** 人間介入：指定セルを開く */
  function humanReveal(index) {
    if (phase === PHASE.IDLE || phase === PHASE.CLEAR) {
      return { type: 'idle' };
    }

    // 初手（盤面未生成）: 選んだセルを安全にして盤面を生成（first-click safe）
    if (!board || phase === PHASE.INIT) {
      const safeR = Math.floor(index / cols);
      const safeC = index % cols;
      board = genBoard({ rows, cols, mineCount, safeR, safeC, rng });
      const result = revealCell(index);
      phase = PHASE.SOLVING;
      updateStats();
      return {
        type: 'first',
        index,
        revealed: result.opened,
        revealGroups: [{ click: index, opened: result.opened }],
        log: t('log.humanFirst', { coord: coordStr(index), mines: minesRemaining() }),
      };
    }

    if (revealed[index] || flagged[index]) {
      return {
        type: 'idle',
        log: t('log.alreadyOpen'),
      };
    }

    const result = revealCell(index);

    if (result.boom) {
      phase = PHASE.BOOM;
      stats.failures++;
      updateStats();
      return {
        type: 'boom',
        index,
        revealed: result.opened,
        log: t('log.humanBoom', { coord: coordStr(index), mines: minesRemaining() }),
        stats: { ...stats },
      };
    }

    // 成功
    stats.gambles++;
    phase = PHASE.SOLVING;
    updateStats();

    if (isCleared()) {
      phase = PHASE.CLEAR;
    }

    probabilities = computeProbabilities(getKnowledgeState(), minesRemaining());

    return {
      type: 'gamble',
      index,
      probability: null,
      frontierSize: null,
      revealed: result.opened,
      revealGroups: [{ click: index, opened: result.opened }],
      log: t('log.humanSafe', { coord: coordStr(index), mines: minesRemaining() }),
      humanIntervention: true,
    };
  }

  function getState() {
    return {
      rows,
      cols,
      revealed: revealed ? new Uint8Array(revealed) : null,
      value: value ? new Int8Array(value) : null,
      flagged: flagged ? new Uint8Array(flagged) : null,
    };
  }

  function getTrueBoard() {
    return board;
  }

  function getProbabilities() {
    // 現在の知識状態から都度計算して返す（step() 前の preview 演出でも正しい確率を出すため）。
    // 盤面未生成（初手前）は計算不能なので null。
    if (!board || !revealed) return null;
    return computeProbabilities(getKnowledgeState(), minesRemaining());
  }

  function getStats() {
    updateStats();
    return { ...stats };
  }

  function getPhase() {
    return phase;
  }

  function getMinesRemaining() {
    return minesRemaining();
  }

  /** 現在の試行の経過ミリ秒（盤面リスタートでリセット） */
  function getGameElapsedMs() {
    return Date.now() - attemptStartTime;
  }

  function setGambleMode(mode) {
    gambleMode = mode;
  }

  function getGambleMode() {
    return gambleMode;
  }

  function getAiJudgments() {
    return stats.aiJudgments;
  }

  return {
    reset,
    preview,
    step,
    humanReveal,
    getState,
    getTrueBoard,
    getProbabilities,
    getStats,
    getPhase,
    getMinesRemaining,
    setGambleMode,
    getGambleMode,
    getGameElapsedMs,
    getAiJudgments,
  };
}
