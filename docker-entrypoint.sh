#!/bin/sh
set -e

echo "==> Migratsiyalar ishga tushirilmoqda..."
node ./node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js

echo "==> Backend ishga tushirilmoqda..."
exec node dist/main.js
