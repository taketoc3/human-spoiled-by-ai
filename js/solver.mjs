// ai-minesweeper ソルバー
// ローカル推論（近接2セルまで）のみ。意図的に賢くしすぎない設計。

/**
 * 周囲8マスの index 配列（盤面外は除外）
 * @param {number} idx - セルindex
 * @param {number} rows - 行数
 * @param {number} cols - 列数
 * @returns {number[]}
 */
export function neighbors(idx, rows, cols) {
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        result.push(nr * cols + nc);
      }
    }
  }
  return result;
}

/**
 * 盤面を生成する
 * @param {object} params
 * @param {number} params.rows
 * @param {number} params.cols
 * @param {number} params.mineCount
 * @param {number} params.safeR - 初手安全セルの行
 * @param {number} params.safeC - 初手安全セルの列
 * @param {function} [params.rng=Math.random] - [0,1) 乱数関数
 * @returns {{ rows: number, cols: number, mineCount: number, mines: Set<number>, counts: Int8Array }}
 */
export function genBoard({ rows, cols, mineCount, safeR, safeC, rng = Math.random }) {
  const size = rows * cols;
  const safeIdx = safeR * cols + safeC;

  // 除外セット: safeセル + その周囲8マス
  const excluded = new Set([safeIdx, ...neighbors(safeIdx, rows, cols)]);

  // 配置可能セルのリスト
  let candidates = [];
  for (let i = 0; i < size; i++) {
    if (!excluded.has(i)) candidates.push(i);
  }

  // mineCount が配置可能セル数を超える場合: 除外を減らす（safe本体のみ除外）
  if (candidates.length < mineCount) {
    candidates = [];
    for (let i = 0; i < size; i++) {
      if (i !== safeIdx) candidates.push(i);
    }
  }

  // 実際に配置する数
  const actualMineCount = Math.min(mineCount, candidates.length);

  // Fisher-Yates シャッフルで先頭 actualMineCount 個を選ぶ
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const mines = new Set(candidates.slice(0, actualMineCount));

  // counts を計算
  const counts = new Int8Array(size).fill(-1);
  for (let i = 0; i < size; i++) {
    if (mines.has(i)) continue;
    const nbrs = neighbors(i, rows, cols);
    counts[i] = nbrs.filter(n => mines.has(n)).length;
  }

  return { rows, cols, mineCount: actualMineCount, mines, counts };
}

/**
 * 現在の知識状態から1パスで導ける安全/地雷セルを返す
 * @param {{ rows: number, cols: number, revealed: Uint8Array, value: Int8Array, flagged: Uint8Array }} state
 * @returns {{ safe: number[], mines: number[] }}
 */
export function deduce(state) {
  const { rows, cols, revealed, value, flagged } = state;
  const size = rows * cols;
  const safeSet = new Set();
  const mineSet = new Set();

  // 全 revealed 数字セルについて評価
  for (let idx = 0; idx < size; idx++) {
    if (!revealed[idx]) continue;

    const nbrs = neighbors(idx, rows, cols);
    const flaggedCount = nbrs.filter(n => flagged[n]).length;
    const hidden = nbrs.filter(n => !revealed[n] && !flagged[n]);
    const rem = value[idx] - flaggedCount;

    // ルールA: flagged数 == value → 残り未開放は全て safe
    if (flaggedCount === value[idx]) {
      for (const h of hidden) safeSet.add(h);
    }

    // ルールB: rem == hidden数 → 全て地雷
    if (rem === hidden.length && hidden.length > 0) {
      for (const h of hidden) mineSet.add(h);
    }
  }

  // 2セル部分集合ルール（近接ペアのみ）
  for (let x = 0; x < size; x++) {
    if (!revealed[x]) continue;

    const xNbrs = neighbors(x, rows, cols);
    const xHidden = xNbrs.filter(n => !revealed[n] && !flagged[n]);
    const xRem = value[x] - xNbrs.filter(n => flagged[n]).length;

    if (xHidden.length === 0) continue;

    // Y は X の周囲8マス以内の revealed セル
    for (const y of xNbrs) {
      if (!revealed[y]) continue;

      const yNbrs = neighbors(y, rows, cols);
      const yHidden = yNbrs.filter(n => !revealed[n] && !flagged[n]);
      const yRem = value[y] - yNbrs.filter(n => flagged[n]).length;

      if (yHidden.length === 0) continue;

      const xSet = new Set(xHidden);
      const ySet = new Set(yHidden);

      // H(X) ⊆ H(Y) かチェック
      const xSubsetOfY = xHidden.every(h => ySet.has(h));
      if (xSubsetOfY && xHidden.length > 0) {
        const diff = yHidden.filter(h => !xSet.has(h));
        if (diff.length > 0) {
          // rem(Y) - rem(X) == |diff| → diff は全て地雷
          if (yRem - xRem === diff.length) {
            for (const d of diff) mineSet.add(d);
          }
          // rem(Y) == rem(X) → diff は全て安全
          if (yRem === xRem) {
            for (const d of diff) safeSet.add(d);
          }
        }
      }
    }
  }

  return {
    safe: [...safeSet],
    mines: [...mineSet],
  };
}

/**
 * 各未開放未flagセルの推定地雷確率を計算
 * @param {{ rows: number, cols: number, revealed: Uint8Array, value: Int8Array, flagged: Uint8Array }} state
 * @param {number} minesRemaining - 残り地雷数
 * @returns {Float32Array}
 */
export function computeProbabilities(state, minesRemaining) {
  const { rows, cols, revealed, value, flagged } = state;
  const size = rows * cols;
  const probs = new Float32Array(size);

  // 未開放未flagセルの総数
  let unopenedCount = 0;
  for (let i = 0; i < size; i++) {
    if (!revealed[i] && !flagged[i]) unopenedCount++;
  }

  // フロンティアセルを特定し、各セルの最大局所確率を計算
  const isFrontier = new Uint8Array(size);
  const maxProb = new Float32Array(size);

  for (let idx = 0; idx < size; idx++) {
    if (!revealed[idx]) continue;

    const nbrs = neighbors(idx, rows, cols);
    const flaggedCount = nbrs.filter(n => flagged[n]).length;
    const hidden = nbrs.filter(n => !revealed[n] && !flagged[n]);
    const rem = value[idx] - flaggedCount;

    if (hidden.length === 0) continue;

    const p = rem / hidden.length;

    for (const h of hidden) {
      isFrontier[h] = 1;
      if (p > maxProb[h]) maxProb[h] = p;
    }
  }

  // 内部セルのフォールバック密度
  const density = unopenedCount > 0 ? minesRemaining / unopenedCount : 0;

  for (let i = 0; i < size; i++) {
    if (revealed[i] || flagged[i]) {
      probs[i] = 0;
    } else if (isFrontier[i]) {
      probs[i] = maxProb[i];
    } else {
      probs[i] = density;
    }
  }

  return probs;
}

/**
 * エージェントが「賭ける」セルを選ぶ
 * @param {{ rows: number, cols: number, revealed: Uint8Array, value: Int8Array, flagged: Uint8Array }} state
 * @param {number} minesRemaining
 * @returns {{ index: number, probability: number, frontierSize: number, isFirstMove: boolean }}
 */
export function pickGuess(state, minesRemaining) {
  const { rows, cols, revealed, flagged } = state;
  const size = rows * cols;

  // 初手判定: 1つも revealed がないか
  let hasRevealed = false;
  for (let i = 0; i < size; i++) {
    if (revealed[i]) { hasRevealed = true; break; }
  }

  if (!hasRevealed) {
    // 未開放未flag総数
    let unopened = 0;
    for (let i = 0; i < size; i++) {
      if (!revealed[i] && !flagged[i]) unopened++;
    }
    const density = unopened > 0 ? minesRemaining / unopened : 0;
    return { index: 0, probability: density, frontierSize: 0, candidates: 1, isFirstMove: true };
  }

  const probs = computeProbabilities(state, minesRemaining);

  // フロンティアサイズ計算
  let frontierSize = 0;
  for (let idx = 0; idx < size; idx++) {
    if (revealed[idx] || flagged[idx]) continue;
    const nbrs = neighbors(idx, rows, cols);
    const hasFrontier = nbrs.some(n => revealed[n] && state.value[n] >= 0);
    if (hasFrontier) frontierSize++;
  }

  // セルの分類: 角(0), 辺(1), その他(2)
  function cellType(idx) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const isTopOrBottom = r === 0 || r === rows - 1;
    const isLeftOrRight = c === 0 || c === cols - 1;
    if (isTopOrBottom && isLeftOrRight) return 0; // 角
    if (isTopOrBottom || isLeftOrRight) return 1; // 辺
    return 2; // その他
  }

  // 最小確率のセルを選ぶ
  let bestIdx = -1;
  let bestProb = Infinity;
  let bestType = 3;

  for (let i = 0; i < size; i++) {
    if (revealed[i] || flagged[i]) continue;

    const p = probs[i];
    const t = cellType(i);

    if (p < bestProb || (p === bestProb && t < bestType) || (p === bestProb && t === bestType && i < bestIdx)) {
      bestIdx = i;
      bestProb = p;
      bestType = t;
    }
  }

  // 最小確率と同値（＝同じリスクの選択肢）のセル数を数える
  let candidates = 0;
  for (let i = 0; i < size; i++) {
    if (revealed[i] || flagged[i]) continue;
    if (probs[i] === bestProb) candidates++;
  }

  return {
    index: bestIdx,
    probability: bestProb,
    frontierSize,
    candidates,
    isFirstMove: false,
  };
}
