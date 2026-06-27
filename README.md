# Human spoiled by AI

*human-in → on → out of the loop*

AIが論理推論も確率的判断も自律で行い、失敗しても自ら新しい盤面を生成して再挑戦する。
人間は監督者として眺めるだけ — 判断を引き取る切り替え（in-the-loop）はあるが、普段は出番がない。

## コンセプト

本作は [mame](https://github.com/mame) 氏の [Minesweeper spoiled by AI](https://mame.github.io/minesweeper-spoiled-by-ai/) へのアンサー作品です。タイトルも一語だけ入れ替えた応答になっています（*Minesweeper* spoiled by AI → *Human* spoiled by AI）。

- **human-in-the-loop（mame版）**: AIがヒントを出し、人間がクリックする — 運も責任も人間が負う
- **human-on-the-loop（本作の建前）**: AIが論理も運も実行し、人間は監督するだけ
- **human-out-of-the-loop（本作の本音）**: 監督すら手放し、人間はただ待つ — 「完了まで、別のタスクを進めておいてください」

2026年、運の判断すらAIに委ね、人間は監督すら手放しつつある — その風景を描く表現作品。

> mame版は全権利留保のため、コード・CSS・HTMLは一切流用していません（クリーンルーム実装）。
> 見た目の「Windowsマインスイーパー風レトロピクセル」は look-and-feel の自力再現です。

## クレジット

- **着想元**: mame「Minesweeper spoiled by AI」— オマージュ・アンサー（コード非流用）
- **アルゴリズム着想元**: [IOCCC 2020 endoh1](https://www.ioccc.org/2020/endoh1/index.html) (CC BY-SA 4.0) — 本作ソルバーはその記述からの独自実装
- **フォント**: [DotGothic16](https://fonts.google.com/specimen/DotGothic16) / [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) — SIL Open Font License

## ライセンス

本リポジトリの自作コードは [MIT License](./LICENSE) の下で公開しています。

Copyright (c) 2026 taketoc3 (notdefine-soft)

## 開発

```bash
# テスト実行（node:test）
npm test

# ローカル起動（ES module 配信のため HTTP サーバーが必要）
npm run serve
# → http://localhost:8080 でアクセス

# file:// プロトコルでは ES module の import が動作しません
```

## リンク

- [notdefine-soft](https://notdefine.com/links/)
- [プレイする（GitHub Pages）](https://taketoc3.github.io/human-spoiled-by-ai/)
