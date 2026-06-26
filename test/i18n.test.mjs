// test/i18n.test.mjs — i18n カタログ・補間・フォールバック・ロケール制御
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGES, SUPPORTED, t, getLocale, setLocale, onLocaleChange, detectLocale,
} from '../js/i18n.mjs';

test('ja と en のキー集合が完全一致する', () => {
  const jaKeys = Object.keys(MESSAGES.ja).sort();
  const enKeys = Object.keys(MESSAGES.en).sort();
  const onlyJa = jaKeys.filter((k) => !(k in MESSAGES.en));
  const onlyEn = enKeys.filter((k) => !(k in MESSAGES.ja));
  assert.deepEqual(onlyJa, [], `en に欠けているキー: ${onlyJa}`);
  assert.deepEqual(onlyEn, [], `ja に欠けているキー: ${onlyEn}`);
});

test('全 en 値にプレースホルダの取り残しが無い（{xxx} が ja と同一集合）', () => {
  const ph = (s) => (s.match(/\{(\w+)\}/g) || []).sort();
  for (const key of Object.keys(MESSAGES.ja)) {
    assert.deepEqual(ph(MESSAGES.en[key]), ph(MESSAGES.ja[key]), `プレースホルダ不一致: ${key}`);
  }
});

test('t() は {placeholder} を補間する', () => {
  setLocale('ja');
  assert.equal(t('log.restart', { n: 3 }), '↻ 再挑戦 #3');
  assert.equal(t('log.first', { coord: '(0,0)', mines: 10 }), '初手 (0,0) 地雷残10');
});

test('t() は未定義キーでキー自身を返す', () => {
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('t() は現在ロケールに無いキーを ja へフォールバックする', () => {
  // 一時的に en からキーを退避
  const k = '__fallback_probe__';
  MESSAGES.ja[k] = 'ja値';
  setLocale('en');
  assert.equal(t(k), 'ja値');
  delete MESSAGES.ja[k];
  setLocale('ja');
});

test('setLocale でロケール切替・getLocale が反映', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('mode.on'), 'Mode → on-the-loop (the AI decides)');
  setLocale('ja');
  assert.equal(getLocale(), 'ja');
  assert.equal(t('mode.on'), 'モード → on-the-loop（判断はAI）');
});

test('setLocale は未対応ロケールを無視する', () => {
  setLocale('ja');
  setLocale('fr');
  assert.equal(getLocale(), 'ja');
});

test('onLocaleChange が変更時に発火し、解除できる', () => {
  let got = null;
  const off = onLocaleChange((loc) => { got = loc; });
  setLocale('en');
  assert.equal(got, 'en');
  off();
  setLocale('ja');
  assert.equal(got, 'en'); // 解除後は更新されない
});

test('detectLocale は SUPPORTED のいずれかを返す', () => {
  assert.ok(SUPPORTED.includes(detectLocale()));
});
