# ============================================================
# 生成 Firefox 版本：把源码复制到 dist-firefox/，并把
# manifest.firefox.json 替换为 manifest.json
# ============================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist-firefox"
if (Test-Path -LiteralPath $dist) {
  $resolvedDist = (Resolve-Path -LiteralPath $dist).Path
  $resolvedRoot = (Resolve-Path -LiteralPath $root).Path
  if ($resolvedDist.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedDist -Recurse -Force
  }
}
New-Item -ItemType Directory -Path $dist | Out-Null
Get-ChildItem -LiteralPath $root -Force | Where-Object {
  # ⚠️ user-defaults.js 必须排除：里面有真实身份证号/手机号/邮箱，
  # 一起打包出去就等于公开个人档案（README 里教的是「加载已解压的扩展程序」，不依赖 zip）。
  $_.Name -notin @("dist-firefox", "build-firefox.ps1", "manifest.firefox.json", "user-defaults.js", ".git")
} | Copy-Item -Destination $dist -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "manifest.firefox.json") -Destination (Join-Path $dist "manifest.json") -Force
Write-Host "Firefox version built: $dist"