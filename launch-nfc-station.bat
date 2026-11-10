@echo off
title Inventory Tracker Equipment Checkout Kiosk
echo ===================================================
echo   Inventory Tracker Equipment Checkout - Dedicated Laptop Kiosk
echo ===================================================
echo.
echo Launching Equipment Checkout in dedicated app window...

:: Target URL - change this if your site is hosted on a remote server/domain
set STATION_URL=http://localhost:3000/dashboard/nfc

:: Launch in Microsoft Edge application mode
start msedge.exe --app=%STATION_URL%
if %ERRORLEVEL% neq 0 (
  start chrome.exe --app=%STATION_URL%
)

exit
