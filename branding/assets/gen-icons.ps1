Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = "c:\Users\greadings\!VS Code\Open Apiary\openapiary"
$src  = Join-Path $root "Images\Open Apiary Logo (transparent).png"
$logoDir = Join-Path $root "branding\assets\logo"
$iconDir = Join-Path $logoDir "icons"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

# Brand cream background (honey-50) so the black line-art logo stays visible on any chrome.
$bg = [System.Drawing.Color]::FromArgb(255, 0xFF, 0xF8, 0xE6)

$source = [System.Drawing.Image]::FromFile($src)

function New-Icon([int]$size, [double]$pad, [string]$outPath, [bool]$transparent = $false) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    if ($transparent) { $g.Clear([System.Drawing.Color]::Transparent) } else { $g.Clear($bg) }
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $avail = $size * $pad
    $ratio = [Math]::Min($avail / $source.Width, $avail / $source.Height)
    $w = $source.Width * $ratio
    $h = $source.Height * $ratio
    $x = ($size - $w) / 2
    $y = ($size - $h) / 2
    $g.DrawImage($source, $x, $y, $w, $h)
    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# Standard square icons (cream bg). Small sizes get less padding for legibility.
New-Icon 16   0.94 (Join-Path $iconDir "favicon-16x16.png")
New-Icon 32   0.94 (Join-Path $iconDir "favicon-32x32.png")
New-Icon 48   0.92 (Join-Path $iconDir "favicon-48x48.png")
New-Icon 64   0.90 (Join-Path $iconDir "icon-64.png")
New-Icon 180  0.86 (Join-Path $iconDir "apple-touch-icon.png")
New-Icon 192  0.86 (Join-Path $iconDir "icon-192.png")
New-Icon 256  0.86 (Join-Path $iconDir "icon-256.png")
New-Icon 512  0.86 (Join-Path $iconDir "icon-512.png")
New-Icon 1024 0.86 (Join-Path $iconDir "icon-1024.png")
# Maskable (Android adaptive / PWA): content kept inside the ~60% safe zone.
New-Icon 512  0.60 (Join-Path $iconDir "maskable-512.png")
# Transparent master square (for theming / native asset pipelines)
New-Icon 1024 0.86 (Join-Path $logoDir "openapiary-icon-source.png") $true

# Also keep a copy of the original wide master in the logo folder.
Copy-Item $src (Join-Path $logoDir "openapiary-logo.png") -Force

$source.Dispose()

# ---- Build favicon.ico (PNG-in-ICO, sizes 16/32/48) ----
$icoSizes = 16, 32, 48
$pngBytes = @()
foreach ($s in $icoSizes) {
    $p = Join-Path $iconDir ("favicon-{0}x{0}.png" -f $s)
    if (-not (Test-Path $p)) { $p = Join-Path $iconDir "favicon-48x48.png" }
    $pngBytes += , ([System.IO.File]::ReadAllBytes($p))
}
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)            # reserved
$bw.Write([uint16]1)            # type = icon
$bw.Write([uint16]$icoSizes.Count)
$offset = 6 + (16 * $icoSizes.Count)
for ($i = 0; $i -lt $icoSizes.Count; $i++) {
    $s = $icoSizes[$i]
    $b = $pngBytes[$i]
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))  # width
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))  # height
    $bw.Write([byte]0)   # color count
    $bw.Write([byte]0)   # reserved
    $bw.Write([uint16]1) # planes
    $bw.Write([uint16]32) # bit count
    $bw.Write([uint32]$b.Length)
    $bw.Write([uint32]$offset)
    $offset += $b.Length
}
foreach ($b in $pngBytes) { $bw.Write($b) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $iconDir "favicon.ico"), $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

Write-Host "=== Generated files ==="
Get-ChildItem $iconDir | ForEach-Object { "{0,-24} {1,7:N1} KB" -f $_.Name, ($_.Length/1KB) }
Get-ChildItem $logoDir -File | ForEach-Object { "{0,-30} {1,7:N1} KB" -f $_.Name, ($_.Length/1KB) }

# ---- Contrast ratios for LIGHT theme finalization ----
function Lum([int]$r,[int]$g,[int]$b){
  $f={param($v) $v=$v/255; if($v -le 0.03928){$v/12.92}else{[Math]::Pow(($v+0.055)/1.055,2.4)}}
  0.2126*(&$f $r)+0.7152*(&$f $g)+0.0722*(&$f $b)
}
function CR($c1,$c2){
  $L1=Lum $c1[0] $c1[1] $c1[2]; $L2=Lum $c2[0] $c2[1] $c2[2]
  $hi=[Math]::Max($L1,$L2); $lo=[Math]::Min($L1,$L2)
  [Math]::Round(($hi+0.05)/($lo+0.05),2)
}
$surface1 = @(0xFF,0xF8,0xE6) # honey-50
$base     = @(0xFF,0xFD,0xF7)
Write-Host "`n=== LIGHT contrast vs surface-1 #fff8e6 ==="
$cands = @{
  'text #1a1410'        = @(0x1A,0x14,0x10)
  'muted #5e523c'       = @(0x5E,0x52,0x3C)
  'subtle #8a7b5e'      = @(0x8A,0x7B,0x5E)
  'subtle alt #6e6047'  = @(0x6E,0x60,0x47)
  'honey-400 #f5a91f'   = @(0xF5,0xA9,0x1F)
  'honey-600 #a96809'   = @(0xA9,0x68,0x09)
  'honey-700 #774905'   = @(0x77,0x49,0x05)
  'success #7fb069'     = @(0x7F,0xB0,0x69)
  'danger #e5484d'      = @(0xE5,0x48,0x4D)
}
foreach($k in $cands.Keys){ "{0,-22} {1}:1" -f $k, (CR $cands[$k] $surface1) }
Write-Host "ink on honey-400 button: $((CR @(0x14,0x10,0x0C) @(0xF5,0xA9,0x1F)))" ":1"
