import { useEffect, useRef } from "react";
import * as THREE from "three";

// A real basketball is orange with black seams, not a texture -- built here
// out of primitives (a sphere + four seam rings) instead of loading an
// external image, so there's nothing to fetch and nothing that could carry
// a hidden trademark the way this project's earlier AI-generated hero
// photos did.
const BALL_RADIUS = 1;
const BALL_COLOR = 0xff7a1a; // matches --accent
const SEAM_COLOR = 0x1a1108;

function buildBasketball() {
  const group = new THREE.Group();

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 48, 48),
    new THREE.MeshStandardMaterial({ color: BALL_COLOR, roughness: 0.6, metalness: 0.05 })
  );
  group.add(ball);

  // Four great-circle seams (a ring is a flattened torus hugging the
  // sphere's surface) at angles that approximate a real ball's panel
  // layout: one equator, one through the poles, and two more at +-45deg
  // around the vertical axis.
  const seamGeometry = new THREE.TorusGeometry(BALL_RADIUS, 0.012, 8, 64);
  const seamMaterial = new THREE.MeshStandardMaterial({ color: SEAM_COLOR, roughness: 0.8 });
  const seamAngles = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
  for (const angle of seamAngles) {
    const seam = new THREE.Mesh(seamGeometry, seamMaterial);
    // The first two are the equator and the pole-to-pole seam; the other
    // two are tilted copies of the pole-to-pole one, not the equator, so
    // they cross it rather than stacking on top of it.
    if (angle === 0) {
      seam.rotation.x = Math.PI / 2;
    } else {
      seam.rotation.y = angle;
    }
    group.add(seam);
  }

  return group;
}

/** A slowly-spinning 3D basketball behind the landing page's hero, built
 * with plain three.js (no react-three-fiber -- one persistent object
 * doesn't need a whole scene-graph framework). Idles on its own and picks
 * up extra spin from scrolling, fading out once the hero's scrolled past
 * (both for the visual -- it's a hero flourish, not a full-page mascot --
 * and for GPU cost: the render loop stops entirely once it's invisible). */
export default function CourtScene3D() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0xff7a1a, 0.8, 12);
    rimLight.position.set(-3, -1, 2);
    scene.add(rimLight);

    const ball = buildBasketball();
    scene.add(ball);

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    // Read live, but never trigger a React re-render for it -- this needs
    // to update every animation frame, which state/props aren't for.
    // innerHeight falls back to a sane default rather than 0 -- dividing by
    // an actual 0 (a real viewport is never that, but better safe) would
    // turn every fade calculation below into NaN, which reads as "invisible
    // forever" (NaN > 0.02 is false) instead of "fully visible".
    const scrollState = { y: window.scrollY, heroHeight: window.innerHeight || 800 };
    function handleScroll() {
      scrollState.y = window.scrollY;
    }
    window.addEventListener("scroll", handleScroll, { passive: true });

    let frameId = null;
    let visible = true;
    const clock = new THREE.Clock();

    function tick() {
      frameId = requestAnimationFrame(tick);
      const dt = clock.getDelta();

      // Fully faded out by one viewport height of scrolling -- the hero's
      // own flourish, not a full-page passenger.
      const fade = Math.max(0, 1 - scrollState.y / scrollState.heroHeight);
      const nowVisible = fade > 0.02;
      if (nowVisible !== visible) {
        visible = nowVisible;
        canvas.style.opacity = visible ? "" : "0";
      }
      if (!visible) return; // keep the rAF loop alive (cheap) so it resumes the instant scrolling back up crosses the threshold, without a separate observer

      canvas.style.opacity = String(Math.min(1, fade));

      if (!prefersReducedMotion) {
        ball.rotation.y += dt * 0.35 + scrollState.y * 0.00025;
        ball.rotation.x += dt * 0.08;
      }

      renderer.render(scene, camera);
    }
    tick();

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", handleScroll);
      scene.traverse((obj) => {
        obj.geometry?.dispose?.();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose?.();
      });
      renderer.dispose();
    };
  }, []);

  return (
    <div className="court-scene-3d" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
