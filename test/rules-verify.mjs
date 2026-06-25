// マインスイーパーのゲームルール検証（ロジック層・決定論）
// agent の humanReveal / getState / getTrueBoard を使い、flood 等のルール順守を確認する。
import { createAgent } from '../js/agent.mjs';
import { neighbors } from '../js/solver.mjs';

// 決定論 rng（線形合同）
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 真の盤面から「idx をクリックしたときに開くべきセル集合」を標準ルールで計算
function expectedFlood(startIdx, board, revealed) {
  const { rows, cols, counts, mines } = board;
  if (mines.has(startIdx)) return { boom: true, opened: [startIdx] };
  const opened = new Set();
  const queue = [startIdx];
  while (queue.length) {
    const idx = queue.pop();
    if (opened.has(idx) || revealed[idx]) continue;
    opened.add(idx);
    if (counts[idx] === 0) {
      for (const n of neighbors(idx, rows, cols)) {
        if (!opened.has(n) && !revealed[n]) queue.push(n);
      }
    }
  }
  return { boom: false, opened: [...opened].sort((a,b)=>a-b) };
}

let pass = 0, fail = 0;
function check(name, cond, extra='') {
  if (cond) { pass++; console.log('  ok  -', name); }
  else { fail++; console.log('  FAIL-', name, extra); }
}

// 複数シードで検証
for (const seed of [1, 7, 42, 123, 999]) {
  console.log(`\n=== seed ${seed} ===`);
  const rows = 16, cols = 30, mineCount = 99;
  const agent = createAgent({ rows, cols, mineCount, rng: makeRng(seed) });

  // 初手（盤面生成＋角フラッド）
  const first = agent.step();
  const board = agent.getTrueBoard();
  let st = agent.getState();

  // R1: 初手セル(角=0)は地雷でない
  check('初手セルは地雷でない（first-click safe）', !board.mines.has(0));

  // R2: counts が隣接地雷数と一致（全セル抜き取り）
  let countsOk = true;
  for (let i = 0; i < rows*cols; i++) {
    if (board.mines.has(i)) continue;
    const adj = neighbors(i, rows, cols).filter(n => board.mines.has(n)).length;
    if (board.counts[i] !== adj) { countsOk = false; break; }
  }
  check('数字 = 周囲8マスの地雷数', countsOk);

  // R3: 初手フラッド = 標準ルールのフラッドと一致
  const expFirst = expectedFlood(0, board, new Uint8Array(rows*cols));
  const gotFirst = (first.indices || first.revealed || []).slice().sort((a,b)=>a-b);
  check('初手フラッドが標準ルールと一致', JSON.stringify(gotFirst) === JSON.stringify(expFirst.opened),
        `got ${gotFirst.length} exp ${expFirst.opened.length}`);

  // R4: 0セルをクリックすると連結0領域＋境界数字が全部開く（カスケード）
  // 現在未開放の 0セル（非地雷）を1つ探す
  st = agent.getState();
  let zeroIdx = -1;
  for (let i = 0; i < rows*cols; i++) {
    if (!st.revealed[i] && !board.mines.has(i) && board.counts[i] === 0) { zeroIdx = i; break; }
  }
  if (zeroIdx >= 0) {
    const before = agent.getState();
    const exp = expectedFlood(zeroIdx, board, before.revealed);
    const res = agent.humanReveal(zeroIdx);
    const got = (res.revealed || []).slice().sort((a,b)=>a-b);
    check('0セルのクリックで連結領域が全開（flood）', JSON.stringify(got) === JSON.stringify(exp.opened),
          `got ${got.length} exp ${exp.opened.length}`);
    check('0セルflood: 2マス以上開く（1マスで止まらない）', got.length > 1, `got ${got.length}`);
    // 開いたセルが実際に state に反映されている
    const after = agent.getState();
    let allRevealed = got.every(i => after.revealed[i] === 1);
    check('floodで開いたセルが全て revealed 状態', allRevealed);
  } else {
    console.log('  (この盤面に未開放0セルなし → スキップ)');
  }

  // R5: 数字セル（value>=1）のクリックはそのセルのみ開く
  st = agent.getState();
  let numIdx = -1;
  for (let i = 0; i < rows*cols; i++) {
    if (!st.revealed[i] && !board.mines.has(i) && board.counts[i] >= 1) {
      // 隣接に開放セルがある＝クリック可能なフロンティアにする必要はないが、単独開を確認
      numIdx = i; break;
    }
  }
  if (numIdx >= 0) {
    const res = agent.humanReveal(numIdx);
    const got = res.revealed || [];
    check('数字セルのクリックは1マスのみ開く', got.length === 1 && got[0] === numIdx, `got ${got.length}`);
  }

  // R6: 地雷クリックは boom
  let mineIdx = [...board.mines][0];
  // mineIdx が未開放であること前提
  const st2 = agent.getState();
  if (!st2.revealed[mineIdx]) {
    const res = agent.humanReveal(mineIdx);
    check('地雷クリックで boom', res.type === 'boom');
  }
}

console.log(`\n=== RESULT: ${pass} pass / ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
