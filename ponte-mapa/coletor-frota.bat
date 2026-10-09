@echo off
setlocal enableextensions
title Coletor Frota SAMU+ (ponte)

REM ===========================================================================
REM  coletor-frota.bat  —  sobe a ponte Mapa SAMU+ -> Painel Frota (magalu)
REM
REM  Como instalar (usuario comum, sem admin):
REM    1) Node 18+ instalado (checar: abrir cmd e digitar  node -v ).
REM       Instalar o Node e o unico passo que pede admin.
REM    2) Esta maquina na VPN que abre  http://172.23.130.87/dashmapa/mapa
REM    3) Colar o TOKEN abaixo (ou definir por  setx PONTE_TOKEN "...").
REM    4) Atalho deste .bat na pasta de inicializacao:
REM         tecla Windows+R  ->  shell:startup  ->  colar atalho.
REM       Sobe sozinho quando este usuario faz logon.
REM
REM  Frequencia: este .bat NAO dispara a cada minuto. Ele sobe o Node UMA vez;
REM  o Node fica rodando e puxa+envia a cada 60s (INTERVALO_MS). O loop abaixo
REM  so reergue o Node se ele cair.
REM ===========================================================================

cd /d "%~dp0"

REM ===== CONFIG ==============================================================
set "ORIGEM=http://172.23.130.87/dashmapa/mapa/refresh_maps_equipes"
set "DESTINO=https://mnrs.com.br/tabela/api/frota/mapa-ingest"
set "INTERVALO_MS=60000"

REM TOKEN de envio. Preferir definir fora do arquivo (uma vez, no cmd):
REM     setx PONTE_TOKEN "o-token-que-o-caio-passou"
REM e deixar a linha abaixo como esta. Se preferir no arquivo, troque o valor.
if not defined PONTE_TOKEN set "PONTE_TOKEN=COLE_O_TOKEN_AQUI"
set "TOKEN=%PONTE_TOKEN%"

REM Opcionais (descomentar para ligar):
REM set "PROTOCOLO_HASH=1"
REM set "ENVIAR_BAIRRO=1"
REM ==========================================================================

set "LOG=%~dp0coletor-frota.log"

REM --- checagens antes de comecar ---
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node nao encontrado no PATH. Instalar Node 18+ ^(https://nodejs.org^).
  echo [ERRO] Node nao encontrado em %date% %time% >> "%LOG%"
  echo.
  pause
  exit /b 1
)

if "%TOKEN%"=="COLE_O_TOKEN_AQUI" (
  echo [ERRO] TOKEN nao configurado. Definir  setx PONTE_TOKEN "..."  ou editar o .bat.
  echo [ERRO] token ausente em %date% %time% >> "%LOG%"
  echo.
  pause
  exit /b 1
)

echo Coletor Frota: lendo %ORIGEM%
echo               enviando a %DESTINO% a cada %INTERVALO_MS% ms
echo               log em %LOG%
echo (feche esta janela para parar)
echo.

:loop
echo [%date% %time%] iniciando coletor... >> "%LOG%"
REM stdout e stderr do Node vao para o log (linhas tecnicas, sem paciente).
node "%~dp0coletor-frota.mjs" >> "%LOG%" 2>&1
echo [%date% %time%] coletor parou (codigo %errorlevel%). Reiniciando em 15s... >> "%LOG%"
timeout /t 15 /nobreak >nul
goto loop
