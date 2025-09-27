概要
- Webサイト用のアンケートフォーム（静的）と、投稿データをGoogleスプレッドシートに保存するGASバックエンドの雛形です。
- 既存ファイルは一切変更していません。すべて `Fmtg` 配下に新規追加しています。

構成
- `index.html` フロント(UI)本体。`config.json` を読み込み、フォームを動的生成します。
- `styles.css` UIスタイル（ベース）。
- `app.js` バリデーションと送信処理。CORSプリフライトを避けるために `application/x-www-form-urlencoded` で送信します。
- `config.example.json` 設定テンプレート（この内容を `config.json` にコピーして編集）。
- `gas/Code.gs` Google Apps Script バックエンド。`doPost` で受信しスプレッドシートへ追記します。
- `gas/README.md` GASのデプロイ手順と環境設定。（プロパティ：`SHEET_ID`/`SHEET_NAME`/`TOKEN`/`ALLOWED_ORIGINS`）

導入手順（フロント）
1) `config.example.json` を `config.json` にコピーし、`gasEndpoint` と `token`、フォーム項目を編集。
2) ブラウザで `index.html` を開き、フォームが期待どおりか確認。

導入手順（GAS）
1) Googleドライブで新規スプレッドシートを作成し、IDを控える（URLの `/d/` と `/edit` の間）。
2) Google Apps Script で新規プロジェクトを作成し、`gas/Code.gs` の中身を貼り付け。
3) スクリプトプロパティを設定：`SHEET_ID`、`SHEET_NAME`（例: `Responses`）、`TOKEN`（ランダム文字列）、`ALLOWED_ORIGINS`（カンマ区切りの許可オリジン）。
4) デプロイ > ウェブアプリ > 実行するユーザー: 自分、アクセスできるユーザー: 全員（匿名含む）に設定してデプロイし、発行URLを `config.json` の `gasEndpoint` に設定。
5) スプレッドシートの1行目（ヘッダー）に、`config.json` の `fields[].id` を列名として用意すると、順序を維持して追記されます（ヘッダー未設定時は最初の投稿時に自動生成されます）。

運用のポイント
- 機密保護: `TOKEN` を使用し、クライアントからも送信。GAS側で一致検証。
- CORS: GASレスポンスで `Access-Control-Allow-Origin` を返却。`ALLOWED_ORIGINS` に許可元を列挙。
- バリデーション: `config.json` の `validation` に沿ってフロント側で実施。GAS側でも必須項目チェック可。

パラメータ（config.json）例
- `siteName`: 表示名
- `gasEndpoint`: WebアプリURL
- `token`: GASの `TOKEN` と一致させる値
- `form.title`/`form.description`
- `form.fields[]`: { id, label, type, required, placeholder, options[], validation }

注意
- この雛形は既存物に影響しないよう独立しています。要件が確定したら `config.json` を編集するだけでUIや必須項目を差し替えできます。

