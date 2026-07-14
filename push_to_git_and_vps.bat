@echo off
echo ========================================================
echo  StreamFlow Git Update & Deploy Script
echo ========================================================
echo.

:: Clean up temporary files
if exist vps_ip.txt del vps_ip.txt
if exist git_status.txt del git_status.txt

:: Stage all the modified files
echo [1/3] Staging changes...
git add app.js services/streamingService.js services/youtubeService.js services/rotationService.js views/login.ejs
if %ERRORLEVEL% neq 0 (
    echo Error staging files. Make sure you are in a git repository.
    pause
    exit /b %ERRORLEVEL%
)

:: Commit changes
echo [2/3] Committing changes...
git commit -m "Fix stream connection issues: ffprobe exit close race, rotationStream undefined, and sanitize youtube tags"
if %ERRORLEVEL% neq 0 (
    echo Error committing changes or nothing to commit.
    pause
    exit /b %ERRORLEVEL%
)

:: Push to GitHub
echo [3/3] Pushing to GitHub...
git push origin master
if %ERRORLEVEL% neq 0 (
    echo Warning: Failed to push to origin master. Trying current branch...
    git push origin HEAD
)

echo.
echo ========================================================
echo  GitHub Push Complete!
echo ========================================================
echo.
echo To deploy directly to your VPS via SSH, run:
echo.
echo   ssh root@38.147.122.151 "cd ~/streamflow && git pull && ~/.local/share/pnpm/pm2 restart all"
echo.
pause
