#!/bin/bash
# Newpot Bot Startup Script
# Restarts bot on crash, starts on reboot

NAME="newpot-bot"
DIR="/home/jasper/newpot-bot"
LOG="/tmp/newpot-bot.log"
PID_FILE="/tmp/newpot-bot.pid"

cd $DIR

# Load env
set -a
[ -f .env ] && source .env
set +a

# Start bot
node bot.js >> $LOG 2>&1 &
echo $! > $PID_FILE
echo "[$(date)] Started newpot-bot PID $(cat $PID_FILE)"
