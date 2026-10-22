#!/bin/sh
# monta o jogo para distribuir: o executável + assets (com as músicas, efeitos e vozes da versão web)
#   pacote/empacotar.sh <executável> <pasta de saída> [mac]
set -eu
cd "$(dirname "$0")/.."
exe="$1"; out="$2"; kind="${3:-}"
rm -rf "$out"; mkdir -p "$out"
if [ "$kind" = mac ]; then
  app="$out/Laboratorio Antipoda.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp "$exe" "$app/Contents/MacOS/portal3"
  cp pacote/Info.plist "$app/Contents/Info.plist"
  res="$app/Contents/Resources"
else
  cp "$exe" "$out/"
  res="$out"
fi
cp -R assets "$res/assets"
for d in music sfx vozes; do cp -R "../public/$d" "$res/assets/$d"; done
echo "pacote em $out"
