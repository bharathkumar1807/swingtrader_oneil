@echo off
start "SwingTrader Backend" cmd /k "cd /d d:\React\SwingTrader\backend\SwingTrader.API && dotnet run"
start "SwingTrader Frontend" cmd /k "cd /d d:\React\SwingTrader\frontend && npm run dev"
