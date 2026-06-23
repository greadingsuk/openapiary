Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

# Classify the original logo by darkness vs warm-saturation so we can tell the
# tan OA letters / hexagons apart from the neutral gray-white checkerboard.

$srcPath = "c:\Users\greadings\!VS Code\Open Apiary\openapiary\Images\Open Apiary Logo.png"
$src = New-Object System.Drawing.Bitmap($srcPath)
$w = $src.Width; $h = $src.Height
$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.DrawImage($src, 0, 0, $w, $h); $g.Dispose(); $src.Dispose()
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object 'byte[]' ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data); $bmp.Dispose()

# Categories
$dark = 0          # bee: lum <= 90
$warmMid = 0       # tan OA/hex: lum 90..230 AND warm (R-B >= 25)
$neutralLight = 0  # checkerboard/white/cream: lum > 90 and not warm
$other = 0
# accumulate warm-mid average colour
$wr = 0.0; $wg = 0.0; $wb = 0.0
$step = 4
for ($y = 0; $y -lt $h; $y += $step) {
    $row = $y * $stride
    for ($x = 0; $x -lt $w; $x += $step) {
        $i = $row + $x * 4
        $b = $bytes[$i]; $gr = $bytes[$i+1]; $r = $bytes[$i+2]
        $lum = 0.299 * $r + 0.587 * $gr + 0.114 * $b
        $warm = $r - $b
        if ($lum -le 90) { $dark++ }
        elseif ($warm -ge 25 -and $lum -le 235) { $warmMid++; $wr += $r; $wg += $gr; $wb += $b }
        elseif ($lum -gt 90) { $neutralLight++ }
        else { $other++ }
    }
}
$total = $dark + $warmMid + $neutralLight + $other
Write-Host "Sampled (step $step): $total px"
Write-Host "  dark (bee, lum<=90):        $dark"
Write-Host "  warm-mid (tan OA/hex):      $warmMid"
Write-Host "  neutral light (checker/cream): $neutralLight"
Write-Host "  other:                      $other"
if ($warmMid -gt 0) {
    Write-Host ("  warm-mid avg RGB: {0},{1},{2}" -f [int]($wr/$warmMid), [int]($wg/$warmMid), [int]($wb/$warmMid))
}

# warmth histogram for light pixels (lum>90): how many at each R-B band
$bands = New-Object 'int[]' 8   # 0-9,10-19,... 70+
for ($y = 0; $y -lt $h; $y += $step) {
    $row = $y * $stride
    for ($x = 0; $x -lt $w; $x += $step) {
        $i = $row + $x * 4
        $b = $bytes[$i]; $gr = $bytes[$i+1]; $r = $bytes[$i+2]
        $lum = 0.299 * $r + 0.587 * $gr + 0.114 * $b
        if ($lum -gt 90) {
            $warm = [Math]::Max(0, $r - $b)
            $bi = [Math]::Min(7, [int]($warm / 10))
            $bands[$bi]++
        }
    }
}
Write-Host "Warmth (R-B) histogram for light pixels (lum>90):"
for ($k = 0; $k -lt 8; $k++) {
    $lo = $k * 10; $hi = if ($k -eq 7) { '+' } else { ($lo + 9).ToString() }
    Write-Host ("  {0,2}-{1,-3}: {2}" -f $lo, $hi, $bands[$k])
}
