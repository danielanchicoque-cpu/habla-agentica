// Convierte el audio grabado (webm/opus) a WAV de 16 kHz, mono, 16 bits: el
// formato que pide whisper.cpp. Corre en la pastilla porque ahí está el
// decodificador de audio de Chromium.

// Muestras (Float32 de -1 a 1) → archivo WAV como ArrayBuffer.
function codificarWav(muestras, hz) {
  const bytes = muestras.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const v = new DataView(buffer);
  const texto = (pos, s) => { for (let i = 0; i < s.length; i++) v.setUint8(pos + i, s.charCodeAt(i)); };
  texto(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  v.setUint32(16, 16, true); // tamaño del bloque fmt
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, hz, true);
  v.setUint32(28, hz * 2, true); // bytes por segundo
  v.setUint16(32, 2, true); // bytes por muestra
  v.setUint16(34, 16, true); // bits
  texto(36, 'data');
  v.setUint32(40, bytes, true);
  for (let i = 0; i < muestras.length; i++) {
    const m = Math.max(-1, Math.min(1, muestras[i]));
    v.setInt16(44 + i * 2, m < 0 ? m * 0x8000 : m * 0x7fff, true);
  }
  return buffer;
}

// Audio grabado → WAV 16 kHz mono. El contexto a 16 kHz hace que el
// decodificador remuestree solo.
async function aWav16k(arrayBuffer) {
  const HZ = 16000;
  const ctx = new AudioContext({ sampleRate: HZ });
  try {
    const audio = await ctx.decodeAudioData(arrayBuffer);
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const canal = audio.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += canal[i] / audio.numberOfChannels;
    }
    return codificarWav(mono, audio.sampleRate);
  } finally {
    ctx.close();
  }
}

if (typeof module !== 'undefined') module.exports = { codificarWav };
