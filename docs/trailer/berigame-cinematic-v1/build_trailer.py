"""BeriGame cinematic. Original game models, cinematic staging and animation.
Run in a separate factory-startup Blender, never in an interactive user's scene.
"""
import bpy, math, sys, random, json, time
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from math import sin, cos, pi
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
assert bpy.app.background
FPS = 24
DURATION = 40
def arg(name, default):
    return next((x.split('=',1)[1] for x in sys.argv if x.startswith('--'+name+'=')),default)
MODE=arg('mode','build')
W=int(arg('width','1920')); H=int(W*9/16)
for o in list(bpy.data.objects): bpy.data.objects.remove(o,do_unlink=True)
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=W;scene.render.resolution_y=H;scene.render.resolution_percentage=100
scene.render.fps=FPS;scene.frame_start=1;scene.frame_end=FPS*DURATION
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
scene.render.image_settings.color_depth='8';scene.render.image_settings.compression=15
scene.render.film_transparent=False
scene.eevee.taa_render_samples=48
scene.eevee.use_raytracing=True
scene.eevee.ray_tracing_options.resolution_scale='2'
scene.eevee.ray_tracing_options.screen_trace_quality=.5
if arg('renderer','eevee')=='cycles':
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.cycles.device='GPU'
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
    for device in prefs.devices:device.use=device.type=='METAL'
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=.15
scene.world.use_nodes=True
wn=scene.world.node_tree.nodes;wn.clear()
wout=wn.new('ShaderNodeOutputWorld');bg=wn.new('ShaderNodeBackground')
bg.inputs['Color'].default_value=(.36,.59,.75,1);bg.inputs['Strength'].default_value=.35
scene.world.node_tree.links.new(bg.outputs[0],wout.inputs['Surface'])
def rgb(h):
    v=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v)+(1,)
def mat(name,color,rough=.65,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=rgb(color)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return m
def light(name,typ,loc,energy,color,size=5):
    d=bpy.data.lights.new(name,typ);d.energy=energy;d.color=color
    if typ=='AREA':d.shape='DISK';d.size=size
    if typ=='SUN':d.angle=.12
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc
    o.rotation_euler=(Vector((0,1,0))-o.location).to_track_quat('-Z','Y').to_euler();return o
sun=light('Golden late-afternoon sunlight','SUN',(-12,6,16),2.6,(1,.81,.57))
light('Broad sky fill','AREA',(0,-6,11),1200,(.68,.84,1),12)
light('Soft warm character key','AREA',(-5,-5,8),1000,(1,.88,.70),7)
light('Canopy rim','AREA',(5,9,10),1700,(1,.83,.48),8)

if arg('environment','full')=='minimal':
    bpy.ops.mesh.primitive_plane_add(size=100)
    bpy.context.object.data.materials.append(mat('Meadow test','648746'))
    env={}
else:
    from environment import build_environment
    env=build_environment()

def load_asset(file,label,smooth=False):
    with bpy.data.libraries.load(str(file),link=False) as (a,b): b.objects=[n for n in a.objects if not n.startswith(('StudioGround','ReviewCamera','Key','Fill','Rim'))]
    objects=[o for o in b.objects if o and o.type in ('MESH','ARMATURE','EMPTY')]
    root=bpy.data.objects.new(label,None);scene.collection.objects.link(root)
    parts={}
    for o in objects:
        scene.collection.objects.link(o);parts[o.name.split('.')[0]]=o
        o.animation_data_clear()
        if o.type=='ARMATURE':
            for p in o.pose.bones:p.matrix_basis=Matrix.Identity(4)
        if o.parent not in objects:o.parent=root
        if o.type=='MESH':
            if smooth:
                for p in o.data.polygons:p.use_smooth=True
            for m in o.data.materials:
                if m and m.use_nodes:
                    for p in m.node_tree.nodes:
                        if p.type=='BSDF_PRINCIPLED':p.inputs['Roughness'].default_value=.68
        o.name=label+'_'+o.name
    return {'root':root,'objects':objects,'parts':parts,'rig':next((o for o in objects if o.type=='ARMATURE'),None)}
def adventure(name,label=None,smooth=True):return load_asset(ROOT/'docs/art/adventure-v1'/f'{name}.blend',label or name,smooth)
def hero(variant,label,robe,skin,hair):
    a=load_asset(ROOT/'docs/art/characters/blender-v4'/variant/f'starter-adventurer-v4-{variant}.blend',label)
    colors={0:robe,1:robe,2:robe,6:skin,7:skin,8:skin,22:skin,16:hair,17:hair,18:hair}
    for o in a['objects']:
        if o.type!='MESH':continue
        for i,m in enumerate(o.data.materials):
            m=m.copy();o.data.materials[i]=m
            for n in m.node_tree.nodes:
                if n.type=='TEX_IMAGE' and n.image:
                    im=n.image.copy();px=list(im.pixels)
                    for yy in range(64):
                        for xx in range(64):
                            c=colors.get((yy//8)*8+xx//8)
                            if c:px[(yy*64+xx)*4:(yy*64+xx)*4+3]=[int(c[k:k+2],16)/255 for k in (0,2,4)]
                    im.pixels=px;im.pack();n.image=im
    return a
lead=hero('tousled','Indigo adventurer','487FAD','DDA46C','654236')
rose=hero('topknot','Rose adventurer','BD606D','8B553B','302C31')
gold=hero('cropped','Golden adventurer','D6A54F','E7C6A0','AF7D45')
moss=adventure('moss','Moss',False);gardener=adventure('gardener','Gardener',False)
pip=adventure('pip','Pip');giant=adventure('berry-giant','Berry Giant')
berry=adventure('giant-berry','Giant berry');seed=adventure('strange-seed','Strange seed')
feast=adventure('feast','Feast');market=adventure('market','Market');workshop=adventure('workshop','Workshop')
market['root'].location=(9,1,0);market['root'].rotation_euler.z=-.3
workshop['root'].location=(-10,13,.1);workshop['root'].rotation_euler.z=.3
humans=[lead,rose,gold,moss,gardener];actors=humans+[pip,giant,berry,seed,feast]
rests={o:(o.location.copy(),o.rotation_euler.copy(),o.scale.copy()) for a in actors for o in a['objects']}

# Analytic two-bone posing matches the original BeriGame rig's -Y forward / Z up.
def orient(rig,n,head,direction):
    b=rig.data.bones[n];rest=(b.tail_local-b.head_local).normalized()
    q=rest.rotation_difference(Vector(direction).normalized())
    m=q.to_matrix().to_4x4()@b.matrix_local.to_quaternion().to_matrix().to_4x4()
    m.translation=Vector(head);rig.pose.bones[n].matrix=m;bpy.context.view_layer.update()
def limb(rig,upper,lower,end,target,pole,foot=False):
    pb=rig.pose.bones[upper];a=pb.head.copy();d=Vector(target)-a
    l1=rig.data.bones[upper].length;l2=rig.data.bones[lower].length
    dist=max(.02,min(d.length,l1+l2-.002));u=d.normalized();v=Vector(pole)-a;v=(v-u*v.dot(u)).normalized()
    along=(l1*l1-l2*l2+dist*dist)/(2*dist);height=math.sqrt(max(0,l1*l1-along*along))
    joint=a+u*along+v*height;tip=a+u*dist
    orient(rig,upper,a,joint-a);orient(rig,lower,joint,tip-joint)
    orient(rig,end,tip,(0,-.19,-.09) if foot else tip-joint)
def human_pose(a,t,mode='idle',offset=0,travel_speed=.8):
    rig=a['rig'];p=rig.pose.bones
    for b in p:b.matrix_basis=Matrix.Identity(4)
    moving=mode in ('walk','carry');phase=(t*1.25+offset)*2*pi
    sway=sin(phase)
    p['Prop.R'].scale=(0,0,0)
    p['Hips'].location=rig.data.bones['Hips'].matrix_local.to_quaternion().inverted()@Vector((0,0,-.03+(abs(sway)*.028 if moving else .008*sin(t*2))))
    p['Spine'].rotation_mode='XYZ';p['Spine'].rotation_euler.x=.06 if moving else .01*sin(t*2)
    p['Head'].rotation_mode='XYZ';p['Head'].rotation_euler.y=.09*sin(t*1.3+offset)
    bpy.context.view_layer.update()
    for s,l in [(1,'L'),(-1,'R')]:
        fy=.05*s;lift=0
        if moving:
            # Planted feet counter the actual root travel exactly. The swing
            # uses matching Hermite tangents for a soft toe-off and landing.
            u=(t*1.25+offset+(0 if s==1 else .5))%1
            stance=.60;cycle=.8;amplitude=travel_speed*cycle*stance/2
            if u<stance:
                fy=-amplitude+2*amplitude*u/stance
            else:
                w=(u-stance)/(1-stance);m=travel_speed*cycle*(1-stance)
                fy=(2*w**3-3*w*w+1)*amplitude+(w**3-2*w*w+w)*m+(-2*w**3+3*w*w)*(-amplitude)+(w**3-w*w)*m
                lift=.13*sin(pi*w)**1.3
        limb(rig,'Thigh.'+l,'Shin.'+l,'Foot.'+l,(s*.19,fy,.17+lift),(s*.25,-1,.6),True)
        if mode=='carry':hand=(s*.46,-.57,1.30);pole=(s*.82,-.05,1.1)
        elif mode=='cheer':hand=(s*(.44+.07*sin(t*4)), -.05,1.92+.08*sin(t*5));pole=(s*.8,.05,1.45)
        elif mode=='wave' and l=='R':hand=(-.5+.10*sin(t*7),-.1,1.91);pole=(-.85,.04,1.38)
        else:hand=(s*.38,-.13+(.16*cos(phase)*s if moving else 0),1.18);pole=(s*.7,.05,1.15)
        limb(rig,'UpperArm.'+l,'Forearm.'+l,'Hand.'+l,hand,pole)
def creature(a,t,walking=False,sniff=False,happy=False):
    for o in a['objects']:
        loc,rot,sc=rests[o];o.location=loc;o.rotation_euler=rot;o.scale=sc
    p=a['parts']
    if a is pip:
        w=sin(t*12)
        p['PipBody'].location.z+=abs(w)*.045 if walking else .014*sin(t*3)
        p['PipHead'].rotation_euler.x+=(.20+.07*sin(t*5)) if sniff else -.03+.045*sin(t*2)
        p['PipHead'].rotation_euler.z+=.09*sin(t*2)
        p['PipTail'].rotation_euler.z+=sin(t*(9 if happy else 4))*.32
        for i,n in enumerate(['PipLegL0','PipLegR0','PipLegL1','PipLegR1']):p[n].rotation_euler.x+=(.35*w*(1 if i in (0,3) else -1)) if walking else 0
    else:
        w=sin(t*3.4);p['GiantBody'].location.z+=abs(w)*.07 if walking else .035*sin(t*2)
        p['GiantHead'].rotation_euler.x+=.07+.055*sin(t*1.8)
        p['GiantHead'].rotation_euler.z+=.065*sin(t*.8)
        for i,n in enumerate(['GiantArmL','GiantArmR','GiantLegL','GiantLegR']):p[n].rotation_euler.x+=(w*(.22 if i<2 else .17)*(1 if i%2==0 else -1)) if walking else .035*sin(t*2+i)
        if happy:p['GiantArmR'].rotation_euler.y=-.25+.08*sin(t*4)
def place(a,loc=(0,0,0),yaw=0,scale=1):
    a['root'].location=loc;a['root'].rotation_euler=(0,0,yaw);a['root'].scale=(scale,)*3
def camera_at(pos,target,lens=48,fstop=3.5):
    cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.lens=lens;cam.data.dof.focus_distance=(Vector(target)-cam.location).length;cam.data.dof.aperture_fstop=fstop
def lerp(a,b,u):return tuple(x+(y-x)*u for x,y in zip(a,b))
def smooth(u):u=max(0,min(1,u));return u*u*(3-2*u)
cd=bpy.data.cameras.new('Cinematic 40-second edit');cam=bpy.data.objects.new('Camera',cd);scene.collection.objects.link(cam);scene.camera=cam
cd.sensor_width=36;cd.clip_end=300;cd.dof.use_dof=True;cd.dof.aperture_blades=7

# Atmospheric, animated floating pollen. Tiny original geometry, no images.
random.seed(42);pollen=[];pm=mat('Warm pollen glow','FFE3A2',.35)
pbs=pm.node_tree.nodes.get('Principled BSDF');pbs.inputs['Emission Color'].default_value=rgb('FFCD70');pbs.inputs['Emission Strength'].default_value=.8
for i in range(48):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=random.uniform(.009,.024))
    o=bpy.context.object;o.name='Pollen';o.data.materials.append(pm)
    base=Vector((random.uniform(-12,12),random.uniform(-4,13),random.uniform(.5,6)));pollen.append((o,base,random.uniform(0,6)))
gm=mat('Greenberry bribe','8ABA58',.4)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=.12,location=(1,-1,.13));snack=bpy.context.object;snack.name='Pip greenberry';snack.data.materials.append(gm)
for p in snack.data.polygons:p.use_smooth=True

def animate(t):
    for a in actors:place(a,(0,0,-30))
    snack.location=(0,0,-30)
    for a in humans:human_pose(a,t,'idle',humans.index(a)*.27)
    creature(pip,t);creature(giant,t)
    if t<4:
        u=t/4
        place(berry,(0,-1,0),.18*t,.28+.40*smooth((u-.16)/.66))
        place(seed,(-.52,-1.18,.05),.5,.50*(1-smooth(u*2)))
        place(gardener,(1.8,.6,0),-.3)
        camera_at(lerp((2.7,-5.5,1.28),(1.3,-4.5,1.2),smooth(u)),(0,-1,.55),65-17*smooth(u),2.8)
    elif t<8:
        u=(t-4)/4
        place(lead,(0,0,0));place(rose,(-1.4,1,0));place(gold,(1.4,1,0));place(berry,(0,-.7,.55),0,.65)
        place(giant,(5,4,0),-.3);place(pip,(2,-1,0));place(feast,(-7,0,0))
        human_pose(lead,t,'carry')
        camera_at(lerp((37,-43,32),(28,-33,25),u),(0,4,.8),40,8)
    elif t<13:
        u=(t-8)/5;y=3-4*u
        for a,x,dy in [(lead,0,0),(rose,-1.55,.7),(gold,1.5,1.2)]:
            place(a,(x,y+dy,0));human_pose(a,t,'carry' if a is lead else 'walk',humans.index(a)*.3)
        place(berry,(0,y-.68,.56+.025*abs(sin(t*10))),.08*sin(t*2),.66)
        place(pip,(2.7,y+1.7,0));creature(pip,t,True)
        camera_at(lerp((4.7,y-8.5,3.6),(3.9,y-7.7,2.8),smooth(u)),(0,y,.95),46,3.5)
    elif t<17:
        u=(t-13)/4
        place(berry,(-.75,-1.35,0),.2,.54)
        place(pip,(.5,-.6+.08*sin(t*2),0),-.8+.65*smooth((u-.35)*1.8));creature(pip,t,False,u<.6,True)
        snack.location=(.8,-1.35,.13)
        place(rose,(.8,1.6,0),-.2);human_pose(rose,t,'wave')
        place(lead,(-1.6,1.7,0),.1)
        camera_at(lerp((.9,-5.7,1.27),(.5,-5.2,1.07),u),(.15,-1,.65),55,2.5)
    elif t<22:
        u=(t-17)/5;y=4-2.4*smooth(u)
        place(giant,(3,y,0),-.22);creature(giant,t,True)
        place(lead,(-1.4,-.1,0),pi-.25);human_pose(lead,t,'wave')
        place(berry,(-.35,-.2,0),0,.65)
        place(pip,(.4,.2,0),pi+.2);creature(pip,t,False,False,True)
        camera_at(lerp((-.6,-7,1.75),(-1.4,-7.8,2.6),smooth(u)),(2.2,1.4,2.18),43,4.2)
    elif t<27:
        u=(t-22)/5;y=9.9-5.5*u
        def bridge_h(yy):
            return (.20+.23*sin(max(0,min(1,(yy-4.55)/4.9))*pi))*smooth((yy-4.3)/.28)*smooth((9.8-yy)/.28)
        h=bridge_h(y)
        for a,x,dy in [(lead,0,0),(rose,-.8,1.2),(gold,.75,2.1)]:
            ay=y+dy;z=bridge_h(ay)
            place(a,(x,ay,z));human_pose(a,t,'carry' if a is lead else 'walk',humans.index(a)*.3,travel_speed=1.1)
        place(berry,(0,y-.69,h+.55+.03*abs(sin(t*10))),0,.66)
        place(pip,(.15,y-1.55,bridge_h(y-1.55)),.1);creature(pip,t,True)
        place(giant,(-3.3,11.5-u,0),-.2);creature(giant,t,True)
        camera_at(lerp((6.2,1,4.5),(4.7,-.5,3.7),u),(0,y+.7,1.35),40,5.6)
    elif t<33:
        u=(t-27)/6
        place(feast,(-7,-.6,0),0,.9)
        place(berry,(-7,-.65,.235),.2,.55)
        place(giant,(-7.1,2.3,0),.10);creature(giant,t,False,False,True)
        for a,pos,yaw in [(lead,(-9.0,-.5,0),-.45),(rose,(-4.9,-.3,0),.45),(gold,(-8.9,1.8,0),-.15),(moss,(-5.15,1.6,0),.2),(gardener,(-8.8,3.6,0),-.3)]:
            place(a,pos,yaw);human_pose(a,t,'cheer' if a in (lead,rose) else 'wave',humans.index(a)*.3)
        place(pip,(-6.0,-2.0,0),-.1);creature(pip,t,False,False,True)
        camera_at(lerp((-8.2,-12,5.0),(-7.5,-11,4.5),smooth(u)),(-7,.6,1.75),38,5.6)
    else:
        u=(t-33)/7
        for a,pos,yaw in [(lead,(-1.2,0,0),-.1),(rose,(1.3,.1,0),.15),(gold,(-2.9,.6,0),-.15),(moss,(3.0,.6,0),.15),(gardener,(-4.15,1.15,0),-.2)]:
            place(a,pos,yaw);human_pose(a,t,'wave' if a in (lead,rose) else 'idle',humans.index(a)*.3)
        place(giant,(0,2.3,0),0);creature(giant,t,False,False,True)
        place(berry,(0,-.6,0),.15,.59)
        place(pip,(2,-.4,0),-.3);creature(pip,t,False,False,True)
        camera_at(lerp((0,-20,7.8),(0,-22.0,8.0),smooth(u)),(0,1.4,4.9),40,7)
    wheel=env.get('wheel')
    if wheel:wheel.rotation_euler.y=t*.30
    for o,base,phase in pollen:o.location=base+Vector((.2*sin(t*.6+phase),.15*cos(t*.4+phase),.15*sin(t*.8+phase)))
    bpy.context.view_layer.update()

def bake(frame):
    t=(frame-1)/FPS
    scene.frame_set(frame);animate(t)
    for a in actors:
        a['root'].keyframe_insert('location',frame=frame);a['root'].keyframe_insert('rotation_euler',frame=frame);a['root'].keyframe_insert('scale',frame=frame)
        if a['rig']:
            for p in a['rig'].pose.bones:
                p.rotation_mode='QUATERNION';p.rotation_quaternion=p.matrix_basis.to_quaternion()
                p.keyframe_insert('location',frame=frame);p.keyframe_insert('rotation_quaternion',frame=frame);p.keyframe_insert('scale',frame=frame)
        elif a in (giant,pip):
            for o in a['objects']:o.keyframe_insert('location',frame=frame);o.keyframe_insert('rotation_euler',frame=frame)
    for o in [cam,snack]+[q[0] for q in pollen]:o.keyframe_insert('location',frame=frame);o.keyframe_insert('rotation_euler',frame=frame)
    cam.data.keyframe_insert('lens',frame=frame);cam.data.dof.keyframe_insert('focus_distance',frame=frame);cam.data.dof.keyframe_insert('aperture_fstop',frame=frame)
    if env.get('wheel'):env['wheel'].keyframe_insert('rotation_euler',frame=frame)

if MODE=='preview':
    out=HERE/'previews';out.mkdir(exist_ok=True)
    times=[float(t) for t in arg('times','2,6,10,15,19.5,24.5,30,36').split(',')]
    for t in times:
        animate(t);scene.render.filepath=str(out/f'shot-{t:05.2f}.png');start=time.time();bpy.ops.render.render(write_still=True);print('SHOT_SECONDS',t,round(time.time()-start,2),flush=True)
else:
    # Sample all movement at 24fps. Hard camera cuts are exact frame boundaries.
    started=time.time()
    cut_frames={int(t*FPS)+1 for t in [4,8,13,17,22,27,33]}
    samples=sorted(set(range(1,scene.frame_end+1,2))|cut_frames|{f-1 for f in cut_frames}|{scene.frame_end})
    for frame in samples:
        bake(frame)
        if frame%48==1:print('BAKED',frame,'of',scene.frame_end,'elapsed',round(time.time()-started,1),flush=True)
    for action in bpy.data.actions:
        for layer in action.layers:
            for strip in layer.strips:
                for slot in action.slots:
                    try: bag=strip.channelbag(slot)
                    except Exception:continue
                    if bag:
                        for fc in bag.fcurves:
                            for k in fc.keyframe_points:k.interpolation='LINEAR'
    scene.frame_set(48)
    scene.render.filepath=str(HERE/'frames'/'frame-')
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'berigame-cinematic.blend'))
    print('SAVED_CINEMATIC',flush=True)
