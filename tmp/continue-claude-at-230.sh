#!/bin/zsh
set -u

LOG="/private/tmp/claude-continue-231.log"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*" >> "$LOG"
}

now_epoch="$(date +%s)"
today="$(date '+%Y-%m-%d')"
target_epoch="$(date -j -f '%Y-%m-%d %H:%M:%S' "$today 02:31:00" '+%s')"

if [ "$target_epoch" -le "$now_epoch" ]; then
  target_epoch="$((target_epoch + 86400))"
fi

sleep_seconds="$((target_epoch - now_epoch))"
target_readable="$(date -r "$target_epoch" '+%Y-%m-%d %H:%M:%S %Z')"

log "scheduled for $target_readable; sleeping ${sleep_seconds}s"
sleep "$sleep_seconds"
log "wake; sending continue to Claude Terminal tabs"

osascript >> "$LOG" 2>&1 <<'APPLESCRIPT'
set targetTTYs to {"/dev/ttys000", "/dev/ttys002", "/dev/ttys004"}
set sentCount to 0

tell application "Terminal"
  repeat with targetTTY in targetTTYs
    set foundTab to false
    repeat with w in windows
      repeat with t in tabs of w
        if (tty of t as text) is (targetTTY as text) then
          set foundTab to true
          set procNames to processes of t
          if procNames contains "claude" then
            do script "continue" in t
            set sentCount to sentCount + 1
            delay 0.3
          else
            log "skip " & (targetTTY as text) & "; processes=" & (procNames as text)
          end if
        end if
      end repeat
    end repeat
    if foundTab is false then
      log "missing " & (targetTTY as text)
    end if
  end repeat
end tell

return "sent=" & sentCount
APPLESCRIPT

log "done"
