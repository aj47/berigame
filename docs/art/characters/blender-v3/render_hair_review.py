import bpy
from mathutils import Vector
from pathlib import Path
out=Path(bpy.data.filepath).parent
sc=bpy.context.scene;rig=bpy.data.objects['Beri_Adventurer'];rig.animation_data.action=bpy.data.actions['Idle'];sc.frame_set(0)
sc.render.resolution_x=600;sc.render.resolution_y=600;sc.cycles.samples=12;cam=sc.camera;cam.data.ortho_scale=1.12
for name,loc in [('front',(0,-5,2)),('side',(5,0,2)),('back',(0,5,2)),('overhead',(1,-2,6))]:
 cam.location=loc;cam.rotation_euler=(Vector((0,0,1.91))-cam.location).to_track_quat('-Z','Y').to_euler();sc.render.filepath=str(out/('hair-'+name+'.png'));bpy.ops.render.render(write_still=True)
