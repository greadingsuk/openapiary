Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

# Two-channel key that preserves BOTH logo elements and strips only the neutral
# gray/white checkerboard Gemini baked in as fake transparency:
#   * DARK pixels (lum)      -> the bee line-art, rendered in brand ink.
#   * WARM pixels (R-B)      -> the tan "OA" letters + hexagons, rendered in a
#                               visible brand honey (original tan ~195,182,167
#                               is too pale to read on a cream icon background).
#   * neutral light (checker/white/cream) -> transparent.
# Color analysis: bee lum<=90; tan elements R-B 20-39; checkerboard R-B 0-9.

$srcPath = "c:\Users\greadings\!VS Code\Open Apiary\openapiary\Images\Open Apiary Logo.png"
$outPath = "c:\Users\greadings\!VS Code\Open Apiary\openapiary\Images\Open Apiary Logo (transparent).png"

# Bee (dark) keying
$darkLo = 80.0   # <= => fully opaque bee
$darkHi = 120.0  # >= => not bee (ramp between for anti-aliased edges)
# Bee ink (text-primary #1a1410)
$inkR = 0x1A; $inkG = 0x14; $inkB = 0x10

# Warm (tan OA/hex) keying on warmth = R - B
$warmLo = 16.0       # >= => starts counting as a warm logo element
$warmHi = 30.0       # >= => fully opaque warm element
$warmLumMax = 240.0  # ignore near-white warm pixels (cream highlights)
# Honey tone the OA/hexagons are rendered in (honey-600, reads on cream)
$honR = 0xA9; $honG = 0x68; $honB = 0x09
$warmAlphaMax = 235  # cap so OA/hex sit as a tasteful tint behind the bee

$src = New-Object System.Drawing.Bitmap($srcPath)
$w = $src.Width; $h = $src.Height
$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)

# Ensure 32bpp ARGB working copy
$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, 0, 0, $w, $h)
$g.Dispose()
$src.Dispose()

$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object 'byte[]' ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

$darkRange = $darkHi - $darkLo
$warmRange = $warmHi - $warmLo
for ($y = 0; $y -lt $h; $y++) {
    $row = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
        $i = $row + $x * 4   # BGRA
        $b = $bytes[$i]; $gr = $bytes[$i+1]; $r = $bytes[$i+2]
        $lum = 0.299 * $r + 0.587 * $gr + 0.114 * $b
        $warm = $r - $b

        # bee alpha (dark)
        if ($lum -le $darkLo) { $da = 255.0 }
        elseif ($lum -ge $darkHi) { $da = 0.0 }
        else { $da = 255.0 * (($darkHi - $lum) / $darkRange) }

        # warm element alpha (tan -> honey)
        $wa = 0.0
        if ($warm -ge $warmLo -and $lum -le $warmLumMax -and $lum -gt $darkLo) {
            if ($warm -ge $warmHi) { $wa = [double]$warmAlphaMax }
            else { $wa = $warmAlphaMax * (($warm - $warmLo) / $warmRange) }
        }

        if ($da -ge $wa) {
            $bytes[$i]   = [byte]$inkB
            $bytes[$i+1] = [byte]$inkG
            $bytes[$i+2] = [byte]$inkR
            $bytes[$i+3] = [byte][int]$da
        } else {
            $bytes[$i]   = [byte]$honB
            $bytes[$i+1] = [byte]$honG
            $bytes[$i+2] = [byte]$honR
            $bytes[$i+3] = [byte][int]$wa
        }
    }
}
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$bmp.UnlockBits($data)

# Crop to the bee's bounding box (trim the empty transparent margin)
$minX = $w; $minY = $h; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $h; $y++) {
    $row = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
        if ($bytes[$row + $x * 4 + 3] -gt 16) {
            if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
$pad = 24
$minX = [Math]::Max(0, $minX - $pad); $minY = [Math]::Max(0, $minY - $pad)
$maxX = [Math]::Min($w - 1, $maxX + $pad); $maxY = [Math]::Min($h - 1, $maxY + $pad)
$cw = $maxX - $minX + 1; $ch = $maxY - $minY + 1
Write-Host "Bee bounding box: ($minX,$minY) $cw x $ch (from $w x $h)"

$crop = New-Object System.Drawing.Bitmap($cw, $ch, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gc = [System.Drawing.Graphics]::FromImage($crop)
$gc.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)),
    $minX, $minY, $cw, $ch, [System.Drawing.GraphicsUnit]::Pixel)
$gc.Dispose()
$bmp.Dispose()

$crop.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()
Write-Host "Saved transparent master -> $outPath"
