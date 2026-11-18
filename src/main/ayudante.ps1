# Ayudante de Habla Agéntica: un proceso persistente que responde peticiones
# JSON (una por línea) por stdin/stdout.
#   {"id":1,"cmd":"proceso"}   -> nombre del proceso de la ventana activa
#   {"id":2,"cmd":"silenciar"} -> silencia la salida de audio (recuerda el estado previo)
#   {"id":3,"cmd":"restaurar"} -> vuelve al estado de audio previo
#   {"id":4,"cmd":"teclas","codigos":[54,3613]} -> cuáles de esas teclas están presionadas
#   {"id":5,"cmd":"texto"}     -> texto del campo con el foco (null si no se puede leer)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class HablaTeclado {
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
    // Recibe códigos de uiohook (scan codes; 0x0Exx = tecla extendida) y
    // devuelve los que están físicamente presionados.
    public static int[] Abajo(int[] codigos) {
        var res = new System.Collections.Generic.List<int>();
        foreach (var c in codigos) {
            uint sc = (uint)(c & 0xFF);
            if ((c & 0xFF00) == 0x0E00) sc |= 0xE000;
            uint vk = MapVirtualKey(sc, 3); // MAPVK_VSC_TO_VK_EX
            if (c == 3675) vk = 0x5B; // Win izq
            if (c == 3676) vk = 0x5C; // Win der
            if (vk != 0 && (GetAsyncKeyState((int)vk) & 0x8000) != 0) res.Add(c);
        }
        return res.ToArray();
    }
}

public static class HablaVentana {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public static uint PidActivo() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid;
    }
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float level, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    int GetMasterVolumeLevel(out float level);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float level, ref Guid ctx);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid ctx);
    int GetChannelVolumeLevel(uint channel, out float level);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public static class HablaAudio {
    static IAudioEndpointVolume Volumen() {
        var enumerador = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
        IMMDevice dispositivo;
        Marshal.ThrowExceptionForHR(enumerador.GetDefaultAudioEndpoint(0, 1, out dispositivo));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        Marshal.ThrowExceptionForHR(dispositivo.Activate(ref iid, 23, IntPtr.Zero, out o));
        return (IAudioEndpointVolume)o;
    }
    public static bool EstaSilenciado() {
        bool m;
        Marshal.ThrowExceptionForHR(Volumen().GetMute(out m));
        return m;
    }
    public static void Silenciar(bool mute) {
        Guid ctx = Guid.Empty;
        Marshal.ThrowExceptionForHR(Volumen().SetMute(mute, ref ctx));
    }
}
'@

$estadoPrevio = $null
$uiaCargado = $false
$MAX_TEXTO = 20000

# Texto del campo que tiene el foco, leído por UI Automation (para que la app
# vea qué corrigió el usuario y aprenda). Devuelve $null si el campo no lo
# deja leer o es de contraseña.
function Leer-TextoEnfocado {
    if (-not $script:uiaCargado) {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $script:uiaCargado = $true
    }
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $el -or $el.Current.IsPassword) { return $null }
    $texto = $null
    $tp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
        $texto = $tp.DocumentRange.GetText($MAX_TEXTO)
    } else {
        $vp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $texto = $vp.Current.Value }
    }
    if ($texto -and $texto.Length -gt $MAX_TEXTO) { $texto = $texto.Substring(0, $MAX_TEXTO) }
    return $texto
}

while ($true) {
    $linea = [Console]::In.ReadLine()
    if ($null -eq $linea) { break }
    if ($linea.Trim() -eq '') { continue }
    $id = $null
    try {
        $peticion = $linea | ConvertFrom-Json
        $id = $peticion.id
        $valor = $null
        switch ($peticion.cmd) {
            'proceso' {
                $proceso = Get-Process -Id ([HablaVentana]::PidActivo()) -ErrorAction SilentlyContinue
                $valor = if ($proceso) { $proceso.ProcessName } else { '' }
            }
            'teclas' {
                $valor = @([HablaTeclado]::Abajo([int[]]@($peticion.codigos)))
            }
            'silenciar' {
                if ($null -eq $estadoPrevio) { $estadoPrevio = [HablaAudio]::EstaSilenciado() }
                [HablaAudio]::Silenciar($true)
            }
            'restaurar' {
                if ($null -ne $estadoPrevio) { [HablaAudio]::Silenciar($estadoPrevio); $estadoPrevio = $null }
            }
            'texto' {
                $valor = Leer-TextoEnfocado
            }
            default { throw "Comando desconocido: $($peticion.cmd)" }
        }
        $respuesta = @{ id = $id; ok = $true; valor = $valor }
    } catch {
        $respuesta = @{ id = $id; ok = $false; valor = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($respuesta | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
