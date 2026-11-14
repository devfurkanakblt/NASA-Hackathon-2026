import { MissionApp } from './app/MissionApp.tsx'
import { Scene3DDemo } from './scene3d/dev/Scene3DDemo.tsx'

// `?demo=3d` keeps Person C's stand-alone 3D harness reachable for debugging.
const show3dDemo = new URLSearchParams(window.location.search).get('demo') === '3d'

export default function App() {
  return show3dDemo ? <Scene3DDemo /> : <MissionApp />
}
