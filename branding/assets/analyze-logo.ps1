Add-Type -AssemblyName System.Drawing
$src = "c:\Users\greadings\!VS Code\Open Apiary\openapiary\Images\Open Apiary Logo.png"
$bmp = New-Object System.Drawing.Bitmap($src)
$w = $bmp.Width; $h = $bmp.Height
Write-Host "Size: $w x $h"

# Corner + center samples
$pts = @{
  'TL(2,2)'      = @(2,2)
  'TL-in(60,60)' = @(60,60)
  'center'       = @([int]($w/2),[int]($h/2))
  'TR'           = @($w-3,2)
  'BL'           = @(2,$h-3)
  'BR'           = @($w-3,$h-3)
}
foreach($k in $pts.Keys){
  $p=$pts[$k]; $c=$bmp.GetPixel($p[0],$p[1])
  "{0,-14} A={1,3} R={2,3} G={3,3} B={4,3}" -f $k,$c.A,$c.R,$c.G,$c.B
}

# Sample a grid: alpha min/max, luminance histogram buckets
$aMin=255;$aMax=0
$buckets = New-Object 'int[]' 8
$step = 6
$nonopaque = 0; $total = 0
for($y=0;$y -lt $h;$y+=$step){
  for($x=0;$x -lt $w;$x+=$step){
    $c=$bmp.GetPixel($x,$y)
    if($c.A -lt $aMin){$aMin=$c.A}; if($c.A -gt $aMax){$aMax=$c.A}
    if($c.A -lt 250){$nonopaque++}
    $lum=[int](0.299*$c.R+0.587*$c.G+0.114*$c.B)
    $bi=[Math]::Min(7,[int]($lum/32)); $buckets[$bi]++
    $total++
  }
}
Write-Host "`nAlpha range: $aMin .. $aMax  (non-opaque samples: $nonopaque / $total)"
Write-Host "Luminance histogram (0..255 in 8 buckets):"
for($i=0;$i -lt 8;$i++){ "  {0,3}-{1,3}: {2}" -f ($i*32),($i*32+31),$buckets[$i] }
$bmp.Dispose()
