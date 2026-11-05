/** 3D 员工协作空间（Three.js，MIT）——真实 WebGL 建模，不是 CSS 假 3D。

 *  设计要点：
 *   - 数据驱动：`setMembers([{name, role, status, task}])` 重建人物；状态决定颜色（working 青、meeting 琥珀、idle 灰、remote 虚化）；
 *   - 主题一致：颜色取自页面 CSS 变量（--cyan/--green/--amber/--dim），风格与全息 HUD 统一；
 *   - 兼容替换：如果以后换成用户提供的开源 3D 办公室，只需保留 `createOffice3D(canvas)` + `setMembers()` 两个接口；
 *   - 无外部控制库：拖拽旋转/滚轮缩放自己实现，避免再引第二个 CDN 模块。
 */
import * as THREE from './vendor/three.module.js'

const COLORS = {
  cyan: 0x70eaff,
  cyan2: 0x00bfe8,
  green: 0x3cf2a5,
  amber: 0xffbd68,
  dim: 0x547385,
  bg: 0x02070d,
  floor: 0x031019,
  panel: 0x071a26,
}

function cssColor(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

function textSprite(text, { color = '#dffbff', size = 26, bg = 'rgba(2,10,16,.72)' } = {}) {
  const pad = 14
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const font = `500 ${size}px "Microsoft YaHei", sans-serif`
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  const h = size + pad * 2
  canvas.width = w
  canvas.height = h
  const c2 = canvas.getContext('2d')
  c2.font = font
  c2.fillStyle = bg
  c2.fillRect(0, 0, w, h)
  c2.strokeStyle = 'rgba(112,234,255,.35)'
  c2.strokeRect(0.5, 0.5, w - 1, h - 1)
  c2.fillStyle = color
  c2.textBaseline = 'middle'
  c2.fillText(text, pad, h / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(w / 46, h / 46, 1)
  return sprite
}

/** 创建 3D 场景；返回 { setMembers, dispose, focusMember }。 */
export function createOffice3D(canvas) {
  const scene = new THREE.Scene()
  scene.background = null
  scene.fog = new THREE.FogExp2(0x01070d, 0.026)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
  const state = { yaw: -0.55, pitch: 0.62, dist: 17.5, target: new THREE.Vector3(0, 1.6, 0) }

  // 灯光
  scene.add(new THREE.HemisphereLight(0x9fe9ff, 0x02070d, 0.85))
  const key = new THREE.DirectionalLight(0xbfefff, 1.15)
  key.position.set(7, 12, 6)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  scene.add(key)
  const rim = new THREE.PointLight(COLORS.cyan, 22, 26, 2)
  rim.position.set(-6, 5, -6)
  scene.add(rim)
  const warm = new THREE.PointLight(COLORS.amber, 6, 18, 2)
  warm.position.set(5, 3.4, -4.5)
  scene.add(warm)

  // 地面平台 + 网格
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(9.4, 9.8, 0.34, 72),
    new THREE.MeshStandardMaterial({ color: COLORS.floor, metalness: 0.55, roughness: 0.42 }),
  )
  platform.position.y = -0.18
  platform.receiveShadow = true
  scene.add(platform)

  const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.35 })
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(9.42, 0.045, 8, 96), ringMat)
  outerRing.rotation.x = Math.PI / 2
  outerRing.position.y = 0.02
  scene.add(outerRing)

  const grid = new THREE.GridHelper(18, 36, COLORS.cyan, 0x0a2b3a)
  grid.material.transparent = true
  grid.material.opacity = 0.18
  grid.position.y = 0.01
  scene.add(grid)

  // 中心全息桌（白板 / 状态屏）
  const holoBase = new THREE.Mesh(
    new THREE.CylinderGeometry(2.05, 2.35, 0.5, 48),
    new THREE.MeshStandardMaterial({ color: COLORS.panel, metalness: 0.6, roughness: 0.35 }),
  )
  holoBase.position.y = 0.25
  holoBase.castShadow = true
  scene.add(holoBase)
  const holoTop = new THREE.Mesh(
    new THREE.CylinderGeometry(1.95, 1.95, 0.08, 48),
    new THREE.MeshStandardMaterial({ color: 0x060f16, metalness: 0.7, roughness: 0.25 }),
  )
  holoTop.position.y = 0.56
  scene.add(holoTop)
  const holoGlow = new THREE.Mesh(
    new THREE.RingGeometry(1.4, 1.95, 48),
    new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  )
  holoGlow.rotation.x = -Math.PI / 2
  holoGlow.position.y = 0.61
  scene.add(holoGlow)

  const holoLabel = textSprite('协作白板 · 实时', { color: '#70eaff', size: 22 })
  holoLabel.position.set(0, 2.15, 0)
  scene.add(holoLabel)

  // 办公桌（6 个工位，环形布局）
  const deskGroup = new THREE.Group()
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x0b2634, metalness: 0.5, roughness: 0.45 })
  const legMat = new THREE.MeshStandardMaterial({ color: 0x123b4e, metalness: 0.7, roughness: 0.3 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a3d54, emissive: COLORS.cyan2, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.4 })
  const slots = []
  const SLOT_COUNT = 6
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const angle = (i / SLOT_COUNT) * Math.PI * 2 - Math.PI / 2
    const r = 6.1
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const g = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 1.05), deskMat)
    top.position.y = 0.78
    top.castShadow = true
    top.receiveShadow = true
    g.add(top)
    for (const [lx, lz] of [[-1, -0.42], [1, -0.42], [-1, 0.42], [1, 0.42]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.78, 0.09), legMat)
      leg.position.set(lx * 1.02, 0.39, lz * 0.42)
      g.add(leg)
    }
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.58, 0.05), screenMat)
    screen.position.set(0, 1.14, -0.34)
    screen.rotation.x = -0.16
    g.add(screen)
    const glow = new THREE.PointLight(COLORS.cyan2, 3.2, 3.2, 2)
    glow.position.set(0, 1.2, -0.1)
    g.add(glow)
    g.position.set(x, 0, z)
    g.rotation.y = -angle + Math.PI / 2
    deskGroup.add(g)
    slots.push({ position: new THREE.Vector3(x, 0, z), angle })
  }
  scene.add(deskGroup)

  // 人物（数据驱动重建）
  let membersGroup = new THREE.Group()
  scene.add(membersGroup)
  const avatars = []
  const STATUS_COLOR = {
    working: 0x70eaff,
    meeting: 0xffbd68,
    reporting: 0x9a8cff,
    idle: 0x547385,
    on_probation: 0xffbd68,
    terminated: 0x4a3238,
    completed: 0x3cf2a5,
    in_progress: 0x70eaff,
    pending: 0x547385,
    remote: 0x547385,
  }

  function makeAvatar(member, slot) {
    const g = new THREE.Group()
    const color = STATUS_COLOR[String(member.status || '').toLowerCase()] || COLORS.dim
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0d2b3a, emissive: color, emissiveIntensity: 0.28, metalness: 0.35, roughness: 0.55 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.62, 8, 16), bodyMat)
    body.position.y = 1.02
    body.castShadow = true
    g.add(body)
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xe8fbff, emissive: color, emissiveIntensity: 0.35, metalness: 0.1, roughness: 0.5 }),
    )
    head.position.y = 1.78
    head.castShadow = true
    g.add(head)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    g.add(ring)
    const label = textSprite(String(member.name || '成员'), { color: '#dffbff', size: 22 })
    label.position.set(0, 2.4, 0)
    g.add(label)
    const roleLabel = textSprite(String(member.role || member.task || ''), { color: '#8fc6d8', size: 16, bg: 'rgba(2,10,16,.55)' })
    roleLabel.position.set(0, 2.12, 0)
    g.add(roleLabel)
    const ringGroup = new THREE.Group()
    ringGroup.add(ring)
    g.add(ringGroup)
    g.position.copy(slot.position).multiplyScalar(0.78)
    g.position.y = 0
    g.rotation.y = -slot.angle + Math.PI / 2
    g.userData = { member, color, ring, ringGroup, phase: Math.random() * Math.PI * 2 }
    return g
  }

  function setMembers(list) {
    scene.remove(membersGroup)
    membersGroup.traverse?.((o) => {
      if (o.geometry) o.geometry.dispose?.()
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.())
        else o.material.dispose?.()
      }
    })
    membersGroup = new THREE.Group()
    avatars.length = 0
    const arr = Array.isArray(list) ? list.slice(0, SLOT_COUNT) : []
    arr.forEach((m, i) => {
      const av = makeAvatar(m, slots[i % SLOT_COUNT])
      membersGroup.add(av)
      avatars.push(av)
    })
    scene.add(membersGroup)
  }

  // 相机轨道（拖拽/滚轮）
  let dragging = false
  let lastX = 0
  let lastY = 0
  const pointer = new THREE.Vector2(-10, -10)
  let hovered = null
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    canvas.classList.add('dragging')
    canvas.setPointerCapture?.(e.pointerId)
  })
  canvas.addEventListener('pointerup', (e) => {
    dragging = false
    canvas.classList.remove('dragging')
    canvas.releasePointerCapture?.(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    if (!dragging) return
    state.yaw -= (e.clientX - lastX) * 0.005
    state.pitch = Math.max(0.18, Math.min(1.25, state.pitch + (e.clientY - lastY) * 0.004))
    lastX = e.clientX
    lastY = e.clientY
  })
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    state.dist = Math.max(9, Math.min(30, state.dist + Math.sign(e.deltaY) * 1.1))
  }, { passive: false })

  const raycaster = new THREE.Raycaster()
  function pick() {
    if (!avatars.length) return null
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(membersGroup.children, true)
    if (!hits.length) return null
    let obj = hits[0].object
    while (obj && !obj.userData?.member) obj = obj.parent
    return obj || null
  }
  let onPick = null
  canvas.addEventListener('click', () => {
    const hit = pick()
    if (hit?.userData?.member && typeof onPick === 'function') onPick(hit.userData.member)
  })

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 640
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 480
    renderer.setSize(w, h, false)
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(() => resize())
  ro.observe(canvas.parentElement || canvas)
  resize()

  let raf = 0
  let t = 0
  function frame() {
    t += 0.016
    // 相机
    const cy = Math.cos(state.pitch) * state.dist
    camera.position.set(
      state.target.x + Math.sin(state.yaw) * cy,
      state.target.y + Math.sin(state.pitch) * state.dist,
      state.target.z + Math.cos(state.yaw) * cy,
    )
    camera.lookAt(state.target)
    // 人物呼吸 + 环旋转
    for (const av of avatars) {
      const { phase, ring, ringGroup } = av.userData
      av.position.y = Math.sin(t * 1.4 + phase) * 0.035
      if (ringGroup) ringGroup.rotation.y += 0.006
      if (ring) ring.material.opacity = 0.35 + Math.sin(t * 2 + phase) * 0.16
    }
    // hover 高亮
    const hit = pick()
    if (hit !== hovered) {
      if (hovered) hovered.userData.ring.material.opacity = 0.45
      hovered = hit
      if (hovered) hovered.userData.ring.material.opacity = 0.95
    }
    holoGlow.material.opacity = 0.16 + Math.sin(t * 1.1) * 0.06
    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }
  frame()

  return {
    setMembers,
    onPick: (fn) => { onPick = fn },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.dispose()
    },
  }
}
