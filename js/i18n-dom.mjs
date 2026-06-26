// js/i18n-dom.mjs — ブラウザ専用 i18n ランタイム（DOM 静的文字列の差し替え）
//
// data-i18n="key"            → element.textContent = t(key)
// data-i18n-html="key"       → element.innerHTML  = t(key)（<a>/<i> 等を含むリッチ文字列）
// data-i18n-attr="attr:key"  → element.setAttribute(attr, t(key))（複数は ; 区切り）
//
// HTML 側の初期テキストは日本語のまま残す = キー欠落でも崩れないフォールバック。

import { t, getLocale, setLocale, onLocaleChange, initLocale } from './i18n.mjs';

/** root 配下の data-i18n* を現在ロケールで適用。root=document のとき <html lang> も更新 */
export function applyI18n(root = document) {
  const scope = root.querySelectorAll ? root : document;

  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });

  scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const idx = pair.indexOf(':');
      if (idx < 0) return;
      const attr = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });

  // ドキュメント全体に適用したときは <html lang> を現在ロケールへ
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('lang', getLocale());
  }
}

/**
 * i18n 起動: detectLocale を適用 → 静的 DOM を反映 → 以降のロケール変更で自動再反映。
 * onChange を渡すと、各ロケール変更時（静的反映の後）に追加で呼ばれる（動的文字列の再描画用）。
 */
export function setupI18n({ onChange } = {}) {
  initLocale();
  onLocaleChange(() => {
    applyI18n(document);
    if (onChange) onChange(getLocale());
  });
  applyI18n(document);
  return getLocale();
}

/** 単一の JA/EN トグルボタンを配線。ラベルは data-i18n="lang.toggle" 側で更新される */
export function wireLangToggle(el) {
  if (!el) return;
  el.addEventListener('click', () => {
    setLocale(getLocale() === 'ja' ? 'en' : 'ja');
  });
}

/** root 配下の [data-lang-toggle] をすべて配線（モーダル内とフッターなど複数箇所対応） */
export function wireLangToggles(root = document) {
  const scope = root.querySelectorAll ? root : document;
  scope.querySelectorAll('[data-lang-toggle]').forEach((el) => wireLangToggle(el));
}
