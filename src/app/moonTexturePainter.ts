export function* paintMoonTexture(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
  let seed = 7241
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  ctx.fillStyle = '#aaa9a5'; ctx.fillRect(0, 0, 2048, 1024)
  for (let i = 0; i < 18000; i++) {
    const x = random() * 2048, y = random() * 1024, r = 1 + random() * (i < 120 ? 95 : 9)
    const gradient = ctx.createRadialGradient(x - r * .2, y - r * .2, 0, x, y, r)
    gradient.addColorStop(0, 'rgba(45,44,43,.25)')
    gradient.addColorStop(.75, 'rgba(70,69,67,.18)')
    gradient.addColorStop(.9, 'rgba(226,224,216,.28)')
    gradient.addColorStop(1, 'rgba(160,159,154,0)')
    ctx.fillStyle = gradient; ctx.fillRect(x-r, y-r, r*2, r*2)
    if (i % 128 === 0) yield
  }
}
