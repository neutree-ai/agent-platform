import { spawn } from 'node:child_process'

/**
 * Decode any audio container (webm/opus, amr, mp3, m4a, ...) into a uniform
 * wav 16k mono buffer. All ASR providers accept this; clients don't need to
 * know what the active provider expects.
 */
export async function transcodeToWav16kMono(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-f',
      'wav',
      'pipe:1',
    ])

    const out: Buffer[] = []
    const err: Buffer[] = []
    ff.stdout.on('data', (c) => out.push(c))
    ff.stderr.on('data', (c) => err.push(c))
    ff.on('error', reject)
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString('utf8')}`))
        return
      }
      resolve(Buffer.concat(out))
    })

    ff.stdin.on('error', reject)
    ff.stdin.end(input)
  })
}
