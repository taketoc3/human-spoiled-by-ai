// js/i18n.mjs — 軽量自前 i18n（ビルド無し・完全オフライン・自己完結）
//
// 純モジュール: import 時に DOM / navigator / localStorage / location を触らない。
// すべてのブラウザ API アクセスは関数内で typeof guard 付き → node:test から安全に import できる。
//
// 設計: ロケール別テンプレート方式。助詞・語順・複数形（回 vs times / 秒 vs s）は
// 各言語の文字列が吸収する。専用の複数形エンジンは持たない（小規模ゆえ過剰）。

const STORAGE_KEY = 'ai-minesweeper-locale';
const DEFAULT_LOCALE = 'ja';
export const SUPPORTED = ['ja', 'en'];

// ============================================================================
// メッセージカタログ
//   - ja は現行のハードコード文字列を厳密に転記（日本語表示は完全に不変）
//   - en は mame 版アンサーの風刺ニュアンスを優先した意訳
//   - {placeholder} は t(key, params) で補間
// ============================================================================
export const MESSAGES = {
  ja: {
    // --- 思考ログ（agent.mjs） ---
    'log.restart': '↻ 再挑戦 #{n}',
    'log.clear': '✓ CLEAR ・判断{gambles}回 ・{time}',
    'log.firstZero': '初手。情報ゼロ。あなたが最初の一手を選ぶ。',
    'log.first': '初手 {coord} 地雷残{mines}',
    'log.deduce': '論理推論: {body}。',
    'log.deduceSep': '。',
    'log.deduceFlag': '地雷確定 {n} セルをフラグ',
    'log.deduceSafe': '安全確定 {n} セルを開放',
    'log.deduceProgress': '開放率 {pct}%',
    'log.stuck': '確定手なし。フロンティア {n} セル。あなたの番です。',
    'log.gambleBoom': '✗ 判断 {coord} 地雷残{mines} 確率{prob}%・{candidates}択 → 地雷',
    'log.gambleSafe': '◯ 判断 {coord} 地雷残{mines} 確率{prob}%・{candidates}択 → 安全',
    'log.humanFirst': '初手 あなた {coord} 地雷残{mines}',
    'log.alreadyOpen': 'そのセルは既に開放済みまたはフラグ済み。',
    'log.humanBoom': '✗ あなた {coord} 地雷残{mines} → 地雷',
    'log.humanSafe': '◯ あなた {coord} 地雷残{mines} → 安全',
    // 経過時間表記（agent.mjs CLEAR ログ）
    'time.ms': '{m}分{s}秒',
    'time.s': '{s}秒',

    // --- モード切替メッセージ（ui.mjs） ---
    'mode.on': 'モード → on-the-loop（判断はAI）',
    'mode.in': 'モード → in-the-loop（判断はあなた）',

    // --- 難易度ラベル（ui.mjs） ---
    'diff.label': '{name} {rows}×{cols}（{cells}マス／地雷{mines}）',
    'diff.none': '---（なし）',

    // --- タスク（ui.mjs） ---
    'task.start': '▶ タスク {idx}/{total}  {name} {rows}×{cols}・地雷{mines}',
    'task.itemDone': '✓ {name}  再試行{attempts} ／ 判断{judgments} ／ {time}',
    'task.itemActive': '▶ {name}  再試行{attempts} ／ 判断{judgments} ／ {time}',

    // --- クリアサマリ（ui.mjs） ---
    'clear.summary': '再試行 {attempts} 回 / 失敗 {failures} 回<br>判断 {gambles} 回 / 確定手 {deductions} 回<br>経過 {time}',

    // --- 業務レビュー（ui.mjs） ---
    'review.gambleAI': 'AIの判断',
    'review.gambleHuman': 'あなたの判断',
    'review.taskTitle': 'タスク内訳',
    'review.task': '{size}: 再試行{attempts} ／ 自動判断{judgments} ／ {time}',
    'review.summaryTitle': '集計',
    'review.failures': '失敗 (boom): {n} 回',
    'review.gambleCount': '{label}: {n} 回',
    'review.supervisorTime': '監督時間: {time}',
    'review.logTitle': '証跡（判断ログ）',
    'review.noLog': '（ログなし）',

    // --- 静的 UI: index.html ---
    'meta.description': 'AIが論理も運も全て引き受ける。人間はただ眺めるだけ。監督者という名の傍観者のためのマインスイーパー。',
    'meta.ogDescription': 'AIが論理も運も全て引き受ける。人間はただ眺めるだけ。',
    'wo.title': 'タスク指示書',
    'wo.tagline1': '🤔「考えるのは、私がやります」🎓',
    'wo.tagline2': '🎲「運試しも、私がやります」🍀',
    'wo.tagline3': '🥱「あなたは、ただ待つ係です。⏳',
    'wo.tagline4': '完了まで、別のタスクを進めておいてください」',
    'wo.about': 'タスクは上から順にクリアすると次へ進みます。',
    'wo.label': 'タスク',
    'wo.start': 'AIに任せる',
    'wo.cancel': '戻る（変更しない）',
    'console.status': '操作・監視中',
    'avatar.retries': '再試行:',
    'avatar.judgments': '判断:',
    'avatar.elapsed': '経過:',
    'avatar.modeHint': 'モード切替',
    'face.restart': 'リスタート',
    'ctrl.speed': '速度',
    'ctrl.thinkSpeed': '判断速度',
    'ctrl.letAIDecide': 'AIに判断を任せる',
    'ctrl.letAIDecideHint': '押し込み = on-the-loop（AIが判断）／解除 = in-the-loop（あなたが判断）',
    'ctrl.fastMode': '高速モード',
    'ctrl.autoScroll': 'オートスクロール',
    'ctrl.changeTasks': 'タスクを変更',
    'legend.title': '地雷確率ヒートマップ',
    'legend.safer': '安全寄り',
    'legend.riskier': '危険寄り',
    'cleared.replay': 'もう一度眺める',
    'reviewui.title': 'タスクレビュー',
    'reviewui.heading': '結果',
    'reviewui.newTasks': '新しいタスクを指示',
    'reviewui.retry': 'もう一度',
    'lang.toggle': 'EN',

    // --- 静的 UI: about.html ---
    'about.metaDescription': 'Human spoiled by AI について — mame『Minesweeper spoiled by AI』へのアンサー作品。コンセプト・クレジット・ライセンス。',
    'about.play': '▶ play',
    'about.h2.what': 'これは何か',
    'about.what.p1': 'AI が論理推論も確率的判断（運試し）も自律で行い、失敗しても自ら新しい盤面を生成して再挑戦するマインスイーパーです。人間に残るのは「監督」という名の手持ち無沙汰だけ。判断を引き取る切り替え（in-the-loop）はありますが、普段は出番がありません。',
    'about.what.p2': '2026年、運の判断すら AI に委ね、人間は監督すら手放しつつある——その風景を描く表現作品です。',
    'about.h2.answer': 'mame 版へのアンサー',
    'about.answer.p': '本作は <a href="https://mame.github.io/minesweeper-spoiled-by-ai/" target="_blank" rel="noopener">mame</a> 氏の『Minesweeper spoiled by AI』へのアンサー作品です。タイトルは一語だけ入れ替えた応答になっています（<i>Minesweeper</i> spoiled by AI → <i>Human</i> spoiled by AI）。',
    'about.answer.li1': '<b>human-in-the-loop（mame版）</b> — AI がヒントを出し、人間がクリックする。運も責任も人間が負う。',
    'about.answer.li2': '<b>human-on-the-loop（本作の建前）</b> — AI が論理も運も実行し、人間は監督するだけ。',
    'about.answer.li3': '<b>human-out-of-the-loop（本作の本音）</b> — 監督すら手放し、人間はただ待つ。「完了まで、別のタスクを進めておいてください」',
    'about.answer.note': 'mame 版は全権利留保のため、コード・CSS・HTML は一切流用していません（クリーンルーム実装）。Windows マインスイーパー風レトロピクセルの見た目は look-and-feel の自力再現です。',
    'about.h2.play': '遊び方',
    'about.play.li1': '<b>on-the-loop</b>（既定） — AI が運の判断まで自動で行う。あなたは眺めるだけ。',
    'about.play.li2': '<b>in-the-loop</b> — トグルで切り替えると、運試しの一手をあなたが選べる。',
    'about.play.li3': '<b>タスク指示書</b> — 難易度を上から順に指示。クリアで次へ進む。',
    'about.play.li4': '<b>高速モード</b> — 演出の余韻は残しつつ操作だけ高速化。',
    'about.h2.credit': 'クレジット',
    'about.credit.li1': '<b>着想元</b> — mame『Minesweeper spoiled by AI』（オマージュ・アンサー／コード非流用）',
    'about.credit.li2': '<b>アルゴリズム着想元</b> — <a href="https://www.ioccc.org/2020/endoh1/index.html" target="_blank" rel="noopener">IOCCC 2020 endoh1</a>（CC BY-SA 4.0）。本作ソルバーはその記述からの独自実装。',
    'about.credit.li3': '<b>フォント</b> — <a href="https://fonts.google.com/specimen/DotGothic16" target="_blank" rel="noopener">DotGothic16</a> / <a href="https://fonts.google.com/specimen/Press+Start+2P" target="_blank" rel="noopener">Press Start 2P</a>（SIL Open Font License）',
    'about.h2.license': 'ライセンス',
    'about.license.p': '本作の自作コードは <a href="LICENSE" target="_blank" rel="noopener">MIT License</a> の下で公開しています。',
    'about.nav.play': '▶ プレイする',
  },

  en: {
    // --- Thought log (agent.mjs) ---
    'log.restart': '↻ Retry #{n}',
    'log.clear': '✓ CLEAR · {gambles} gambles · {time}',
    'log.firstZero': 'First move. Zero information. You pick the opening cell.',
    'log.first': 'Open {coord} · {mines} mines left',
    'log.deduce': 'Deduction: {body}.',
    'log.deduceSep': '. ',
    'log.deduceFlag': 'flagged {n} confirmed-mine cells',
    'log.deduceSafe': 'opened {n} confirmed-safe cells',
    'log.deduceProgress': '{pct}% revealed',
    'log.stuck': 'No certain move. Frontier of {n} cells. Your turn.',
    'log.gambleBoom': '✗ Gamble {coord} · {mines} left · {prob}% over {candidates} cells → MINE',
    'log.gambleSafe': '◯ Gamble {coord} · {mines} left · {prob}% over {candidates} cells → SAFE',
    'log.humanFirst': 'Open (you) {coord} · {mines} mines left',
    'log.alreadyOpen': 'That cell is already opened or flagged.',
    'log.humanBoom': '✗ You {coord} · {mines} left → MINE',
    'log.humanSafe': '◯ You {coord} · {mines} left → SAFE',
    // Elapsed time (agent.mjs CLEAR log)
    'time.ms': '{m}m {s}s',
    'time.s': '{s}s',

    // --- Mode switch messages (ui.mjs) ---
    'mode.on': 'Mode → on-the-loop (the AI decides)',
    'mode.in': 'Mode → in-the-loop (you decide)',

    // --- Difficulty labels (ui.mjs) ---
    'diff.label': '{name} {rows}×{cols} ({cells} cells / {mines} mines)',
    'diff.none': '--- (none)',

    // --- Tasks (ui.mjs) ---
    'task.start': '▶ Task {idx}/{total}  {name} {rows}×{cols} · {mines} mines',
    'task.itemDone': '✓ {name}  retries {attempts} / picks {judgments} / {time}',
    'task.itemActive': '▶ {name}  retries {attempts} / picks {judgments} / {time}',

    // --- Clear summary (ui.mjs) ---
    'clear.summary': 'Retries {attempts} / Failures {failures}<br>Gambles {gambles} / Deductions {deductions}<br>Elapsed {time}',

    // --- Work review (ui.mjs) ---
    'review.gambleAI': "the AI's gambles",
    'review.gambleHuman': 'your gambles',
    'review.taskTitle': 'Task breakdown',
    'review.task': '{size}: retries {attempts} / auto-picks {judgments} / {time}',
    'review.summaryTitle': 'Summary',
    'review.failures': 'Failures (boom): {n}',
    'review.gambleCount': '{label}: {n}',
    'review.supervisorTime': 'Supervision time: {time}',
    'review.logTitle': 'Audit trail (decision log)',
    'review.noLog': '(no log)',

    // --- Static UI: index.html ---
    'meta.description': 'The AI takes on all the logic and all the luck. The human just watches. Minesweeper for the bystander who is called a supervisor.',
    'meta.ogDescription': 'The AI takes on all the logic and all the luck. The human just watches.',
    'wo.title': 'Work Order',
    'wo.tagline1': '🤔 "I\'ll do the thinking." 🎓',
    'wo.tagline2': '🎲 "I\'ll do the gambling too." 🍀',
    'wo.tagline3': '🥱 "Your job is just to wait. ⏳',
    'wo.tagline4': 'Go work on something else until it\'s done."',
    'wo.about': 'Clear the tasks top to bottom to advance.',
    'wo.label': 'Tasks',
    'wo.start': 'Leave it to the AI',
    'wo.cancel': 'Back (no change)',
    'console.status': 'Operating · Monitoring',
    'avatar.retries': 'Retries:',
    'avatar.judgments': 'Picks:',
    'avatar.elapsed': 'Elapsed:',
    'avatar.modeHint': 'Switch mode',
    'face.restart': 'Restart',
    'ctrl.speed': 'Speed',
    'ctrl.thinkSpeed': 'Decision',
    'ctrl.letAIDecide': 'Let the AI decide',
    'ctrl.letAIDecideHint': 'Pressed = on-the-loop (the AI decides) / released = in-the-loop (you decide)',
    'ctrl.fastMode': 'Fast mode',
    'ctrl.autoScroll': 'Auto-scroll',
    'ctrl.changeTasks': 'Change tasks',
    'legend.title': 'Mine probability heatmap',
    'legend.safer': 'Safer',
    'legend.riskier': 'Riskier',
    'cleared.replay': 'Watch again',
    'reviewui.title': 'Task Review',
    'reviewui.heading': 'Results',
    'reviewui.newTasks': 'Assign new tasks',
    'reviewui.retry': 'Once more',
    'lang.toggle': 'JA',

    // --- Static UI: about.html ---
    'about.metaDescription': 'About Human spoiled by AI — an answer to mame\'s "Minesweeper spoiled by AI". Concept, credits, license.',
    'about.play': '▶ play',
    'about.h2.what': 'What is this',
    'about.what.p1': 'A minesweeper where the AI performs both logical deduction and probabilistic judgment (gambling) on its own, and — when it fails — generates a fresh board and tries again by itself. All that is left for the human is the idleness called "supervising." There is a toggle to take the decision back (in-the-loop), but it rarely sees use.',
    'about.what.p2': 'In 2026, even the judgment of luck is handed to the AI, and the human is letting go of even supervision — this piece depicts that scenery.',
    'about.h2.answer': 'An answer to mame\'s version',
    'about.answer.p': 'This work is an answer to <a href="https://mame.github.io/minesweeper-spoiled-by-ai/" target="_blank" rel="noopener">mame</a>\'s "Minesweeper spoiled by AI." The title is a response with a single word swapped (<i>Minesweeper</i> spoiled by AI → <i>Human</i> spoiled by AI).',
    'about.answer.li1': '<b>human-in-the-loop (mame\'s version)</b> — the AI gives hints, the human clicks. The human bears both the luck and the blame.',
    'about.answer.li2': '<b>human-on-the-loop (this work\'s pretext)</b> — the AI runs both logic and luck; the human merely supervises.',
    'about.answer.li3': '<b>human-out-of-the-loop (this work\'s true feeling)</b> — even supervision is let go; the human just waits. "Go work on something else until it\'s done."',
    'about.answer.note': "Because mame's version reserves all rights, none of its code, CSS, or HTML is reused (a clean-room implementation). The Windows-minesweeper retro-pixel look is an independent recreation of its look-and-feel.",
    'about.h2.play': 'How to play',
    'about.play.li1': '<b>on-the-loop</b> (default) — the AI even makes the luck decisions automatically. You just watch.',
    'about.play.li2': '<b>in-the-loop</b> — flip the toggle and you get to pick the gambling move yourself.',
    'about.play.li3': '<b>Work order</b> — assign difficulties top to bottom. Clearing one advances to the next.',
    'about.play.li4': '<b>Fast mode</b> — keeps the afterglow of the effects while speeding up only the operations.',
    'about.h2.credit': 'Credits',
    'about.credit.li1': '<b>Inspiration</b> — mame, "Minesweeper spoiled by AI" (homage / answer, no code reused)',
    'about.credit.li2': '<b>Algorithm inspiration</b> — <a href="https://www.ioccc.org/2020/endoh1/index.html" target="_blank" rel="noopener">IOCCC 2020 endoh1</a> (CC BY-SA 4.0). This solver is an independent implementation from its description.',
    'about.credit.li3': '<b>Fonts</b> — <a href="https://fonts.google.com/specimen/DotGothic16" target="_blank" rel="noopener">DotGothic16</a> / <a href="https://fonts.google.com/specimen/Press+Start+2P" target="_blank" rel="noopener">Press Start 2P</a> (SIL Open Font License)',
    'about.h2.license': 'License',
    'about.license.p': 'The original code of this work is released under the <a href="LICENSE" target="_blank" rel="noopener">MIT License</a>.',
    'about.nav.play': '▶ Play',
  },
};

// ============================================================================
// 状態・API
// ============================================================================
let currentLocale = DEFAULT_LOCALE;
const listeners = new Set();

/** 言語コードを SUPPORTED の base（'ja'/'en'）へ正規化。対象外なら null */
function normalize(lang) {
  if (!lang) return null;
  const base = String(lang).toLowerCase().split('-')[0];
  return SUPPORTED.includes(base) ? base : null;
}

/** メッセージ取得＋{placeholder}補間。未定義キーは ja フォールバック → 最後は key 自身 */
export function t(key, params) {
  const table = MESSAGES[currentLocale] || MESSAGES[DEFAULT_LOCALE];
  let str = table[key];
  if (str == null) str = MESSAGES[DEFAULT_LOCALE][key];
  if (str == null) return key;
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (m, name) =>
      (params[name] != null ? String(params[name]) : m)
    );
  }
  return str;
}

export function getLocale() {
  return currentLocale;
}

/** ロケールを設定し localStorage に永続化、購読者へ通知 */
export function setLocale(loc) {
  const norm = normalize(loc) || (SUPPORTED.includes(loc) ? loc : null);
  if (!norm) return currentLocale;
  currentLocale = norm;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, norm);
  } catch { /* localStorage 不可環境は無視 */ }
  for (const cb of listeners) {
    try { cb(norm); } catch { /* 個別購読者の失敗は他へ波及させない */ }
  }
  return currentLocale;
}

/** ロケール変更購読。解除関数を返す */
export function onLocaleChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 優先順位: ?lang= → localStorage → navigator.language → 既定(ja) */
export function detectLocale() {
  // 1. ?lang= クエリ（永続化しない一時上書き）
  try {
    if (typeof location !== 'undefined' && location.search) {
      const m = /[?&]lang=([a-zA-Z-]+)/.exec(location.search);
      const q = m && normalize(m[1]);
      if (q) return q;
    }
  } catch { /* ignore */ }
  // 2. localStorage（手動トグルの記憶）
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    }
  } catch { /* ignore */ }
  // 3. navigator.language（自動検出）
  try {
    if (typeof navigator !== 'undefined') {
      const nav = normalize(navigator.language || (navigator.languages && navigator.languages[0]));
      if (nav) return nav;
    }
  } catch { /* ignore */ }
  return DEFAULT_LOCALE;
}

/** detectLocale を現在ロケールへ適用（永続化はしない）。ブラウザ起動時に1回呼ぶ */
export function initLocale() {
  currentLocale = detectLocale();
  return currentLocale;
}
