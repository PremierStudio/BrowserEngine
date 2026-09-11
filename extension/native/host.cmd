@echo off
rem Chrome starts this with a minimal PATH. Use the node on PATH.
node "%~dp0..\nativeHost.js" %*
