"""Reproducible original BeriGame character. Run in an isolated Blender process."""
import bpy, math, json, random, sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from math import sin, cos, pi

OUT = Path(__file__).resolve().parent
random.seed(24)
scene = bpy.context.scene
# This script is only run with --background --factory-startup.
for obj in list(scene.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
V, F, C, W = [], [], [], []
palette = ['42699C','355780','527DAE','E3D4B2','CABB9C','F0DDB8',
           'C68B55','DFA76E','E9B882','513626','674731','78573B',
           '333743','414451','252B36','BDA16D','34271F','483326','594030',
           '221B18','F5EAD0','8C643E','A87345','273E63']
def vert(p, weights):
    V.append(tuple(p)); W.append(weights if isinstance(weights,dict) else {weights:1.0}); return len(V)-1
def face(ids,c): F.append(tuple(ids)); C.append(c)
def surface(points,faces,c,bone):
    ids=[vert(p,bone) for p in points]
    for f in faces: face([ids[i] for i in f],c)
def rings(rows,n,c,weights,phase=pi/8,cap=True):
    ids=[]
    for j,(center,rx,ry) in enumerate(rows):
        wt=weights[j] if isinstance(weights,list) else weights
        ids.append([vert((center[0]+rx*cos(2*pi*i/n+phase),center[1]+ry*sin(2*pi*i/n+phase),center[2]),wt) for i in range(n)])
    for j in range(len(ids)-1):
        for i in range(n):
            a,b,d,e=ids[j][i],ids[j][(i+1)%n],ids[j+1][i],ids[j+1][(i+1)%n]
            cc=c[random.randrange(len(c))] if isinstance(c,list) else c
            face((a,b,e),cc);face((a,e,d),cc)
    if cap:
        face(tuple(reversed(ids[0])),c[0] if isinstance(c,list) else c)
        face(ids[-1],c[0] if isinstance(c,list) else c)
def ellipsoid(center,scale,c,bone,n=10,lats=6):
    rows=[]
    for j in range(lats+1):
        t=-pi/2+.04+(pi-.08)*j/lats
        rows.append(((center[0],center[1],center[2]+scale[2]*sin(t)),scale[0]*cos(t),scale[1]*cos(t)))
    rings(rows,n,c,bone,phase=pi/n)
def tube(a,b,radii,c,bones,n=8):
    a,b=Vector(a),Vector(b); q=Vector((0,0,1)).rotation_difference((b-a).normalized()); rows=[]
    ids=[]
    for j,(t,r1,r2) in enumerate(radii):
        wt=bones[j] if isinstance(bones,list) else bones
        ids.append([vert(a+(b-a)*t+q@Vector((r1*cos(2*pi*i/n),r2*sin(2*pi*i/n),0)),wt) for i in range(n)])
    for j in range(len(ids)-1):
        for i in range(n):
            cc=c[random.randrange(len(c))] if isinstance(c,list) else c
            face((ids[j][i],ids[j][(i+1)%n],ids[j+1][(i+1)%n],ids[j+1][i]),cc)
    face(tuple(reversed(ids[0])),c[0] if isinstance(c,list) else c);face(ids[-1],c[0] if isinstance(c,list) else c)
def box(center,scale,c,bone):
    x,y,z=center; a,b,d=scale
    surface([(x+i*a,y+j*b,z+k*d) for k in [-1,1] for j in [-1,1] for i in [-1,1]],[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)],c,bone)

# Skeleton: +Z up, -Y forward. Shared two-segment finger curl, no simulation.
bones={}
def bone(n,h,t,p=None): bones[n]=(Vector(h),Vector(t),p)
bone('Root',(0,0,0),(0,0,.2))
bone('Hips',(0,0,.98),(0,0,1.13),'Root')
bone('Spine',(0,0,1.13),(0,0,1.32),'Hips')
bone('Chest',(0,0,1.32),(0,0,1.49),'Spine')
bone('Neck',(0,0,1.49),(0,0,1.65),'Chest')
bone('Head',(0,0,1.65),(0,0,2.02),'Neck')
for s,label in [(1,'L'),(-1,'R')]:
    bone('UpperArm.'+label,(s*.29,0,1.46),(s*.48,0,1.22),'Chest')
    bone('Forearm.'+label,(s*.48,0,1.22),(s*.59,-.02,1.00),'UpperArm.'+label)
    bone('Hand.'+label,(s*.59,-.02,1.00),(s*.65,-.03,.88),'Forearm.'+label)
    wh=Vector((s*.59,-.02,1.00));hd=Vector((s*.06,-.01,-.12)).normalized()
    bone('Fingers.'+label,wh+hd*.14,wh+hd*.205,'Hand.'+label)
    bone('FingerTips.'+label,wh+hd*.205,wh+hd*.263,'Fingers.'+label)
    # The thumb lies on the radial side of the curling palm: +s keeps it
    # uppermost when the two palms oppose during Grab, and across the fist.
    bone('Thumb.'+label,wh+hd*.08+Vector((s*.06,-.025,0)),wh+hd*.145+Vector((s*.07,-.05,0)),'Hand.'+label)
    bone('Thigh.'+label,(s*.15,0,.99),(s*.17,0,.56),'Hips')
    bone('Shin.'+label,(s*.17,0,.56),(s*.18,0,.17),'Thigh.'+label)
    bone('Foot.'+label,(s*.18,0,.17),(s*.18,-.19,.08),'Shin.'+label)
    bone('Robe.'+label,(s*.14,0,1.12),(s*.24,0,.74),'Hips')
arm=bpy.data.armatures.new('AdventurerSkeleton'); rig=bpy.data.objects.new('Beri_Adventurer',arm);scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for n,(h,t,p) in bones.items():
    b=arm.edit_bones.new(n);b.head=h;b.tail=t
    if p:b.parent=arm.edit_bones[p]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True

# Torso, neck and simple faceted head.
rings([((0,0,1.01),.20,.14),((0,0,1.16),.22,.15),((0,0,1.36),.29,.17),((0,0,1.47),.26,.145)],10,[0,0,0,1,2],[{'Hips':1},{'Spine':1},{'Chest':1},{'Chest':1}])
torso_surface=[[(Vector(V[i]),W[i]) for i in f] for f in F if len(f)==3]
tube((0,0,1.47),(0,0,1.69),[(0,.105,.095),(1,.105,.095)],7,'Neck')
ellipsoid((0,-.005,1.84),(.267,.222,.281),[7,7,7,8], 'Head',12,7)
for s in [-1,1]:ellipsoid((s*.267,.005,1.83),(.055,.055,.085),7,'Head',6,3)
# Eyes: tiny opaque inset strips; no alpha or extra materials.
for x in [-.088,.088]:
    ellipsoid((x,-.219,1.855),(.014,.006,.034),19,'Head',6,3)
# Hair cap: custom open helmet follows skull; a few large locks make the silhouette.
ids=[]
for j,(z,rx,ry) in enumerate([(1.88,.275,.232),(2.015,.25,.211),(2.115,.16,.139),(2.155,.035,.025)]):
    ids.append([vert((rx*cos(2*pi*i/12),.012+ry*sin(2*pi*i/12),z+(.09*max(0,-sin(2*pi*i/12)) if j==0 else 0)+(.015*sin(i*3.1) if j<3 else 0)),'Head') for i in range(12)])
for j in range(3):
    for i in range(12):
        cc=[16,17,18][(i+j)%3];face((ids[j][i],ids[j][(i+1)%12],ids[j+1][(i+1)%12]),cc);face((ids[j][i],ids[j+1][(i+1)%12],ids[j+1][i]),cc)
face(ids[-1],17)
for a,b,t in [((-.25,-.13,2.02),(-.10,-.20,2.10),(-.245,-.226,1.82)),((-.17,-.20,2.08),(.055,-.21,2.09),(-.11,-.249,1.88)),((-.025,-.21,2.105),(.205,-.15,2.04),(.02,-.25,1.96)),((.16,-.15,2.055),(.27,-.035,1.99),(.22,-.205,1.91))]:
    mid=(Vector(a)+Vector(b)+Vector(t))/3+Vector((0,-.025,.025));surface([a,b,t,mid],[(0,1,3),(1,2,3),(2,0,3)],17,'Head')
# Cream V trim is clipped to each shirt triangle, so every visible patch
# shares its underlying facet and interpolated skin weights. This prevents
# detached planar shards and intersections when the chest bends.
def collar_clip(poly,a,b,sign):
    def distance(p):return sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]))
    result=[]
    for i,(p,pw) in enumerate(poly):
        q,qw=poly[(i+1)%len(poly)];dp=distance(p);dq=distance(q)
        if dp>=-1e-8:result.append((p,pw))
        if (dp>=0)!=(dq>=0):
            t=dp/(dp-dq)
            weights={n:pw.get(n,0)*(1-t)+qw.get(n,0)*t for n in set(pw)|set(qw)}
            result.append((p.lerp(q,t),weights))
    return result
for s in [-1,1]:
    outline=[(s*.10,1.469),(s*.19,1.44),(0,1.30),(0,1.40)]
    area=sum(outline[i][0]*outline[(i+1)%4][1]-outline[(i+1)%4][0]*outline[i][1] for i in range(4))
    sign=1 if area>0 else -1
    for triangle in torso_surface:
        if sum(p.y for p,w in triangle)>=0:continue
        patch=triangle[:]
        for i in range(4):
            if not patch:break
            patch=collar_clip(patch,outline[i],outline[(i+1)%4],sign)
        if len(patch)<3:continue
        ids=[vert(p+Vector((0,-.003,0)),w) for p,w in patch]
        for i in range(1,len(ids)-1):face((ids[0],ids[i],ids[i+1]),3)
# Back collar and belt.
tube((0,0,1.455),(0,0,1.535),[(0,.155,.142),(1,.114,.098)],3,'Neck',10)
rings([((0,0,1.087),.231,.162),((0,0,1.165),.235,.166)],10,9,'Hips')
box((0,-.173,1.125),(.044,.013,.042),15,'Hips');box((0,-.188,1.125),(.025,.004,.026),9,'Hips')
# Divided robe: four open panels, no hidden full body underneath.
for s,label in [(1,'L'),(-1,'R')]:
    bn='Robe.'+label
    for front in [-1,1]:
        yy=front
        # Narrow tucked waist, then a clearance ring outside the moving thigh.
        # A uniformly widened waist leaves visible ledges outside the belt.
        pts=[(s*.025,yy*.162,1.13),(s*.23,yy*.132,1.13),(s*.28,yy*.175,.99),(s*.335,yy*.20,.78),(s*.125,yy*.232,.73),(s*.070,yy*.197,.99)]
        surface(pts,[(0,1,2),(0,2,5),(5,2,3),(5,3,4)],0 if front==-1 else 1,bn)
    surface([(s*.23,-.132,1.13),(s*.23,.132,1.13),(s*.28,.175,.99),(s*.335,.20,.78),(s*.335,-.20,.78),(s*.28,-.175,.99)],[(0,1,2,5),(5,2,3,4)],1,bn)
    # Legs and low boots, joint rings have explicit weights.
    h,k,_=bones['Thigh.'+label]; _,a,_=bones['Shin.'+label]
    tube(h,k,[(0,.115,.118),(.55,.124,.119),(1,.095,.097)],[12,13],['Thigh.'+label]*2+[{'Thigh.'+label:.6,'Shin.'+label:.4}],8)
    tube(k,a,[(0,.098,.098),(.3,.10,.098),(.50,.085,.087)],[12,13],[{'Thigh.'+label:.3,'Shin.'+label:.7},'Shin.'+label,'Shin.'+label],8)
    tube(k,a,[(.48,.071,.072),(1,.061,.064)],7,'Shin.'+label,8)
    rings([((s*.18,-.080,.015),.119,.209),((s*.18,-.080,.070),.126,.215),((s*.18,-.068,.158),.105,.190),((s*.18,-.015,.210),.081,.11)],8,[9,10,10],'Foot.'+label)
    tube((s*.18,0,.15),(s*.18,0,.31),[(0,.087,.093),(.85,.089,.096),(1,.106,.11)],[9,10],'Foot.'+label,8)
    # Arms, short blue sleeves, cream cuff and broad wraps.
    sh,el,_=bones['UpperArm.'+label];_,wr,_=bones['Forearm.'+label]
    ellipsoid((s*.255,0,1.43),(.135,.142,.137),0,{'Chest':.7,'UpperArm.'+label:.3},8,4)
    # Continuous arm skin crosses elbow and wrist; no separately capped joints.
    joint_ids=[]
    for center,rad,wt in [(sh.lerp(el,.55),.093,{'UpperArm.'+label:1}), (sh.lerp(el,.75),.088,{'UpperArm.'+label:1}), (el,.081,{'UpperArm.'+label:.5,'Forearm.'+label:.5}), (el.lerp(wr,.35),.079,{'Forearm.'+label:1}), (wr,.062,{'Forearm.'+label:.8,'Hand.'+label:.2})]:
        axis=(wr-sh).normalized();q=Vector((0,0,1)).rotation_difference(axis)
        joint_ids.append([vert(center+q@Vector((rad*cos(i*pi/4),rad*sin(i*pi/4),0)),wt) for i in range(8)])
    for j in range(len(joint_ids)-1):
        for i in range(8):face((joint_ids[j][i],joint_ids[j][(i+1)%8],joint_ids[j+1][(i+1)%8],joint_ids[j+1][i]),7)
    # Shoulder overlap and chest-weighted inner sleeve prevent exposed joint caps.
    tube(sh,el,[(-.35,.124,.13),(0,.148,.14),(.46,.139,.129)], [0,0,1,2],[{'Chest':.8,'UpperArm.'+label:.2},{'Chest':.15,'UpperArm.'+label:.85},'UpperArm.'+label],8)
    tube(sh,el,[(.45,.141,.133),(.59,.128,.12)],3,'UpperArm.'+label,8)
    tube(el,wr,[(.45,.086,.082),(.74,.081,.078),(1.02,.071,.070)],[3,3,4],'Forearm.'+label,8)
    # Connected beveled palm + broad four-finger mass. Shared ring vertices keep
    # the knuckles/wrist attached throughout a two-joint fist/open transition.
    hh,ht,_=bones['Hand.'+label];d=(ht-hh).normalized()
    xaxis=Vector((1,0,0));xaxis=(xaxis-d*xaxis.dot(d)).normalized();palm=d.cross(xaxis).normalized()
    outline=[(-.7,-1),(.7,-1),(1,-.6),(1,.6),(.7,1),(-.7,1),(-1,.6),(-1,-.6)]
    handrows=[(-.025,.060,.048,{'Forearm.'+label:.9,'Hand.'+label:.1}),(.02,.065,.050,{'Forearm.'+label:.25,'Hand.'+label:.75}),(.075,.083,.055,{'Hand.'+label:1}),(.13,.087,.049,{'Hand.'+label:.85,'Fingers.'+label:.15}),(.155,.083,.046,{'Hand.'+label:.15,'Fingers.'+label:.85}),(.20,.078,.043,{'Fingers.'+label:.85,'FingerTips.'+label:.15}),(.22,.075,.040,{'Fingers.'+label:.15,'FingerTips.'+label:.85}),(.262,.065,.027,{'FingerTips.'+label:1})]
    ids=[]
    for t,w,dep,wt in handrows:ids.append([vert(hh+d*t+xaxis*(u*w)+palm*(v*dep),wt) for u,v in outline])
    for j in range(len(ids)-1):
        for i in range(8):face((ids[j][i],ids[j][(i+1)%8],ids[j+1][(i+1)%8],ids[j+1][i]),7 if i<4 else 8)
    face(tuple(reversed(ids[0])),7);face(ids[-1],7)
    # Broad thumb web overlaps the connected palm, not a floating cylinder.
    th,tt,_=bones['Thumb.'+label]
    tube(th,tt,[(0,.047,.04),(.55,.039,.035),(1,.027,.025)],7,[{'Hand.'+label:.75,'Thumb.'+label:.25},'Thumb.'+label,'Thumb.'+label],6)

# Mesh and palette atlas: one material, one opaque texture.
mesh=bpy.data.meshes.new('StarterAdventurerMesh');mesh.from_pydata(V,[],F);mesh.update()
obj=bpy.data.objects.new('StarterAdventurer',mesh);scene.collection.objects.link(obj)
for n in bones:obj.vertex_groups.new(name=n)
for i,wt in enumerate(W):
    for n,w in wt.items():obj.vertex_groups[n].add([i],w,'REPLACE')
mod=obj.modifiers.new('Skin','ARMATURE');mod.object=rig;obj.parent=rig
uv=mesh.uv_layers.new(name='PaletteUV')
for poly,ci in zip(mesh.polygons,C):
    coord=((ci%8+.5)/8,(ci//8+.5)/8)
    for li in poly.loop_indices:uv.data[li].uv=coord
atlas=bpy.data.images.new('BeriPalette64',64,64,alpha=False)
pixels=[]
for y in range(64):
    for x in range(64):
        ci=(y//8)*8+x//8;hx=palette[ci%len(palette)]
        pixels.extend([int(hx[i:i+2],16)/255 for i in [0,2,4]]+[1])
atlas.pixels=pixels;atlas.filepath_raw=str(OUT/'starter-palette.png');atlas.file_format='PNG';atlas.save();atlas.pack()
mat=bpy.data.materials.new('Beri_OneAtlas');mat.use_nodes=True
bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.88
tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=atlas
mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color']);obj.data.materials.append(mat)
# Recalculate normals, preserving intentional flat shading.
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')

# Animation helpers. Limbs use analytic two-bone IK while authoring; exported rig is FK-only.
def reset():
    for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
    bpy.context.view_layer.update()
def orient(n,head,direction,twist=0):
    b=arm.bones[n];rest=(b.tail_local-b.head_local).normalized()
    q=rest.rotation_difference(Vector(direction).normalized())
    if twist:q=Quaternion(Vector(direction).normalized(),twist)@q
    rot=q.to_matrix().to_4x4()@b.matrix_local.to_quaternion().to_matrix().to_4x4()
    rot.translation=Vector(head);rig.pose.bones[n].matrix=rot;bpy.context.view_layer.update()
def limb(upper,lower,end,target,pole):
    pb=rig.pose.bones[upper];a=pb.head.copy();target=Vector(target);d=(target-a);dist=d.length
    l1=arm.bones[upper].length;l2=arm.bones[lower].length;dist=max(.02,min(dist,l1+l2-.002));u=d.normalized()
    v=Vector(pole)-a;v=(v-u*v.dot(u)).normalized()
    along=(l1*l1-l2*l2+dist*dist)/(2*dist);height=math.sqrt(max(0,l1*l1-along*along))
    joint=a+u*along+v*height;tip=a+u*dist
    orient(upper,a,joint-a);orient(lower,joint,tip-joint)
    return tip
def hand_orientation(n,head,direction,palm_facing):
    b=arm.bones[n];rd=(b.tail_local-b.head_local).normalized()
    rx=Vector((1,0,0));rx=(rx-rd*rx.dot(rd)).normalized();rn=rd.cross(rx)
    d=Vector(direction).normalized();pn=Vector(palm_facing);pn=(pn-d*pn.dot(d)).normalized();x=pn.cross(d)
    rest_basis=Matrix((rx,rd,-rn)).transposed();desired_basis=Matrix((x,d,-pn)).transposed()
    mat=(desired_basis@rest_basis.transposed()).to_4x4()@b.matrix_local.to_quaternion().to_matrix().to_4x4()
    mat.translation=head;rig.pose.bones[n].matrix=mat;bpy.context.view_layer.update()
def pose(t=0,mode='Idle',strength=0):
    reset();p=rig.pose.bones
    phase=2*pi*t; moving=mode in ['Run','Walk']; sway=sin(phase)
    rootz=-.035+(.022*cos(phase*2) if moving else .009*sin(phase))
    lean=.10 if moving else 0
    if mode=='Defeat':rootz-=.55*strength;lean=.85*strength
    if mode in ['Hit','Stagger']:lean=-.20*strength;rootz-=.08*strength
    p['Hips'].location=arm.bones['Hips'].matrix_local.to_quaternion().inverted()@Vector((0,0,rootz))
    p['Spine'].rotation_mode='XYZ';p['Spine'].rotation_euler.x=lean
    p['Chest'].rotation_mode='XYZ';p['Chest'].rotation_euler.y=.035*sway if moving else 0
    if mode=='Stop':p['Spine'].rotation_euler.x=-.12*strength
    bpy.context.view_layer.update()
    for s,lab in [(1,'L'),(-1,'R')]:
        sign=sway*s;lift=max(0,sign)*(.11 if moving else 0)
        fy=(-.23*cos(phase)*s if moving else (s*.07))
        fx=s*(.20 if moving else .23)
        if mode in ['Strike','Grab','GrabReady','Guard']:fy=s*.13;fx=s*.24
        if mode=='Defeat':fy=s*.19;fx=s*.29
        foot_target=Vector((fx,fy,.17+lift));knee_pole=Vector((fx,-1,.6));foot_direction=Vector((0,-.19,-.09))
        tip=limb('Thigh.'+lab,'Shin.'+lab,'Foot.'+lab,foot_target,knee_pole)
        orient('Foot.'+lab,tip,foot_direction)
        sh=p['UpperArm.'+lab].head.copy()
        target=Vector((s*.42,-.10+(.19*sign if moving else 0),1.075+(.055*abs(sign) if moving else 0)))
        direction=Vector((s*.12,-.08,-1));pole=(s*.8,.13,1.17)
        curl=1.57;palmdir=(-s,0,0)
        if mode=='Strike':
            goal=Vector((s*.29,-.53 if lab=='R' else -.04,1.43 if lab=='R' else 1.16))
            target=target.lerp(goal,strength);direction=direction.lerp(Vector((0,-1,.05)) if lab=='R' else Vector((0,-.4,-.6)),strength)
            palmdir=(0,0,-1) if lab=='R' else (-s,0,0)
        if mode=='Grab':
            target=target.lerp(Vector((s*.34,-.42,1.38+s*.055)),strength);direction=direction.lerp(Vector((s*.2,-1,.1)),strength);pole=(s*.9,-.15,1.20);curl=1.57*(1-strength)+.38*strength
        if mode=='GrabReady':
            # A restrained grappling guard: open opposing palms, elbows bent,
            # lower and closer than the committed Grab reach.
            target=Vector((s*.40,-.16,1.23+.006*sin(phase)))
            direction=Vector((s*.08,-.85,.25));pole=(s*.85,.06,1.17);curl=.34
        if mode=='Guard':
            target=target.lerp(Vector((s*.24,-.28,1.56)),strength);direction=direction.lerp(Vector((0,-.15,1)),strength);pole=(s*.49,-.30,1.27);palmdir=(0,1,0)
        if mode in ['Hit','Stagger']:target.y+=.17*strength;target.z+=.10*strength
        if mode=='Defeat':target=target.lerp(Vector((s*.50,-.26,.52)),strength)
        wrist=limb('UpperArm.'+lab,'Forearm.'+lab,'Hand.'+lab,target,pole)
        # Wrist continuation follows the forearm in a punch; palm roll stays
        # explicit, rather than relying on a minimal rotation between vectors.
        if mode=='Strike' and lab=='R':direction=direction.lerp(wrist-p['Forearm.'+lab].head,strength)
        hand_orientation('Hand.'+lab,wrist,direction,palmdir)
        p['Fingers.'+lab].rotation_mode='XYZ';p['Fingers.'+lab].rotation_euler.x=-curl
        p['FingerTips.'+lab].rotation_mode='XYZ';p['FingerTips.'+lab].rotation_euler.x=-curl*1.15
        p['Thumb.'+lab].rotation_mode='XYZ';p['Thumb.'+lab].rotation_euler.x=-.40*curl
        p['Robe.'+lab].rotation_mode='XYZ';p['Robe.'+lab].rotation_euler.x=(.27*sign if moving else 0)
    if mode=='Turn':
        p['Root'].rotation_mode='XYZ';p['Root'].rotation_euler.y=pi/2*strength
    bpy.context.view_layer.update()

fps=30;scene.render.fps=fps
specs={'Idle':(60,True),'Run':(24,True),'Walk':(36,True),'Stop':(15,False),'Turn':(18,False),'Strike':(27,False),'Grab':(27,False),'GrabReady':(60,True),'Guard':(30,True),'Hit':(15,False),'Stagger':(24,False),'Defeat':(36,False)}
rig.animation_data_create();actions={}
for name,(duration,loop) in specs.items():
    action=bpy.data.actions.new(name);rig.animation_data.action=action;action.use_fake_user=True;actions[name]=action
    for frame in range(duration+1):
        t=frame/duration
        if name in ['Strike','Grab']:strength=max(0,1-abs(t-.40)/.25)
        elif name=='Guard':strength=1
        elif name in ['Defeat','Turn']:strength=t*t*(3-2*t)
        elif name in ['Hit','Stagger','Stop']:strength=sin(pi*t)
        else:strength=0
        pose(t,name,strength)
        for pb in rig.pose.bones:
            if pb.rotation_mode!='QUATERNION':
                q=pb.matrix_basis.to_quaternion();pb.rotation_mode='QUATERNION';pb.rotation_quaternion=q
            pb.keyframe_insert('location',frame=frame,group=pb.name)
            pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
            pb.keyframe_insert('scale',frame=frame,group=pb.name)
    action['loop']=loop;action['duration_seconds']=duration/fps
rig.animation_data.action=None;reset()

# Save/export before adding presentation-only objects.
scene.frame_start=0;scene.frame_end=60
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);obj.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'starter-adventurer-v2.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_skins=True,export_materials='EXPORT',export_yup=True)
mesh.calc_loop_triangles()
stats={'blender':bpy.app.version_string,'triangles':len(mesh.loop_triangles),'mesh_vertices':len(mesh.vertices),'materials':len(mesh.materials),'mesh_objects':1,'bones':len(arm.bones),'atlas':[64,64],'max_vertex_influences':max(len(w) for w in W),'clips':{n:{'seconds':v[0]/fps,'loop':v[1]} for n,v in specs.items()},'glb_bytes':(OUT/'starter-adventurer-v2.glb').stat().st_size,'orientation':'Blender -Y forward, Z up; glTF +Z forward, Y up','status':'Asset build only; integration and device qualification tracked in docs/PLAYABLE_GRAPHICS_PROGRESS.md'}
(OUT/'metrics.json').write_text(json.dumps(stats,indent=2))
print('ASSET_METRICS',json.dumps(stats))

# Studio presentation. Excluded from the GLB.
world=bpy.data.worlds.new('WarmStudio');world.use_nodes=True;scene.world=world
bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.72,.77,.87,1);bg.inputs['Strength'].default_value=.65
def light(name,loc,power,size):
    d=bpy.data.lights.new(name,'AREA');o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;d.energy=power;d.shape='DISK';d.size=size;o.rotation_euler=(Vector((0,0,1.1))-o.location).to_track_quat('-Z','Y').to_euler()
light('Key',(-3,-4,6),450,4);light('Fill',(3,-2,4),180,3);light('Rim',(1,3,4),350,3)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.007));ground=bpy.context.object;ground.name='StudioGround'
gm=bpy.data.materials.new('StudioSand');gm.diffuse_color=(.68,.63,.52,1);gm.use_nodes=True;gs=next(n for n in gm.node_tree.nodes if n.type=='BSDF_PRINCIPLED');gs.inputs['Base Color'].default_value=(.68,.63,.52,1);gs.inputs['Roughness'].default_value=1;ground.data.materials.append(gm)
camd=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',camd);scene.collection.objects.link(cam);scene.camera=cam
cam.location=(3,-6,3.0);cam.rotation_euler=(Vector((0,0,1.1))-cam.location).to_track_quat('-Z','Y').to_euler();camd.type='ORTHO';camd.ortho_scale=2.65
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=700;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
rig.animation_data.action=actions['Idle'];scene.frame_set(1)
bpy.context.view_layer.objects.active=rig
# Store a useful material-colored viewport and rest/animation-ready native file.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=3.5;area.spaces.active.region_3d.view_location=(0,0,1.1)
            area.spaces.active.shading.color_type='TEXTURE'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'starter-adventurer-v2.blend'))
for name,frame in [('Idle',1),('Strike',12),('Grab',12),('GrabReady',1),('Guard',1)]:
    rig.animation_data.action=actions[name];scene.frame_set(frame);scene.render.filepath=str(OUT/(name.lower()+'-preview.png'));bpy.ops.render.render(write_still=True)
print('BUILD_COMPLETE',str(OUT))
