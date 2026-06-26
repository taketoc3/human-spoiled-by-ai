// js/about.mjs — about ページの i18n ブートストラップ
// detectLocale を適用して静的 DOM を反映し、JA/EN トグルを配線する。
import { setupI18n, wireLangToggles } from './i18n-dom.mjs';

setupI18n();
wireLangToggles();
