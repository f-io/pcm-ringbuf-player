import { RingBuffer } from 'ringbuf.js'

const RENDER_QUANTUM_FRAMES = 128
const MAX_BLOCKS = 100

export class PcmPlayer {
  private workletName: string = 'pcm-worklet-processor'

  private context: AudioContext | undefined
  private gainNode: GainNode | undefined
  private channels: number
  private worklet: AudioWorkletNode | undefined
  private buffers: Int16Array[] = []
  private sab = new SharedArrayBuffer(
    RENDER_QUANTUM_FRAMES * Float32Array.BYTES_PER_ELEMENT * MAX_BLOCKS,
  )
  private rb = new RingBuffer(this.sab, Int16Array)

  constructor(sampleRate: number, channels: number) {
    this.context = new AudioContext({
      latencyHint: 'playback',
      sampleRate,
    })
    this.gainNode = this.context.createGain()
    this.gainNode.gain.value = 1
    this.gainNode.connect(this.context.destination)
    this.channels = channels
  }

  private feedWorklet(data: Int16Array) {
    this.rb.push(data)
  }

  getRawBuffer() {
    return this.sab
  }

  feed(source: Int16Array) {
    if (!this.worklet) {
      this.buffers.push(source)
      return
    }

    this.feedWorklet(source)
  }

  volume(volume: number, duration: number = 0) {
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(
        volume,
        this.context!.currentTime + duration,
        duration / 3,
      )
    }
  }

  async start() {
    if (!this.context || !this.gainNode) {
      throw Error(
        'Illegal state - context or gainNode not set - create a new PcmPlayer',
      )
    }

    const isDev =
      typeof import.meta !== 'undefined' &&
      typeof (import.meta as any).env !== 'undefined' &&
      !!(import.meta as any).env.DEV

    const workletURL = isDev
      ? '/audio.worklet.js'
      : new URL('./audio.worklet.js', import.meta.url).href;

    await this.context.audioWorklet.addModule(workletURL)

    this.worklet = new AudioWorkletNode(this.context, this.workletName, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [this.channels],
      processorOptions: {
        sab: this.sab,
        channels: this.channels,
      },
    })
    this.worklet.connect(this.gainNode)

    for (const source of this.buffers) {
      this.feedWorklet(source)
    }
    this.buffers.length = 0
  }

  async stop() {
    if (!this.context) return

    if (this.context.state !== 'closed') {
      await this.context.close()
    }
    this.gainNode?.disconnect()
    this.worklet?.disconnect()
    this.context = undefined
    this.gainNode = undefined
    this.worklet = undefined
  }
}
