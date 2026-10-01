"""Render/resume the saved cinematic from isolated background Blender."""
import bpy,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
def arg(key,default):return next((s.split('=',1)[1] for s in sys.argv if s.startswith('--'+key+'=')),default)
scene=bpy.context.scene
scene.eevee.taa_render_samples=int(arg('samples','32'))
scene.render.resolution_percentage=int(arg('percent','100'))
out=HERE/arg('out','frames');out.mkdir(exist_ok=True)
frames=([int(x) for x in arg('frames','').split(',')] if arg('frames','') else list(range(int(arg('start','1')),int(arg('end','960'))+1)))
start=time.time()
for i,f in enumerate(frames):
    path=out/f'frame-{f:04d}.png'
    if path.exists() and arg('resume','yes')=='yes':continue
    scene.frame_set(f);scene.render.filepath=str(path)
    t=time.time();bpy.ops.render.render(write_still=True)
    print(f'PROGRESS frame={f} batch={i+1}/{len(frames)} seconds={time.time()-t:.2f} elapsed={time.time()-start:.1f}',flush=True)
