import './style.css'
import * as THREE from 'three'
import GUI from 'lil-gui'

// Scene setup
const scene = new THREE.Scene()
// Cameras: perspective and orthographic
const perspectiveCamera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)

const frustumSize = 10
let aspect = window.innerWidth / window.innerHeight
const orthoCamera = new THREE.OrthographicCamera(
  (-frustumSize * aspect) / 2,
  (frustumSize * aspect) / 2,
  frustumSize / 2,
  -frustumSize / 2,
  0.1,
  1000
)

// Active camera reference (start with orthographic default)
let activeCamera = orthoCamera
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('canvas') })

renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0x1a1a2e)
// initial camera positions; we'll recentre after blocks generated
perspectiveCamera.position.set(0, 5, 8)
perspectiveCamera.lookAt(0, 0, 0)
orthoCamera.position.set(0, 5, 8)
orthoCamera.lookAt(0, 0, 0)

// navigation state
// camera target state (we drive activeCamera toward these targets)
let targetCameraY = activeCamera.position.y
let targetCameraZ = activeCamera.position.z
let targetLookAt = new THREE.Vector3(0, 0, 0)
let currentLookAt = new THREE.Vector3(0, 0, 0)

// (UI and blocks are created dynamically further below)

// Create canvas texture with floor number
function createFloorTexture(floorNumber) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#222222'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Border
  ctx.strokeStyle = '#ffcc00'
  ctx.lineWidth = 20
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20)

  // Floor number text
  ctx.fillStyle = '#ffcc00'
  ctx.font = 'bold 200px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${floorNumber}`, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  return texture
}

// Create building blocks dynamically
const blocks = []
const blockHeight = 1
const blockWidth = 3
const blockDepth = 2
const spacing = 0.1

let autoRotate = true
let currentFloorCount = 5
let currentFocusedFloor = 0 // 0 = none, 1..n = floor index
let buildingData = null
let buildingList = []

// UI references
const navButtonsContainer = document.getElementById('navButtons')
const buildingSelect = document.getElementById('buildingSelect')
const floorCountInput = document.getElementById('floorCount')
const floorCountLabel = document.getElementById('floorCountLabel')
const zoomInBtn = document.getElementById('zoomIn')
const zoomOutBtn = document.getElementById('zoomOut')
const resetCamBtn = document.getElementById('resetCam')
const toggleRotateBtn = document.getElementById('toggleRotate')

function clearBlocks() {
  blocks.forEach(b => scene.remove(b))
  blocks.length = 0
}

// compute zoom distance required to fit a block width into camera view
function computeZoomDistance() {
  const width = blockWidth + 1 // add padding
  if (activeCamera === perspectiveCamera) {
    // use horizontal FOV
    const fov = THREE.MathUtils.degToRad(perspectiveCamera.fov)
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect)
    return (width / 2) / Math.tan(hFov / 2)
  } else {
    // orthographic: adjust zoom based on frustumSize
    return null
  }
}

// calculate an orthographic zoom value so that both the stack height
// and block width fit within the camera frustum with some padding
function computeOrthographicZoom(totalHeight) {
  const paddedWidth = blockWidth + 1
  const paddedHeight = totalHeight + blockHeight + 1
  // the orthographic frustum spans (-frustumSize*aspect/2, ... ) horizontally
  const viewWidth = frustumSize * aspect
  const viewHeight = frustumSize
  // zoom factor scales the view dimensions: effective width = viewWidth / zoom
  // choose zoom s.t. both padded dimensions fit
  const zoomForWidth = viewWidth / paddedWidth
  const zoomForHeight = viewHeight / paddedHeight
  return Math.min(zoomForWidth, zoomForHeight, 10) // cap at 10
}

function computeCenterY() {
  // center of stack height
  const totalHeight = (currentFloorCount - 1) * (blockHeight + spacing)
  return totalHeight / 2
}

function resetView() {
  const centerY = computeCenterY()
  targetCameraY = centerY + 2
  targetCameraZ = 8
  targetLookAt.set(0, centerY, 0)
  currentFocusedFloor = 0
  updateBlockStyles()
  showFloorInfo(0)
  if (activeCamera === orthoCamera) {
    // compute zoom that fits both width and full stack height
    const totalHeight = (currentFloorCount - 1) * (blockHeight + spacing)
    orthoCamera.zoom = computeOrthographicZoom(totalHeight)
    orthoCamera.updateProjectionMatrix()
  }
}

function selectBuilding(index) {
  if (!buildingList || !buildingList[index]) return
  buildingData = buildingList[index]
  // set floor count from chosen building
  currentFloorCount = (buildingData.floors || []).length || 1
  floorCountInput.max = Math.max(1, currentFloorCount)
  floorCountInput.value = currentFloorCount
  floorCountLabel.textContent = String(currentFloorCount)
  // regenerate blocks and UI
  generateBlocks(currentFloorCount)
  resetView()
  showBuildingInfo()
  buildGUI()
}


function focusFloor(floorIndex) {
  currentFocusedFloor = floorIndex
  updateBlockStyles()
  showFloorInfo(floorIndex)
  const floorY = (floorIndex - 1) * (blockHeight + spacing)
  targetCameraY = floorY + 2
  targetLookAt.set(0, floorY, 0)
  if (activeCamera === perspectiveCamera) {
    const dist = computeZoomDistance()
    targetCameraZ = dist
    if (gui) {
      params.zoom = dist
      const ctrl = gui.controllers.find(c => c._name === 'Zoom')
      if (ctrl) ctrl.setValue(dist)
    }
  } else {
    const viewWidth = frustumSize
    const newZoom = viewWidth / (blockWidth + 1)
    orthoCamera.zoom = newZoom
    orthoCamera.updateProjectionMatrix()
    targetCameraZ = 8
    if (gui) {
      params.zoom = newZoom
      const ctrl = gui.controllers.find(c => c._name === 'Zoom')
      if (ctrl) ctrl.setValue(newZoom)
    }
  }
}

// show building info in side panel
function showBuildingInfo() {
  if (!buildingData) return
  const name = document.getElementById('buildingName')
  const type = document.getElementById('buildingType')
  const year = document.getElementById('buildingYear')
  const addr = document.getElementById('buildingAddress')
  const amenities = document.getElementById('buildingAmenities')

  name.textContent = buildingData.name || buildingData.buildingId || 'Building'
  type.textContent = buildingData.type || '-'
  year.textContent = buildingData.yearBuilt || '-'
  const a = buildingData.address || {}
  addr.innerHTML = `${a.street || ''}<br>${a.city || ''}, ${a.state || ''} ${a.pincode || ''}<br>${a.country || ''}`
  amenities.innerHTML = ''
  (buildingData.amenities || []).forEach(am => {
    const li = document.createElement('li')
    li.textContent = am
    amenities.appendChild(li)
  })
}

// show floor details in side panel
function showFloorInfo(floorIndex) {
  const panel = document.getElementById('floorDetails')
  if (!buildingData) { panel.textContent = 'No data' ; return }
  if (!floorIndex) { panel.innerHTML = 'Select a floor to see details' ; return }
  const floor = buildingData.floors.find(f => f.floorNumber === floorIndex) || buildingData.floors[floorIndex-1]
  if (!floor) { panel.textContent = 'Floor data not found' ; return }

  // build HTML summary
  let html = `<div><strong>Floor:</strong> ${floor.floorNumber}</div>`
  html += `<div><strong>Total Flats:</strong> ${floor.totalFlats}</div>`
  html += `<div style="margin-top:8px"><strong>Units:</strong></div>`
  html += '<ul style="margin-top:6px">'
  floor.units.forEach(u => {
    const tenant = u.tenant ? `${u.tenant.name} (${u.tenant.phone})` : '—'
    html += `<li>${u.unitNumber} — ${u.type} — ${u.status} — ${tenant}</li>`
  })
  html += '</ul>'
  panel.innerHTML = html
}


function updateBlockStyles() {
  blocks.forEach((block, idx) => {
    block.material.forEach((mat) => {
      mat.wireframe = currentFocusedFloor > 0 && idx !== currentFocusedFloor - 1
      // dim non-focused
      mat.opacity = currentFocusedFloor > 0 && idx !== currentFocusedFloor - 1 ? 0.4 : 1
      mat.transparent = mat.opacity < 1
    })
  })
}

function generateBlocks(count) {
  clearBlocks()
  for (let i = 0; i < count; i++) {
    const geometry = new THREE.BoxGeometry(blockWidth, blockHeight, blockDepth)
    const materials = [
      new THREE.MeshPhongMaterial({ color: 0x1e88e5 }),
      new THREE.MeshPhongMaterial({ color: 0x1e88e5 }),
      new THREE.MeshPhongMaterial({ color: 0x0d47a1 }),
      new THREE.MeshPhongMaterial({ color: 0x434343 }),
      new THREE.MeshPhongMaterial({ map: createFloorTexture(i + 1) }),
      new THREE.MeshPhongMaterial({ color: 0x1e88e5 }),
    ]
    const cube = new THREE.Mesh(geometry, materials)
    const yPos = i * (blockHeight + spacing)
    cube.position.y = yPos
    scene.add(cube)
    blocks.push(cube)
  }
  currentFocusedFloor = 0
  updateBlockStyles()

  // rebuild navigation buttons
  navButtonsContainer.innerHTML = ''
  for (let i = 1; i <= count; i++) {
    const btn = document.createElement('button')
    btn.textContent = `F${i}`
    btn.addEventListener('click', () => {
      focusFloor(i)
    })
    navButtonsContainer.appendChild(btn)
  }
}

// wire UI events
floorCountInput.value = currentFloorCount
floorCountLabel.textContent = String(currentFloorCount)
floorCountInput.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10) || 1
  floorCountLabel.textContent = String(val)
  currentFloorCount = val
  generateBlocks(val)
  // recalc center and zoom when floors change
  resetView()
  // rebuild GUI so focus selector matches new count
  buildGUI()
})

zoomInBtn.addEventListener('click', () => {
  if (activeCamera === perspectiveCamera) {
    targetCameraZ = Math.max(2, targetCameraZ - 0.8)
  } else {
    orthoCamera.zoom = Math.min(10, orthoCamera.zoom * 1.1)
    orthoCamera.updateProjectionMatrix()
  }
})
zoomOutBtn.addEventListener('click', () => {
  if (activeCamera === perspectiveCamera) {
    targetCameraZ = Math.min(20, targetCameraZ + 0.8)
  } else {
    orthoCamera.zoom = Math.max(0.2, orthoCamera.zoom / 1.1)
    orthoCamera.updateProjectionMatrix()
  }
})
resetCamBtn.addEventListener('click', () => {
  resetView()
  buildGUI()
})
toggleRotateBtn.addEventListener('click', () => {
  autoRotate = !autoRotate
  toggleRotateBtn.textContent = autoRotate ? 'Pause Rotate' : 'Resume Rotate'
})

generateBlocks(currentFloorCount)
// load multiple building files and initialize the selector
// IMPORTANT: for Vite production builds these JSON files must be placed in the
// `public/` folder so they are served from the web root (`/building00.json`).
// during development the code will also try `/src/` locations to make testing
// easier, but `/src/` is not available after build.
async function loadData() {
  const files = ['building00.json', 'building01.json', 'building02.json']
  buildingList = []

  // helper to try fetching from possible locations
  async function tryFetch(path) {
    try {
      const r = await fetch(path)
      if (r.ok) return r
    } catch {}
    return null
  }

  for (const f of files) {
    let res = await tryFetch(`/src/${f}`)
    if (!res) res = await tryFetch(`/${f}`)
    if (!res) continue
    try {
      const json = await res.json()
      if (Array.isArray(json)) {
        json.forEach(item => buildingList.push(item))
      } else if (json && typeof json === 'object') {
        buildingList.push(json)
      }
    } catch (err) {
      console.warn('could not parse', f, err)
    }
  }

  // fallback: try old single file `data.json` if no building files found
  if (buildingList.length === 0) {
    try {
      const res = await fetch(base + 'data.json')
      if (res.ok) {
        const arr = await res.json()
        if (Array.isArray(arr)) buildingList = arr.slice()
      }
    } catch (e) {
      console.error('No building files found')
    }
  }

  // populate selector
  if (buildingSelect) {
    buildingSelect.innerHTML = ''
    buildingList.forEach((b, idx) => {
      const opt = document.createElement('option')
      opt.value = String(idx)
      opt.textContent = b.name ? `${b.name} (${b.buildingId || idx})` : (b.buildingId || `Building ${idx+1}`)
      buildingSelect.appendChild(opt)
    })
    buildingSelect.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10)
      selectBuilding(idx)
    })
  }

  // initialize from first building if present
  if (buildingList.length > 0) {
    selectBuilding(0)
  } else {
    // fallback: generate default blocks
    generateBlocks(currentFloorCount)
    resetView()
    buildGUI()
  }
}

loadData()

// Build dat-gui panel
let gui
function buildGUI() {
  if (gui) gui.destroy()
  gui = new GUI()

  const params = {
    floors: currentFloorCount,
    focus: 0,
    zoom: activeCamera === perspectiveCamera ? targetCameraZ : orthoCamera.zoom,
    autoRotate: autoRotate,
    camera: activeCamera === perspectiveCamera ? 'Perspective' : 'Orthographic',
    reset: () => {
      resetView()
      params.focus = 0
    }
  }

  // floors controller
  gui.add(params, 'floors', 1, 12, 1).name('Floors').onChange((v) => {
    currentFloorCount = v
    floorCountInput.value = v
    floorCountLabel.textContent = String(v)
    generateBlocks(v)
    buildGUI()
  })

  // focus selector built from currentFloorCount
  const floorOptions = { None: 0 }
  for (let i = 1; i <= currentFloorCount; i++) floorOptions[`Floor ${i}`] = i
  gui.add(params, 'focus', floorOptions).name('Focus').onChange((v) => {
    if (v > 0) {
      focusFloor(v)
    } else {
      resetView()
    }
  })

  const zoomCtrl = gui.add(params, 'zoom', 2, 20, 0.1).name('Zoom').onChange((v) => {
    if (activeCamera === perspectiveCamera) {
      targetCameraZ = v
    } else {
      orthoCamera.zoom = v
      orthoCamera.updateProjectionMatrix()
    }
  })
  gui.add(params, 'camera', ['Perspective', 'Orthographic']).name('Camera').onChange((v) => {
    const prev = activeCamera
    activeCamera = v === 'Perspective' ? perspectiveCamera : orthoCamera
    // copy position from previous camera to avoid jumps
    activeCamera.position.copy(prev.position)
    // keep currentLookAt so lookAt interpolation stays smooth
    targetCameraY = activeCamera.position.y
    targetCameraZ = activeCamera.position.z
    // adjust zoom controller limits and value
    if (activeCamera === perspectiveCamera) {
      zoomCtrl.min(2).max(20).step(0.1)
      params.zoom = targetCameraZ
    } else {
      zoomCtrl.min(0.2).max(10).step(0.1)
      params.zoom = orthoCamera.zoom
    }
    zoomCtrl.updateDisplay()
  })
  gui.add(params, 'autoRotate').name('Auto Rotate').onChange((v) => { autoRotate = v })
  gui.add(params, 'reset').name('Reset Camera')
}

buildGUI()

// Add lighting
const light = new THREE.DirectionalLight(0xffffff, 1)
light.position.set(10, 15, 10)
scene.add(light)

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
scene.add(ambientLight)

// Handle window resize
window.addEventListener('resize', () => {
  const width = window.innerWidth
  const height = window.innerHeight
  aspect = width / height
  // update perspective
  perspectiveCamera.aspect = aspect
  perspectiveCamera.updateProjectionMatrix()
  // update orthographic
  orthoCamera.left = (-frustumSize * aspect) / 2
  orthoCamera.right = (frustumSize * aspect) / 2
  orthoCamera.top = frustumSize / 2
  orthoCamera.bottom = -frustumSize / 2
  orthoCamera.updateProjectionMatrix()
  renderer.setSize(width, height)
})

// simple linear interpolation helper
function lerp(a, b, t) {
  return a + (b - a) * t
}

// Animation loop
function animate() {
  requestAnimationFrame(animate)
  
  // Rotate all blocks together (respect auto-rotate)
  if (autoRotate) {
    blocks.forEach((block) => {
      block.rotation.y += 0.005
    })
  }

  // smooth camera movement toward target (apply to activeCamera)
  activeCamera.position.y = lerp(activeCamera.position.y, targetCameraY, 0.05)
  activeCamera.position.z = lerp(activeCamera.position.z, targetCameraZ, 0.05)

  // interpolate lookAt vector instead of jumping
  currentLookAt.lerp(targetLookAt, 0.05)
  activeCamera.lookAt(currentLookAt)

  renderer.render(scene, activeCamera)
}

animate()
 
