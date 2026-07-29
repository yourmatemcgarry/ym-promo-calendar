#!/bin/bash
# Double-click this file to start the Beer Pricing Strategy tool.
cd "$(dirname "$0")"
PORT=8642
echo "Starting local server on http://localhost:$PORT ..."
( sleep 1 && open "http://localhost:$PORT/index.html" ) &
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  python -m SimpleHTTPServer "$PORT"
else
  echo "Python was not found. Please install Python 3, or open index.html via any other local web server."
  read -p "Press Enter to exit..."
fi
