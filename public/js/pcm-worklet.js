// pcm-worklet.js - AudioWorklet processor for realtime PCM16 capture
// Runs in audio thread, captures Float32 samples, converts to PCM16, sends to main thread
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array(0)
    // Send ~100ms chunks at 16kHz = 1600 samples = 3200 bytes
    this._chunkSize = 1600
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true

    const samples = input[0] // Float32 mono
    // Accumulate
    const newBuf = new Float32Array(this._buffer.length + samples.length)
    newBuf.set(this._buffer)
    newBuf.set(samples, this._buffer.length)
    this._buffer = newBuf

    // Send complete chunks
    while (this._buffer.length >= this._chunkSize) {
      const chunk = this._buffer.slice(0, this._chunkSize)
      this._buffer = this._buffer.slice(this._chunkSize)

      // Convert Float32 [-1,1] to Int16
      const pcm16 = new Int16Array(chunk.length)
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]))
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }

      this.port.postMessage(pcm16.buffer, [pcm16.buffer])
    }

    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)