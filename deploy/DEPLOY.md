# PCG Deck Builder — 本番デプロイ手順
#
# 配置先: /data/www/PCGDeckBuilder
# URL:    https://sapotona.jp/DeckBuilder

## 1. ディレクトリ構成

```
/data/www/PCGDeckBuilder/
  web/                 # server.py, index.html, css/, js/
  data/                # regulation JSON, banned_cards.json, admin_secret.txt
  output/              # cards.json など
  deploy/              # このフォルダの設定例
```

リポジトリの `web` / `data` / `output` をそのままコピーしてください。
`web/_probe_*.py` は本番では不要です。

## 2. 必須ファイル

- `output/cards.json`
- `output/card_limits.json`
- `output/card_format_legal.json`（あれば）
- `data/regulation_formats.json`
- `data/set_regulation_map.json`
- `data/standard_trainer_whitelist.json`
- `data/banned_cards.json`
- `data/admin_secret.txt`（管理者パスワード1行）

実行ユーザが `data/` と `output/` に書き込めること（画像キャッシュ・禁止カード保存）。

## 3. アプリ起動（systemd）

```bash
sudo cp /data/www/PCGDeckBuilder/deploy/pcg-deckbuilder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pcg-deckbuilder
sudo systemctl status pcg-deckbuilder
```

環境変数:

| 変数 | 値 |
|------|-----|
| `POKECA_BASE_PATH` | `/DeckBuilder` |
| `POKECA_COOKIE_SECURE` | `1`（HTTPS 時） |
| `POKECA_ADMIN_PASSWORD` | 任意（未設定なら admin_secret.txt） |

手動起動例:

```bash
cd /data/www/PCGDeckBuilder
export POKECA_BASE_PATH=/DeckBuilder
export POKECA_COOKIE_SECURE=1
python3 web/server.py --host 127.0.0.1 --port 8080
```

## 4. nginx

`deploy/nginx-deckbuilder.conf` をサイト設定に include、または内容を既存の
`sapotona.jp` server ブロックへ追記。

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. 確認 URL

- デッキビルダー: https://sapotona.jp/DeckBuilder/
- 禁止カード管理: https://sapotona.jp/DeckBuilder/admin.html

## 6. ローカル開発

`POKECA_BASE_PATH` を付けなければ従来どおり `http://127.0.0.1:8080/` で動作します。
