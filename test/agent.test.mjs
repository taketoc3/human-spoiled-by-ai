import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../js/agent.mjs';
import { deduce } from '../js/solver.mjs';

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

describe('agent', () => {
  it('固定rngの小盤面(5x5/3)で有限ステップ以内にクリアに到達する', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    let cleared = false;
    const maxSteps = 2000;

    for (let i = 0; i < maxSteps; i++) {
      const event = agent.step();
      if (event.type === 'clear') {
        cleared = true;
        break;
      }
      if (event.type === 'idle') {
        break;
      }
    }

    assert.ok(cleared, '2000ステップ以内にクリアに到達すべき');
  });

  it('初手イベントの型が正しい', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(100),
    });

    const event = agent.step();
    assert.equal(event.type, 'first');
    assert.equal(event.index, 0); // 角から開始
    assert.ok(Array.isArray(event.indices));
    assert.ok(event.indices.length > 0);
    assert.ok(typeof event.log === 'string');
  });

  it('boom後に自動リスタートする', () => {
    // 多数の地雷で boom しやすい盤面
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 15,
      rng: seededRng(7),
    });

    let hasBoom = false;
    let hasRestart = false;
    const maxSteps = 500;

    for (let i = 0; i < maxSteps; i++) {
      const event = agent.step();
      if (event.type === 'boom') {
        hasBoom = true;
      }
      if (event.type === 'restart') {
        hasRestart = true;
        break;
      }
      if (event.type === 'clear' || event.type === 'idle') {
        break;
      }
    }

    // 地雷15/25なので boom はほぼ確実
    if (hasBoom) {
      assert.ok(hasRestart, 'boom後にrestartイベントが発生すべき');
    }
  });

  it('getState/getStats/getPhase が正しく返る', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    const state = agent.getState();
    assert.equal(state.rows, 5);
    assert.equal(state.cols, 5);
    assert.ok(state.revealed instanceof Uint8Array);
    assert.ok(state.value instanceof Int8Array);
    assert.ok(state.flagged instanceof Uint8Array);

    const stats = agent.getStats();
    assert.equal(typeof stats.attempts, 'number');
    assert.equal(typeof stats.cellsOpened, 'number');
    assert.equal(typeof stats.deductions, 'number');
    assert.equal(typeof stats.gambles, 'number');

    const phase = agent.getPhase();
    assert.equal(typeof phase, 'string');
  });

  it('humanReveal で人間介入ができる', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    // まず初手
    agent.step();

    // 人間が未開放セルを開く
    const state = agent.getState();
    let targetIdx = -1;
    for (let i = 0; i < 25; i++) {
      if (!state.revealed[i] && !state.flagged[i]) {
        targetIdx = i;
        break;
      }
    }

    if (targetIdx >= 0) {
      const result = agent.humanReveal(targetIdx);
      assert.ok(result.type === 'gamble' || result.type === 'boom');
      if (result.type === 'gamble') {
        assert.equal(result.humanIntervention, true);
      }
    }
  });

  it('複数のシードで全てクリアに到達する（堅牢性テスト）', () => {
    const seeds = [1, 42, 123, 456, 999];

    for (const seed of seeds) {
      const agent = createAgent({
        rows: 5,
        cols: 5,
        mineCount: 3,
        rng: seededRng(seed),
      });

      let cleared = false;
      for (let i = 0; i < 2000; i++) {
        const event = agent.step();
        if (event.type === 'clear') {
          cleared = true;
          break;
        }
        if (event.type === 'idle') break;
      }

      assert.ok(cleared, `seed=${seed} で2000ステップ以内にクリアに到達すべき`);
    }
  });
});

// =====================
// preview() テスト
// =====================
describe('preview', () => {
  it('preview() 呼び出しが getState() を変えない', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    // 初手を実行して盤面を生成
    agent.step();

    // preview 前の状態を記録
    const stateBefore = agent.getState();
    const revealedBefore = new Uint8Array(stateBefore.revealed);
    const flaggedBefore = new Uint8Array(stateBefore.flagged);

    // preview 実行
    agent.preview();

    // preview 後の状態を確認
    const stateAfter = agent.getState();
    assert.deepEqual(stateAfter.revealed, revealedBefore, 'revealed が変化してはいけない');
    assert.deepEqual(stateAfter.flagged, flaggedBefore, 'flagged が変化してはいけない');
  });

  it('preview().type と直後の step() のイベント type が一致する', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    const maxSteps = 100;
    for (let i = 0; i < maxSteps; i++) {
      const previewResult = agent.preview();
      const stepResult = agent.step();

      assert.equal(
        previewResult.type, stepResult.type,
        `ステップ${i}: preview.type=${previewResult.type} だが step.type=${stepResult.type}`
      );

      if (stepResult.type === 'clear' || stepResult.type === 'idle') break;
    }
  });

  it('gamble ケースで preview().index == step() が開いた index', () => {
    // 地雷多めで gamble が頻発する盤面
    const agent = createAgent({
      rows: 8,
      cols: 8,
      mineCount: 10,
      rng: seededRng(77),
    });

    let gambleFound = false;
    const maxSteps = 200;

    for (let i = 0; i < maxSteps; i++) {
      const previewResult = agent.preview();

      if (previewResult.type === 'gamble') {
        const stepResult = agent.step();
        // gamble でも boom でも、step が開いた index は一致するはず
        assert.equal(
          previewResult.index, stepResult.index,
          `gamble preview.index=${previewResult.index} だが step.index=${stepResult.index}`
        );
        gambleFound = true;
        // boom したら次のステップで restart が来るのでそこで止める
        if (stepResult.type === 'boom') break;
      } else {
        agent.step();
      }

      if (agent.getPhase() === 'idle') break;
    }

    assert.ok(gambleFound, 'gamble イベントが1回以上発生すべき');
  });

  it('INIT 状態で preview() が first を返す', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    const p = agent.preview();
    assert.equal(p.type, 'first');
    assert.deepEqual(p.targets, [0]); // 角 index=0
    assert.equal(p.index, 0);
  });

  it('preview() を複数回呼んでも状態が変わらない', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    agent.step(); // 初手

    const p1 = agent.preview();
    const p2 = agent.preview();
    const p3 = agent.preview();

    assert.equal(p1.type, p2.type);
    assert.equal(p2.type, p3.type);
    assert.deepEqual(p1.targets, p2.targets);
    assert.deepEqual(p2.targets, p3.targets);
  });
});

// =====================
// stats.failures テスト
// =====================
describe('stats.failures', () => {
  it('初期値は 0', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    const stats = agent.getStats();
    assert.equal(stats.failures, 0);
  });

  it('boom 時に failures がインクリメントされる', () => {
    // 地雷密度高めで boom させやすい
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 15,
      rng: seededRng(7),
    });

    let boomCount = 0;
    const maxSteps = 500;

    for (let i = 0; i < maxSteps; i++) {
      const event = agent.step();
      if (event.type === 'boom') {
        boomCount++;
        // boom イベントの stats にも failures が含まれる
        assert.equal(event.stats.failures, boomCount,
          `boom #${boomCount} 時点で failures=${event.stats.failures}`);
      }
      if (event.type === 'clear' || event.type === 'idle') break;
      if (boomCount >= 3) break; // 3回確認すれば十分
    }

    assert.ok(boomCount > 0, 'boom が1回以上発生すべき');
    assert.equal(agent.getStats().failures, boomCount);
  });

  it('humanReveal の gamble 成功時も gambles がインクリメントされる', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    // 初手
    agent.step();

    const statsBefore = agent.getStats();
    const gamblesBefore = statsBefore.gambles;

    // 安全な未開放セルを探して humanReveal
    const state = agent.getState();
    const trueBoard = agent.getTrueBoard();
    let safeIdx = -1;
    for (let i = 0; i < 25; i++) {
      if (!state.revealed[i] && !state.flagged[i] && !trueBoard.mines.has(i)) {
        safeIdx = i;
        break;
      }
    }

    if (safeIdx >= 0) {
      const result = agent.humanReveal(safeIdx);
      assert.equal(result.type, 'gamble');
      assert.equal(agent.getStats().gambles, gamblesBefore + 1);
    }
  });

  it('humanReveal による boom でも failures がインクリメントされる', () => {
    // 地雷密度高めの盤面で humanReveal で地雷を踏む
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 20,
      rng: seededRng(42),
    });

    // 初手
    agent.step();

    // 地雷セルを探して humanReveal
    const trueBoard = agent.getTrueBoard();
    let mineIdx = -1;
    for (const m of trueBoard.mines) {
      mineIdx = m;
      break;
    }

    if (mineIdx >= 0) {
      const result = agent.humanReveal(mineIdx);
      assert.equal(result.type, 'boom');
      assert.equal(agent.getStats().failures, 1);
    }
  });
});

// =====================
// gambleMode テスト
// =====================
describe('gambleMode', () => {
  it('human モードで確定手なし時に await-human を返し state を変えない', () => {
    // 地雷多めで gamble が必要になる盤面
    const agent = createAgent({
      rows: 8,
      cols: 8,
      mineCount: 10,
      rng: seededRng(77),
    });
    agent.setGambleMode('human');

    // 初手も human: await-human(firstMove) → humanReveal で盤面生成
    const firstEv = agent.step();
    assert.equal(firstEv.type, 'await-human', '初手は await-human であるべき');
    assert.ok(firstEv.firstMove, '初手は firstMove フラグを持つべき');
    agent.humanReveal(0);

    // deduce を回してから await-human に到達
    let awaitFound = false;
    const maxSteps = 100;
    for (let i = 0; i < maxSteps; i++) {
      const stateBefore = agent.getState();
      const revealedBefore = new Uint8Array(stateBefore.revealed);
      const flaggedBefore = new Uint8Array(stateBefore.flagged);

      const event = agent.step();

      if (event.type === 'await-human') {
        awaitFound = true;
        // state が変わっていないことを確認
        const stateAfter = agent.getState();
        assert.deepEqual(stateAfter.revealed, revealedBefore, 'await-human で revealed が変化してはいけない');
        assert.deepEqual(stateAfter.flagged, flaggedBefore, 'await-human で flagged が変化してはいけない');
        assert.ok(Array.isArray(event.frontier), 'frontier 配列があるべき');
        assert.ok(event.frontier.length > 0, 'frontier にセルがあるべき');
        break;
      }
      if (event.type === 'clear' || event.type === 'idle') break;
    }

    assert.ok(awaitFound, 'await-human イベントが発生すべき');
  });

  it('await-human 後に humanReveal で進行できる', () => {
    const agent = createAgent({
      rows: 8,
      cols: 8,
      mineCount: 10,
      rng: seededRng(77),
    });
    agent.setGambleMode('human');

    // 初手も human: await-human(firstMove) → humanReveal で盤面生成
    const firstEv = agent.step();
    assert.equal(firstEv.type, 'await-human', '初手は await-human であるべき');
    assert.ok(firstEv.firstMove, '初手は firstMove フラグを持つべき');
    agent.humanReveal(0);

    // await-human まで進める
    let frontier = null;
    const maxSteps = 100;
    for (let i = 0; i < maxSteps; i++) {
      const event = agent.step();
      if (event.type === 'await-human') {
        frontier = event.frontier;
        break;
      }
      if (event.type === 'clear' || event.type === 'idle') break;
    }

    assert.ok(frontier && frontier.length > 0, 'frontier があるべき');

    // フロンティアの最初のセルを humanReveal
    const result = agent.humanReveal(frontier[0]);
    assert.ok(result.type === 'gamble' || result.type === 'boom', 'humanReveal が gamble または boom を返すべき');

    // 進行後にさらに step が可能（stuck しない）
    if (result.type !== 'boom') {
      const next = agent.step();
      assert.ok(next.type !== 'idle', 'humanReveal 後に進行できるべき');
    }
  });

  it('preview() も human モードで await-human を返す', () => {
    const agent = createAgent({
      rows: 8,
      cols: 8,
      mineCount: 10,
      rng: seededRng(77),
    });
    agent.setGambleMode('human');

    // 初手も human: await-human(firstMove) → humanReveal で盤面生成
    const firstEv = agent.step();
    assert.equal(firstEv.type, 'await-human', '初手は await-human であるべき');
    assert.ok(firstEv.firstMove, '初手は firstMove フラグを持つべき');
    agent.humanReveal(0);

    // await-human まで進める
    const maxSteps = 100;
    for (let i = 0; i < maxSteps; i++) {
      const p = agent.preview();
      if (p.type === 'await-human') {
        assert.ok(Array.isArray(p.frontier), 'preview の frontier 配列があるべき');
        break;
      }
      const event = agent.step();
      if (event.type === 'clear' || event.type === 'idle') break;
    }
  });

  it('revealGroups の opened を flatten すると revealed と一致する', () => {
    const agent = createAgent({
      rows: 8,
      cols: 8,
      mineCount: 10,
      rng: seededRng(77),
    });

    // 初手
    const firstEvent = agent.step();
    assert.ok(firstEvent.revealGroups, 'first イベントに revealGroups があるべき');
    assert.equal(firstEvent.revealGroups.length, 1, 'first は1グループ');
    // indices と revealGroups[0].opened は同じ
    assert.deepEqual(
      firstEvent.revealGroups[0].opened.slice().sort((a, b) => a - b),
      firstEvent.indices.slice().sort((a, b) => a - b),
      'first: revealGroups[0].opened == indices'
    );

    // deduce/gamble を回して revealGroups を検証
    let deduceChecked = false;
    let gambleChecked = false;
    const maxSteps = 200;
    for (let i = 0; i < maxSteps; i++) {
      const event = agent.step();
      if (event.type === 'deduce' && event.revealGroups) {
        // flatten して revealed と比較
        const flatOpened = event.revealGroups.flatMap(g => g.opened).sort((a, b) => a - b);
        const sortedRevealed = event.revealed.slice().sort((a, b) => a - b);
        assert.deepEqual(flatOpened, sortedRevealed,
          'deduce: revealGroups を flatten すると revealed と一致');
        // 各 group.click が group.opened に含まれる
        for (const g of event.revealGroups) {
          assert.ok(g.opened.includes(g.click),
            `deduce: click ${g.click} が opened に含まれるべき`);
        }
        deduceChecked = true;
      }
      if (event.type === 'gamble' && event.revealGroups) {
        const flatOpened = event.revealGroups.flatMap(g => g.opened).sort((a, b) => a - b);
        const sortedRevealed = event.revealed.slice().sort((a, b) => a - b);
        assert.deepEqual(flatOpened, sortedRevealed,
          'gamble: revealGroups を flatten すると revealed と一致');
        assert.equal(event.revealGroups[0].click, event.index,
          'gamble: click == event.index');
        gambleChecked = true;
      }
      if (event.type === 'clear' || event.type === 'idle') break;
      if (deduceChecked && gambleChecked) break;
    }

    assert.ok(deduceChecked, 'deduce イベントの revealGroups を検証すべき');
  });

  it('humanReveal の revealGroups が正しい構造を持つ', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });

    // 初手
    agent.step();

    // 安全な未開放セルを探して humanReveal
    const state = agent.getState();
    const trueBoard = agent.getTrueBoard();
    let safeIdx = -1;
    for (let i = 0; i < 25; i++) {
      if (!state.revealed[i] && !state.flagged[i] && !trueBoard.mines.has(i)) {
        safeIdx = i;
        break;
      }
    }

    if (safeIdx >= 0) {
      const result = agent.humanReveal(safeIdx);
      assert.equal(result.type, 'gamble');
      assert.ok(result.revealGroups, 'humanReveal に revealGroups があるべき');
      assert.equal(result.revealGroups.length, 1, 'humanReveal は1グループ');
      assert.equal(result.revealGroups[0].click, safeIdx, 'click == 指定index');
      assert.ok(result.revealGroups[0].opened.includes(safeIdx),
        'opened に click セルが含まれるべき');
      // revealGroups[0].opened == revealed
      assert.deepEqual(
        result.revealGroups[0].opened.slice().sort((a, b) => a - b),
        result.revealed.slice().sort((a, b) => a - b),
        'humanReveal: revealGroups[0].opened == revealed'
      );
    }
  });

  it('getGameElapsedMs が試行ごとにリセットされる', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 15,
      rng: seededRng(7),
    });

    // getGameElapsedMs が存在し 0 以上を返す
    assert.equal(typeof agent.getGameElapsedMs(), 'number');
    assert.ok(agent.getGameElapsedMs() >= 0, '初期は 0 以上');

    // boom まで進める
    let hasBoom = false;
    for (let i = 0; i < 500; i++) {
      const event = agent.step();
      if (event.type === 'boom') {
        hasBoom = true;
        break;
      }
      if (event.type === 'clear' || event.type === 'idle') break;
    }

    if (hasBoom) {
      // restart で内部リセット → getGameElapsedMs はほぼ 0 にリセット
      agent.step(); // restart イベント
      const afterRestart = agent.getGameElapsedMs();
      // リセット直後は数ms以内
      assert.ok(afterRestart < 100, `restart 後の gameElapsed=${afterRestart}ms は 100ms 未満であるべき`);
    }
  });

  it('aiJudgments は auto-gamble のみカウントし humanReveal はカウントしない', () => {
    const agent = createAgent({
      rows: 8,
      cols: 8,
      mineCount: 10,
      rng: seededRng(77),
    });

    // getAiJudgments API が存在する
    assert.equal(typeof agent.getAiJudgments(), 'number');
    assert.equal(agent.getAiJudgments(), 0, '初期値は0');

    // auto モードで gamble/boom まで進める
    let aiGambles = 0;
    const maxSteps = 200;
    for (let i = 0; i < maxSteps; i++) {
      const event = agent.step();
      if (event.type === 'gamble') {
        aiGambles++;
        assert.equal(agent.getAiJudgments(), aiGambles,
          `auto gamble #${aiGambles} 後の aiJudgments`);
      }
      if (event.type === 'boom') {
        aiGambles++; // boom もAIの判断
        assert.equal(agent.getAiJudgments(), aiGambles,
          'boom もAI判断としてカウント');
        break;
      }
      if (event.type === 'clear' || event.type === 'idle') break;
    }

    // humanReveal ではカウントが増えないことを確認
    // restart 後に humanReveal テスト
    if (agent.getPhase() === 'boom') {
      agent.step(); // restart
      agent.step(); // first — 盤面生成

      const judgmentsBefore = agent.getAiJudgments();
      const state = agent.getState();
      const trueBoard = agent.getTrueBoard();

      // 安全なセルを探す
      let safeIdx = -1;
      for (let i = 0; i < state.rows * state.cols; i++) {
        if (!state.revealed[i] && !state.flagged[i] && !trueBoard.mines.has(i)) {
          safeIdx = i;
          break;
        }
      }

      if (safeIdx >= 0) {
        agent.humanReveal(safeIdx);
        assert.equal(agent.getAiJudgments(), judgmentsBefore,
          'humanReveal 後に aiJudgments は増えない');
      }
    }
  });

  it('auto モード（既定）では await-human が出ない', () => {
    const agent = createAgent({
      rows: 5,
      cols: 5,
      mineCount: 3,
      rng: seededRng(42),
    });
    // gambleMode は既定の 'auto'

    let awaitFound = false;
    const maxSteps = 2000;
    for (let i = 0; i < maxSteps; i++) {
      const event = agent.step();
      if (event.type === 'await-human') {
        awaitFound = true;
        break;
      }
      if (event.type === 'clear' || event.type === 'idle') break;
    }

    assert.ok(!awaitFound, 'auto モードでは await-human が発生すべきでない');
  });

  it('deduce ステップ後に安全確定セルが残らない（旗で確定した空白は同一ステップで開く＝fixpoint）', () => {
    const seeds = [1, 7, 42, 123, 999, 2024];
    let deduceSteps = 0;
    let safeRemainingSteps = 0;

    for (const seed of seeds) {
      const agent = createAgent({ rows: 16, cols: 30, mineCount: 99, rng: seededRng(seed) });
      for (let i = 0; i < 400; i++) {
        const event = agent.step();
        if (event.type === 'clear' || event.type === 'idle') break;
        // クリア直前を除く deduce ステップでは、直後に確定安全セルが残っていないこと
        if (event.type === 'deduce' && agent.getPhase() !== 'clear') {
          deduceSteps++;
          const d = deduce(agent.getState());
          if (d.safe.length > 0) safeRemainingSteps++;
        }
      }
    }

    assert.ok(deduceSteps > 0, 'deduce ステップが少なくとも1回は発生すべき');
    assert.equal(safeRemainingSteps, 0,
      'deduce ステップ直後に確定安全セルが残ってはいけない（フラグ→確定空白は同一ステップで開く）');
  });
});
