$log = "C:\Users\ERICK\Documents\Control de Inventario\asistencia-inteligente\backend\scripts\firewall-result.txt"
try {
  Remove-NetFirewallRule -DisplayName "Asistencia Inteligente (3000, 3443)" -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "Asistencia Inteligente (3000, 3443)" -Direction Inbound -Protocol TCP -LocalPort 3000,3443 -Action Allow -Profile Any -ErrorAction Stop | Out-Null
  "OK $(Get-Date -Format o)" | Set-Content -Path $log -Encoding UTF8
} catch {
  "ERROR: $($_.Exception.Message)" | Set-Content -Path $log -Encoding UTF8
}
