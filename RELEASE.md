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

### Amazon アソシエイト（アフィリエイト） — 有効化済み（ストアID: `maylab-22`）

`dictionary.js` の `ASSOCIATE_TAG = "maylab-22"` を設定済み。ユーザーがポップアップ／
ページ内パネルの検索欄から検索を実行したときに生成する検索URLにのみ `tag` パラメータを
付与する（既存ページや自動で開くリンクへは差し込まない）。開示表示は
`popup.html` の `.affiliate-note` と、ページ内パネルの `.asf-affiliate-note`
（`content.js` / `content.css`）、および `STORE_LISTING.md` / `PRIVACY_POLICY.md` /
`docs/index.html` に記載済み。

**参加を維持するために継続して確認すること:**

- Amazon アソシエイト・プログラム運営規約 / プログラム参加条件（ブラウザ拡張機能からの
  リンク生成・タグ付与に関する制限）は改定されることがあるため、定期的に見直す。
- ユーザーが明示的に指定していない検索へ自動でタグを差し込まないこと（現状の実装を維持）。
- 参加を維持するには一定期間内に適格販売が必要。

## 2. 公開前チェックリスト

- [x] アイコン 16 / 32 / 48 / 128px（`icons/`、`manifest.json` に登録済み）
- [x] `manifest.json`: name / version / description（132字以内）/ 最小権限（`storage` のみ、`host_permissions` なし）
- [x] `ASSOCIATE_TAG` にアソシエイトのストアID（`maylab-22`）を設定
- [x] プライバシーポリシーを公開URLで参照可能にする
      - ソース: `docs/index.html`（GitHub Pages 用）
      - 公開URL: `https://maylabstudio-lab.github.io/amazon-search-filter/`
      - 有効化: GitHub リポジトリの Settings → Pages → Source を「Deploy from a branch」、
        Branch を `main` / フォルダ `/docs` にして保存。数分後に上記URLで表示される。
      - `PRIVACY_POLICY.md` を更新したら `docs/index.html` も合わせて更新する。
- [x] デベロッパー登録料 5 USD（初回のみ）の支払い
- [x] パブリッシャーの連絡先メールアドレスの入力と**メール認証**
      （アイテム編集画面ではなく Developer Dashboard の「設定 → アカウント」。
      入力して保存するだけでは不十分で、認証メールのリンクを踏むまで公開できない）
- [x] EEA 取引業者ステータスの申告（非取引業者を選択。`STORE_LISTING.md` 参照）
- [x] ストア掲載情報の入力（`STORE_LISTING.md` の文面を使用）
  - [x] カテゴリ: ショッピング / 言語: 日本語
  - [x] ストアのアイコン 128×128（zip の manifest からは自動反映されないため手動アップロードが必要）
  - [x] スクリーンショット 1280×800 を 2 枚（`dist/screenshots/`）
        パネル表示時 / ポップアップ表示時
  - [ ] 小さいプロモタイル 440×280（任意・未対応）
- [x] 「単一の目的」の記述（`STORE_LISTING.md` に記載）
- [x] 権限の理由（`storage` とホスト権限の両方。`STORE_LISTING.md` に提出文面を保存）
- [x] リモートコード不使用の申告（`STORE_LISTING.md` 参照）
- [x] データ利用の申告（収集データなし、表明チェック3つ）
- [x] プライバシーポリシー URL の入力
- [x] 販売地域の設定
- [x] **審査のために送信**（v1.3.0）
- [ ] 動作確認: 公開後に別プロファイルの Chrome でストア版をインストールして確認

## 2-1. 審査通過後にやること

- [ ] ストアの公開 URL を `README.md` に追記
- [ ] 別プロファイルの Chrome で公開版をインストールし、パネル・ポップアップ・
      Buy Me a Coffee リンクの動作を確認
- [ ] Buy Me a Coffee 側で入金導線が機能するか確認

## 3. パッケージング

`scripts/package.sh` を実行すると、実行時に必要なファイルだけを
`dist/amazon-search-filter.zip` にまとめる（README や本ファイル、`scripts/` は除外）。

```sh
sh scripts/package.sh
```

## 4. アイコンの差し替え

`icons/icon.svg` を編集して `sh scripts/make-icons.sh` を実行すると
PNG 4 サイズを再生成する（macOS の `sips` を使用）。
