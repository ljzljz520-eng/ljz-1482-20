export function createSmallWavFile(seconds = 1, frequency = 440) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples * 2, true);

  for (let i = 0; i < samples; i += 1) {
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.18;
    view.setInt16(44 + i * 2, value * 32767, true);
  }
  return new File([buffer], `smoke-test-${Date.now()}.wav`, { type: "audio/wav" });
}
