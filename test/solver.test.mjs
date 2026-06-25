import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  neighbors,
  genBoard,
  deduce,
  computeProbabilities,
  pickGuess,
} from '../js/solver.mjs';

// --- テスト用ヘルパ ---

/**
 * テスト用のシード固定擬似乱数生成器（線形合同法）
 */
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x80000000;
  };
}

/**
 * テスト用の知識状態を手動構築するヘルパ
 */
function makeState(rows, cols, revealedMap = {}, flaggedSet = new Set()) {
  const size = rows * cols;
  const revealed = new Uint8Array(size);
  const value = new Int8Array(size).fill(-1);
  const flagged = new Uint8Array(size);

  for (const [idx, val] of Object.entries(revealedMap)) {
    const i = Number(idx);
    revealed[i] = 1;
    value[i] = val;
  }
  for (const idx of flaggedSet) {
    flagged[idx] = 1;
  }

  return { rows, cols, revealed, value, flagged };
}

// =====================
// neighbors テスト
// =====================
describe('neighbors', () => {
  it('角セル（左上）は3隣接', () => {
    // 3x3 盤面、index=0 (0,0)
    const n = neighbors(0, 3, 3);
    assert.equal(n.length, 3);
    // 隣接は (0,1)=1, (1,0)=3, (1,1)=4
    assert.deepEqual(n.sort((a, b) => a - b), [1, 3, 4]);
  });

  it('角セル（右下）は3隣接', () => {
    // 3x3 盤面、index=8 (2,2)
    const n = neighbors(8, 3, 3);
    assert.equal(n.length, 3);
    assert.deepEqual(n.sort((a, b) => a - b), [4, 5, 7]);
  });

  it('辺セル（上辺中央）は5隣接', () => {
    // 3x3 盤面、index=1 (0,1)
    const n = neighbors(1, 3, 3);
    assert.equal(n.length, 5);
    assert.deepEqual(n.sort((a, b) => a - b), [0, 2, 3, 4, 5]);
  });

  it('中央セルは8隣接', () => {
    // 3x3 盤面、index=4 (1,1)
    const n = neighbors(4, 3, 3);
    assert.equal(n.length, 8);
    assert.deepEqual(n.sort((a, b) => a - b), [0, 1, 2, 3, 5, 6, 7, 8]);
  });

  it('1x1 盤面は隣接なし', () => {
    const n = neighbors(0, 1, 1);
    assert.equal(n.length, 0);
  });

  it('横長盤面の辺セル', () => {
    // 2x5 盤面、index=3 (0,3)
    const n = neighbors(3, 2, 5);
    assert.equal(n.length, 5);
    // (0,2)=2, (0,4)=4, (1,2)=7, (1,3)=8, (1,4)=9
    assert.deepEqual(n.sort((a, b) => a - b), [2, 4, 7, 8, 9]);
  });
});

// =====================
// genBoard テスト
// =====================
describe('genBoard', () => {
  it('地雷数が指定通り', () => {
    const board = genBoard({ rows: 5, cols: 5, mineCount: 5, safeR: 0, safeC: 0, rng: seededRng(42) });
    assert.equal(board.mines.size, 5);
  });

  it('safe セルとその周囲に地雷がない', () => {
    const board = genBoard({ rows: 5, cols: 5, mineCount: 10, safeR: 2, safeC: 2, rng: seededRng(123) });
    const safeIdx = 2 * 5 + 2; // index=12
    const safeNeighbors = neighbors(safeIdx, 5, 5);
    assert.equal(board.mines.has(safeIdx), false);
    for (const n of safeNeighbors) {
      assert.equal(board.mines.has(n), false, `neighbor ${n} should not be mine`);
    }
  });

  it('3x3 盤面の counts が手計算と一致', () => {
    // 3x3, safeR=0,safeC=0 → 除外: {0,1,3,4} → 配置可能: {2,5,6,7,8}
    const rng = seededRng(99);
    const board = genBoard({ rows: 3, cols: 3, mineCount: 2, safeR: 0, safeC: 0, rng });
    assert.equal(board.mines.size, 2);
    // safe セルに地雷なし
    assert.equal(board.mines.has(0), false);
    // counts を手動検証
    for (let idx = 0; idx < 9; idx++) {
      if (board.mines.has(idx)) continue;
      const nbrs = neighbors(idx, 3, 3);
      const expected = nbrs.filter(n => board.mines.has(n)).length;
      assert.equal(board.counts[idx], expected, `counts[${idx}] should be ${expected}`);
    }
  });

  it('角のsafeセルで周囲4マスのみ除外（3x3）', () => {
    // safeR=0,safeC=0 → safe=index0 → 除外: 0,1,3,4 (4マス)
    // 残り5マスに地雷を最大5個
    const board = genBoard({ rows: 3, cols: 3, mineCount: 5, safeR: 0, safeC: 0, rng: seededRng(42) });
    assert.equal(board.mines.size, 5);
    assert.equal(board.mines.has(0), false);
    assert.equal(board.mines.has(1), false);
    assert.equal(board.mines.has(3), false);
    assert.equal(board.mines.has(4), false);
  });

  it('counts が正しく計算される（固定盤面）', () => {
    // 4x4 盤面、safeR=0,safeC=0 で地雷を固定位置に配置
    // rng を制御して検証
    const rng = seededRng(7);
    const board = genBoard({ rows: 4, cols: 4, mineCount: 3, safeR: 0, safeC: 0, rng });

    // 地雷位置を取得し、counts を手動計算して一致を検証
    for (let idx = 0; idx < 16; idx++) {
      if (board.mines.has(idx)) continue;
      const nbrs = neighbors(idx, 4, 4);
      const expected = nbrs.filter(n => board.mines.has(n)).length;
      assert.equal(board.counts[idx], expected, `counts[${idx}] should be ${expected}`);
    }
  });

  it('seed固定で決定論的に同じ盤面を生成', () => {
    const b1 = genBoard({ rows: 8, cols: 8, mineCount: 10, safeR: 0, safeC: 0, rng: seededRng(555) });
    const b2 = genBoard({ rows: 8, cols: 8, mineCount: 10, safeR: 0, safeC: 0, rng: seededRng(555) });
    assert.deepEqual([...b1.mines].sort(), [...b2.mines].sort());
  });

  it('mineCount が配置可能セル数を超える場合は可能な限り配置', () => {
    // 3x3, safeR=1,safeC=1 → 全9マス除外。最低safe本体だけは除外
    // → 最大8個まで配置可能（safeセル本体のみ除外）
    const board = genBoard({ rows: 3, cols: 3, mineCount: 100, safeR: 1, safeC: 1, rng: seededRng(1) });
    assert.equal(board.mines.has(4), false); // safe本体は必ず除外
    assert.ok(board.mines.size <= 8);
  });
});

// =====================
// deduce テスト
// =====================
describe('deduce', () => {
  describe('基本ルールA（安全確定）', () => {
    it('flagged数==value のとき残りの未開放セルはsafe', () => {
      const state = makeState(3, 3, { 0: 1 }, new Set([1]));
      const result = deduce(state);
      assert.deepEqual(result.safe.sort((a, b) => a - b), [3, 4]);
      assert.deepEqual(result.mines, []);
    });
  });

  describe('基本ルールB（地雷確定）', () => {
    it('残り地雷数==未開放未flagセル数のとき全て地雷', () => {
      const state = makeState(3, 3, { 0: 3 });
      const result = deduce(state);
      assert.deepEqual(result.mines.sort((a, b) => a - b), [1, 3, 4]);
      assert.deepEqual(result.safe, []);
    });
  });

  describe('2セル部分集合ルール', () => {
    it('1-2-1 パターンで差分が安全と確定', () => {
      const state = makeState(3, 3, { 0: 1, 1: 2, 2: 1 });
      const result = deduce(state);
      assert.deepEqual(result.mines.sort((a, b) => a - b), [3, 5]);
    });

    it('部分集合ルールで差分が安全と確定するケース', () => {
      const state = makeState(4, 3, { 0: 1, 3: 1 });
      const result = deduce(state);
      assert.ok(result.safe.includes(6), 'index 6 should be safe');
      assert.ok(result.safe.includes(7), 'index 7 should be safe');
    });
  });

  describe('確定手がない場合', () => {
    it('safe/mines 共に空配列', () => {
      const state = makeState(3, 3, { 4: 1 });
      const result = deduce(state);
      assert.deepEqual(result.safe, []);
      assert.deepEqual(result.mines, []);
    });
  });

  it('既に revealed/flagged のセルは結果に含まない', () => {
    const state = makeState(3, 3, { 0: 0, 1: 0, 2: 0 });
    const result = deduce(state);
    assert.deepEqual(result.safe.sort((a, b) => a - b), [3, 4, 5]);
    assert.deepEqual(result.mines, []);
  });
});

// =====================
// computeProbabilities テスト
// =====================
describe('computeProbabilities', () => {
  it('フロンティアセルの確率が手計算と一致', () => {
    const state = makeState(3, 3, { 4: 1 });
    const probs = computeProbabilities(state, 1);
    assert.ok(Math.abs(probs[0] - 0.125) < 0.001);
    assert.ok(Math.abs(probs[1] - 0.125) < 0.001);
    assert.equal(probs[4], 0);
  });

  it('内部セルが密度フォールバックになる', () => {
    const state = makeState(5, 5, { 12: 0 });
    const probs = computeProbabilities(state, 5);
    assert.ok(Math.abs(probs[7] - 0) < 0.001);
    assert.ok(Math.abs(probs[0] - 5 / 24) < 0.001);
  });

  it('複数制約の最大値を取る', () => {
    const state = makeState(1, 5, { 0: 1, 2: 2 });
    const probs = computeProbabilities(state, 2);
    assert.ok(Math.abs(probs[1] - 1.0) < 0.001);
    assert.ok(Math.abs(probs[3] - 1.0) < 0.001);
    assert.ok(Math.abs(probs[4] - 2 / 3) < 0.01);
  });

  it('revealed や flagged セルは確率 0', () => {
    const state = makeState(3, 3, { 0: 1 }, new Set([1]));
    const probs = computeProbabilities(state, 1);
    assert.equal(probs[0], 0);
    assert.equal(probs[1], 0);
  });
});

// =====================
// pickGuess テスト
// =====================
describe('pickGuess', () => {
  it('初手で角(index 0)を返し isFirstMove=true', () => {
    const state = makeState(8, 8, {});
    const guess = pickGuess(state, 10);
    assert.equal(guess.index, 0);
    assert.equal(guess.isFirstMove, true);
    assert.equal(guess.frontierSize, 0);
  });

  it('確率差のある局面で最小確率セルを選ぶ', () => {
    const state = makeState(3, 3, { 4: 1 });
    const guess = pickGuess(state, 1);
    assert.equal(guess.index, 0);
    assert.equal(guess.isFirstMove, false);
    assert.ok(Math.abs(guess.probability - 0.125) < 0.001);
  });

  it('タイブレークで角を辺より優先', () => {
    const state = makeState(5, 5, { 12: 0 });
    const guess = pickGuess(state, 5);
    assert.equal(guess.index, 6);
    assert.equal(guess.isFirstMove, false);
  });

  it('frontierSize を正しく返す', () => {
    const state = makeState(3, 3, { 4: 1 });
    const guess = pickGuess(state, 1);
    assert.equal(guess.frontierSize, 8);
  });
});
