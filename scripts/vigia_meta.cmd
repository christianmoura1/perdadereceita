@echo off
cd /d C:\projetos\perdadereceita
"C:\Program Files\nodejs\node.exe" scripts\vigia_meta.cjs >> "C:\projetos\perdadereceita\logs\vigia_meta_task.log" 2>&1
exit /b %ERRORLEVEL%