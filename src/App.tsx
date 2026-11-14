import { Scene3DDemo } from './scene3d/dev/Scene3DDemo.tsx'

// Temporary shell: shows the 3D view on its own until the real screen layout lands.
// The app then renders <MissionScene3D /> from './scene3d' inside that layout instead.
export default function App() {
  return <Scene3DDemo />
}
