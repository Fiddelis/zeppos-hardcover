import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

// Small original raster assets, generated without image tooling or downloaded art.
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}
function png(w, h, pixel) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rgb = pixel(x / w, y / h)
    const offset = y * (w * 3 + 1) + 1 + x * 3
    rgb.forEach((channel, i) => { raw[offset + i] = channel })
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const folder = new URL('../assets/bip6/', import.meta.url)
mkdirSync(folder, { recursive: true })
writeFileSync(new URL('cover-fallback.png', folder), png(130, 180, (x, y) => {
  if (x < .08) return [238, 180, 95]
  if (x > .25 && x < .8 && ((y > .2 && y < .24) || (y > .29 && y < .32) || (y > .38 && y < .41))) return [174, 184, 196]
  return [36, 48, 61]
}))
