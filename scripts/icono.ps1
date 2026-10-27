# Dibuja el ícono de Habla Agéntica: círculo morado con una onda de voz blanca.
# Uso: powershell -NoProfile -File scripts/icono.ps1
Add-Type -AssemblyName System.Drawing

function Dibujar([int]$tam, [string]$salida) {
    $bmp = New-Object System.Drawing.Bitmap $tam, $tam
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.RectangleF 0, 0, $tam, $tam
    $c1 = [System.Drawing.ColorTranslator]::FromHtml('#8B5CF6')
    $c2 = [System.Drawing.ColorTranslator]::FromHtml('#6D28D9')
    $fondo = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 45
    $g.FillEllipse($fondo, 0, 0, $tam - 1, $tam - 1)

    $blanco = [System.Drawing.Brushes]::White
    $alturas = @(0.22, 0.42, 0.62, 0.42, 0.22)
    $ancho = $tam * 0.085
    $sep = $tam * 0.065
    $total = 5 * $ancho + 4 * $sep
    $x = ($tam - $total) / 2
    foreach ($h in $alturas) {
        $alto = $tam * $h
        $y = ($tam - $alto) / 2
        $ruta = New-Object System.Drawing.Drawing2D.GraphicsPath
        $r = $ancho
        $ruta.AddArc($x, $y, $r, $r, 180, 180)
        $ruta.AddArc($x, $y + $alto - $r, $r, $r, 0, 180)
        $ruta.CloseFigure()
        $g.FillPath($blanco, $ruta)
        $x += $ancho + $sep
    }
    $g.Dispose()
    $bmp.Save($salida, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$dir = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force $dir | Out-Null
Dibujar 256 (Join-Path $dir 'icono.png')
Dibujar 32 (Join-Path $dir 'bandeja.png')
