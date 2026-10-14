// Reference rectangular layout. Other screen shapes need their own adaptation.
export function createLayout(width = 390, height = 450) {
  const sx = width / 390
  const sy = height / 450
  return {
    rect: (x, y, w, h) => ({ x: Math.round(x * sx), y: Math.round(y * sy), w: Math.round(w * sx), h: Math.round(h * sy) }),
    font: size => Math.round(size * Math.min(sx, sy))
  }
}
