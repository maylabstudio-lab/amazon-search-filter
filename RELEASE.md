# 一般公開（Chrome ウェブストア）チェックリスト

`Amazon Search Filter` を Chrome ウェブストアで公開するための手順とメモ。

## 1. 収益化について

### Buy Me a Coffee（寄付） — 対応済み

- ポップアップとページ内パネルに `https://buymeacoffee.com/maylab` へのリンクがある。
- **拡張機能側のコードで必要な作業は「正しいユーザー名のリンクを開く」ことだけ**で、
  API キーや OAuth 連携は不要（Buy Me a Coffee はホスト型ページのため）。
- スラッグは `maylab` で確定（コードのリンクは `https://buymeacoffee.com/maylab`）。
- 実際に入金を受け取るために、開発者本人が buymeacoffee.com 側で次を済ませること:
  1. `maylab` のアカウント作成 / メール認証（スラッグが `maylab` になっているか確認）。
  2. Settings → Payouts で受取方法（Stripe 経由の銀行口座、または PayPal）を登録。
  3. 本人確認（KYC）が求められる場合は対応。
- ユーザー名を変える場合は `popup.html` と `content.js` のリンク、および本ファイルを更新する。

### Amazon アソシエイト（アフィリエイト） — v1 では無効

現在 `dictionary.js` の `ASSOCIATE_TAG = ""` で、検索URLに `tag` パラメータを付けていない。
掲載文・プライバシーポリシー・ポップアップからもアフィリエイトの記載を外してある。

**有効化の前に必ず確認すること（ブラウザ拡張機能には固有のリスクがある）:**

- Amazon アソシエイト・プログラム運営規約 / プログラム参加条件は、ソフトウェア・
  ブラウザ拡張機能・ツールバーからのリンク生成やタグ付与を制限・禁止する場合がある。
  拡張機能をリンク元として使う場合、事前に申請・承認が必要なことがある。
- ユーザーが明示的に指定していない検索に自動でタグを差し込む挙動は「リンクの
  改変・注入」とみなされ、アカウント停止の対象になりうる。
- Chrome ウェブストアのポリシーも、アフィリエイトコードの付与には
  「明確な開示」と「ユーザーにとっての利益」を求める。
- 参加を維持するには一定期間内に適格販売が必要。

→ 最新の「Amazonアソシエイト・プログラム運営規約」と「プログラム参加要件」を読み、
必要ならアソシエイト・カスタマーサービスに拡張機能での利用可否を確認してから、
トラッキングID を `ASSOCIATE_TAG` に設定する。あわせて開示表示を戻す
（`STORE_LISTING.md` / `PRIVACY_POLICY.md` / `popup.html`）。

## 2. 公開前チェックリスト

- [x] アイコン 16 / 32 / 48 / 128px（`icons/`、`manifest.json` に登録済み）
- [x] `manifest.json`: name / version / description（132字以内）/ 最小権限（`storage` のみ、`host_permissions` なし）
- [x] プレースホルダ値の排除（`ASSOCIATE_TAG` は空にして無効化）
- [x] プライバシーポリシーを公開URLで参照可能にする
      - ソース: `docs/index.html`（GitHub Pages 用）
      - 公開URL: `https://maylabstudio-lab.github.io/amazon-search-filter/`
      - 有効化: GitHub リポジトリの Settings → Pages → Source を「Deploy from a branch」、
        Branch を `main` / フォルダ `/docs` にして保存。数分後に上記URLで表示される。
      - `PRIVACY_POLICY.md` を更新したら `docs/index.html` も合わせて更新する。
- [ ] デベロッパー登録料 5 USD（初回のみ）の支払い
- [ ] ストア掲載情報の入力（`STORE_LISTING.md` の文面を使用）
  - [ ] カテゴリ: ショッピング / 言語: 日本語
  - [ ] スクリーンショット 1〜5 枚（1280×800 または 640×400）
        例: パネル展開時 / 検索結果で規約外を非表示にした状態 / ポップアップ
  - [ ] 小さいプロモタイル 440×280（任意）
- [ ] 「単一の目的」の記述（`STORE_LISTING.md` に記載）
- [ ] 権限の理由（`STORE_LISTING.md` の「権限の説明」）
- [ ] データ利用の申告（Developer Dashboard の Privacy タブ）
  - 収集データなし、販売なし、用途は該当なし、で申告
- [ ] 動作確認: 未パッケージ版 → `dist/amazon-search-filter.zip` を別プロファイルで読み込み

## 3. パッケージング

`scripts/package.sh` を実行すると、実行時に必要なファイルだけを
`dist/amazon-search-filter.zip` にまとめる（README や本ファイル、`scripts/` は除外）。

```sh
sh scripts/package.sh
```

## 4. アイコンの差し替え

`icons/icon.svg` を編集して `sh scripts/make-icons.sh` を実行すると
PNG 4 サイズを再生成する（macOS の `sips` を使用）。
