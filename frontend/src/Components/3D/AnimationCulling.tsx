import { useEffect } from 'react';
import { Frustum, Matrix4 } from 'three';
import { animationView } from '../../animation/avatarAnimator';
import { useBeforeRender } from './beforeRender';

const frustum = new Frustum();
const viewProjection = new Matrix4();

/**
 * Hands each rendered frame's view to the avatar animators, which pose only the
 * avatars inside it on the next frame (off-screen ones keep their clip time).
 */
const AnimationCulling = () => {
  useBeforeRender((_, camera) => {
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    animationView.frustum = frustum;
  });
  useEffect(() => () => { animationView.frustum = null; }, []);
  return null;
};
export default AnimationCulling;
