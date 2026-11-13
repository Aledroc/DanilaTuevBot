@echo off
setlocal
set "MINIAPP_PORT=13859"
if not defined BOT_DATA_DIR set "BOT_DATA_DIR=%~dp0"
python "%~dp0mini_app.py"
