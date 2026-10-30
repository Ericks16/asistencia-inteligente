$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$certDir = Join-Path $root 'backend\certs'
$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction Stop |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress)
$password = ConvertTo-SecureString 'asistencia123' -AsPlainText -Force

$ca = New-SelfSignedCertificate `
  -Type Custom `
  -Subject 'CN=Asistencia Inteligente LAN CA' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -KeyUsage CertSign, CRLSign, DigitalSignature `
  -TextExtension @('2.5.29.19={text}CA=true&pathlength=1') `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddYears(5)

$server = New-SelfSignedCertificate `
  -Type Custom `
  -Subject "CN=$ip" `
  -Signer $ca `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -TextExtension @('2.5.29.17={text}IPAddress=' + $ip + '&DNS=localhost', '2.5.29.19={text}CA=false') `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddYears(2)

Export-Certificate -Cert $ca -FilePath (Join-Path $certDir 'asistencia-lan-ca.cer') -Type CERT | Out-Null
Export-PfxCertificate -Cert $server -FilePath (Join-Path $certDir 'server.pfx') -Password $password -Force | Out-Null

Write-Host "Certificado HTTPS creado para https://$ip`:3443"
Write-Host "Instala en Android este archivo como certificado de CA:"
Write-Host (Join-Path $certDir 'asistencia-lan-ca.cer')
