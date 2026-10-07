import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import { declineTier, deviceTiers, inclineTier, useAutoQuality, type AutoQuality } from '../Components/3D/renderQuality';
import { shadowRole } from '../Components/3D/SunShadow';

const desktop = (gpu: string) => deviceTiers({ gpu, cores: 8, memory: 8, mobile: false });
const phone = (gpu: string, memory = 4) => deviceTiers({ gpu, cores: 8, memory, mobile: true });

describe('device tiers', () => {
  it('starts known strong desktop GPUs on high', () => {
    expect(desktop('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)')).toEqual({ start: 'high', ceiling: 'high' });
    expect(desktop('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ start: 'high', ceiling: 'high' });
    expect(desktop('AMD Radeon RX 6600')).toEqual({ start: 'high', ceiling: 'high' });
  });

  it('starts other desktops on medium, free to climb', () => {
    expect(desktop('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({ start: 'medium', ceiling: 'high' });
    expect(desktop('Apple GPU')).toEqual({ start: 'medium', ceiling: 'high' });
    expect(desktop('')).toEqual({ start: 'medium', ceiling: 'high' });
  });

  it('keeps phones at medium and budget or software renderers low', () => {
    expect(phone('Apple GPU')).toEqual({ start: 'medium', ceiling: 'medium' });
    expect(phone('ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)')).toEqual({ start: 'medium', ceiling: 'medium' });
    expect(phone('ANGLE (Qualcomm, Adreno (TM) 610, OpenGL ES 3.2)')).toEqual({ start: 'low', ceiling: 'medium' });
    expect(phone('Mali-G52 MC2')).toEqual({ start: 'low', ceiling: 'medium' });
    expect(phone('Apple GPU', 2)).toEqual({ start: 'low', ceiling: 'medium' });
    expect(desktop('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toEqual({ start: 'low', ceiling: 'low' });
  });
});

describe('auto stepping', () => {
  afterEach(() => useAutoQuality.setState({ auto: null }));

  it('climbs one tier at a time up to the ceiling', () => {
    let auto: AutoQuality = { tier: 'low', ceiling: 'high' };
    auto = inclineTier(auto);
    expect(auto.tier).toBe('medium');
    auto = inclineTier(inclineTier(auto));
    expect(auto).toEqual({ tier: 'high', ceiling: 'high', climbed: true });
  });

  it('never retries a tier it climbed to and could not hold', () => {
    let auto: AutoQuality = { tier: 'medium', ceiling: 'high' };
    auto = declineTier(inclineTier(auto));
    expect(auto).toEqual({ tier: 'medium', ceiling: 'medium', climbed: false });
    // Frames keep up again at medium: high stays off.
    expect(inclineTier(auto)).toEqual(auto);
  });

  it('leaves the way back up open after other drops (a frame cap, a slower display)', () => {
    // Starts high; a battery-saver frame cap drops it twice; the cap lifts and it climbs back.
    let auto: AutoQuality = { tier: 'high', ceiling: 'high', climbed: false };
    auto = declineTier(declineTier(auto));
    expect(auto).toEqual({ tier: 'low', ceiling: 'high', climbed: false });
    expect(declineTier(auto)).toEqual(auto);
    auto = inclineTier(inclineTier(auto));
    expect(auto).toEqual({ tier: 'high', ceiling: 'high', climbed: true });
  });

  it('steps the shared store from the device start', () => {
    useAutoQuality.setState({ auto: { tier: 'high', ceiling: 'high', climbed: false } });
    useAutoQuality.getState().decline();
    expect(useAutoQuality.getState().auto).toEqual({ tier: 'medium', ceiling: 'high', climbed: false });
    useAutoQuality.getState().incline();
    useAutoQuality.getState().decline();
    expect(useAutoQuality.getState().auto).toEqual({ tier: 'medium', ceiling: 'medium', climbed: false });
  });
});

describe('sun shadow roles', () => {
  it('casts and receives for lit props, receives only for flat ground', () => {
    expect(shadowRole(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial()))).toEqual({ cast: true, receive: true });
    const ground = new Mesh(new PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new MeshStandardMaterial());
    expect(shadowRole(ground)).toEqual({ cast: false, receive: true });
  });

  it('skips tiny props, see-through surfaces and opted-out meshes but still lets them receive', () => {
    const grass = new InstancedMesh(new BoxGeometry(0.3, 0.1, 0.2), new MeshLambertMaterial(), 500);
    expect(shadowRole(grass)).toEqual({ cast: false, receive: true });
    expect(shadowRole(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ transparent: true, opacity: 0.5 })))).toEqual({ cast: false, receive: true });
    const optedOut = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    optedOut.userData.shadow = false;
    expect(shadowRole(optedOut)).toEqual({ cast: false, receive: true });
  });

  it('leaves unlit and custom shader meshes alone (sky, ocean, decals)', () => {
    expect(shadowRole(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()))).toBeNull();
    expect(shadowRole(new Mesh(new BoxGeometry(1, 1, 1), new ShaderMaterial()))).toBeNull();
  });
});
