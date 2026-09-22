<script setup lang="ts">
/** Real-3D backdrop for the hero: a slowly turning celestial sphere of survey tiles,
 *  a tilted footprint ring, and pointer parallax. Pauses off-screen and when the tab
 *  hides; renders a single still frame under prefers-reduced-motion. */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const host = ref<HTMLDivElement | null>(null)
let dispose: (() => void) | null = null

onMounted(async () => {
  const el = host.value
  if (!el || typeof window === 'undefined') return
  const THREE = await import('three')

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const starCount = coarse ? 1100 : 2600

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(el.clientWidth, el.clientHeight)
  renderer.domElement.className = 'hero-galaxy-canvas'
  el.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(52, el.clientWidth / Math.max(1, el.clientHeight), 0.1, 60)
  camera.position.set(0, 0.4, 7.2)

  const group = new THREE.Group()
  scene.add(group)

  // A round, soft sprite: PointsMaterial draws hard squares when it has no map.
  const starSprite = (() => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const g = canvas.getContext('2d')!
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.22, 'rgba(255,255,255,.92)')
    grad.addColorStop(0.5, 'rgba(255,255,255,.26)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
    return new THREE.CanvasTexture(canvas)
  })()

  // Survey sphere: tiles on the golden spiral. Starlight, so near-white — mostly a cool
  // white, a handful warm, nothing saturated.
  const positions = new Float32Array(starCount * 3)
  const colors = new Float32Array(starCount * 3)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const coolWhite = new THREE.Color('#cfe0ff')
  const white = new THREE.Color('#ffffff')
  const warmWhite = new THREE.Color('#ffe6c6')
  for (let i = 0; i < starCount; i += 1) {
    const y = 1 - (i / (starCount - 1)) * 2
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = golden * i
    const r = 3.1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.15
    positions[i * 3] = Math.cos(theta) * radiusAtY * r
    positions[i * 3 + 1] = y * r
    positions[i * 3 + 2] = Math.sin(theta) * radiusAtY * r
    const h = ((i * 9301 + 49297) % 233280) / 233280
    const color = h > 0.94 ? warmWhite : h > 0.6 ? white : coolWhite
    const dim = 0.42 + h * 0.5
    colors[i * 3] = color.r * dim
    colors[i * 3 + 1] = color.g * dim
    colors[i * 3 + 2] = color.b * dim
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const starMaterial = new THREE.PointsMaterial({ size: 0.075, map: starSprite, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
  group.add(new THREE.Points(starGeometry, starMaterial))

  // A brighter scatter of foreground stars for depth.
  const nearCount = Math.floor(starCount / 8)
  const nearPositions = new Float32Array(nearCount * 3)
  for (let i = 0; i < nearCount; i += 1) {
    nearPositions[i * 3] = (Math.sin(i * 78.233) * 43758.5453 % 1) * 10 - 5
    nearPositions[i * 3 + 1] = (Math.sin(i * 12.9898) * 24634.6345 % 1) * 6 - 3
    nearPositions[i * 3 + 2] = (Math.sin(i * 39.425) * 11279.8123 % 1) * 3 + 1
  }
  const nearGeometry = new THREE.BufferGeometry()
  nearGeometry.setAttribute('position', new THREE.BufferAttribute(nearPositions, 3))
  const nearMaterial = new THREE.PointsMaterial({ size: 0.05, map: starSprite, color: new THREE.Color('#eef4ff'), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
  scene.add(new THREE.Points(nearGeometry, nearMaterial))

  // Footprint rings: the survey's observing tracks around the sphere.
  const ringMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color('#5b7cff'), transparent: true, opacity: 0.34 })
  const ringMaterialWarm = new THREE.LineBasicMaterial({ color: new THREE.Color('#8fb0ff'), transparent: true, opacity: 0.16 })
  const makeRing = (radius: number, tiltX: number, tiltZ: number, material: InstanceType<typeof THREE.LineBasicMaterial>) => {
    const points: InstanceType<typeof THREE.Vector3>[] = []
    for (let i = 0; i <= 128; i += 1) {
      const angle = (i / 128) * Math.PI * 2
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
    }
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material)
    ring.rotation.x = tiltX
    ring.rotation.z = tiltZ
    group.add(ring)
    return ring
  }
  makeRing(3.5, Math.PI / 2.6, 0.25, ringMaterial)
  makeRing(3.72, Math.PI / 2.1, -0.42, ringMaterialWarm)
  makeRing(3.3, Math.PI / 3.4, 0.9, ringMaterial)

  group.rotation.z = 0.16
  group.position.x = 1.6

  let pointerX = 0
  let pointerY = 0
  const onPointer = (event: PointerEvent) => {
    pointerX = (event.clientX / window.innerWidth) * 2 - 1
    pointerY = (event.clientY / window.innerHeight) * 2 - 1
  }
  window.addEventListener('pointermove', onPointer, { passive: true })

  let running = !reduced
  let raf = 0
  const clock = new THREE.Clock()
  const renderFrame = () => {
    const elapsed = clock.getElapsedTime()
    group.rotation.y = elapsed * 0.05 + pointerX * 0.12
    group.rotation.x = Math.sin(elapsed * 0.11) * 0.05 + pointerY * 0.08
    renderer.render(scene, camera)
  }
  const loop = () => {
    if (!running) return
    renderFrame()
    raf = requestAnimationFrame(loop)
  }

  const visibility = new IntersectionObserver(entries => {
    const visible = entries.some(entry => entry.isIntersecting)
    if (reduced) return
    if (visible && !running) { running = true; loop() }
    if (!visible) { running = false; cancelAnimationFrame(raf) }
  }, { threshold: 0.05 })
  visibility.observe(el)
  const onHidden = () => {
    if (reduced) return
    if (document.hidden) { running = false; cancelAnimationFrame(raf) }
    else if (!running) { running = true; loop() }
  }
  document.addEventListener('visibilitychange', onHidden)

  const resize = new ResizeObserver(() => {
    renderer.setSize(el.clientWidth, el.clientHeight)
    camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
    camera.updateProjectionMatrix()
    if (reduced) renderFrame()
  })
  resize.observe(el)

  renderFrame()
  if (running) loop()

  dispose = () => {
    running = false
    cancelAnimationFrame(raf)
    visibility.disconnect()
    resize.disconnect()
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('pointermove', onPointer)
    starGeometry.dispose(); starMaterial.dispose(); starSprite.dispose()
    nearGeometry.dispose(); nearMaterial.dispose()
    ringMaterial.dispose(); ringMaterialWarm.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
})

onBeforeUnmount(() => dispose?.())
</script>

<template>
  <div ref="host" class="hero-galaxy" aria-hidden="true"></div>
</template>

<style scoped>
.hero-galaxy { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.hero-galaxy :deep(.hero-galaxy-canvas) { width: 100%; height: 100%; mix-blend-mode: screen; opacity: .92; }
</style>
