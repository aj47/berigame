"""Reproducible original BeriGame character. Run in an isolated Blender process."""
import bpy, math, json, random, sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from math import sin, cos, pi

HAIR_ID = next((a.split('=',1)[1] for a in sys.argv if a.startswith('--hair=')), 'tousled')
if HAIR_ID not in ['tousled','cropped','topknot']:raise ValueError('Unknown hair variant: '+HAIR_ID)
OUT = Path(next((a.split('=',1)[1] for a in sys.argv if a.startswith('--out=')), str(Path(__file__).resolve().parent))) / HAIR_ID
FPS = int(next((a.split('=',1)[1] for a in sys.argv if a.startswith('--fps=')), '60'))
OUT.mkdir(parents=True,exist_ok=True)
random.seed(24)
scene = bpy.context.scene
# This script is only run with --background --factory-startup.
for obj in list(scene.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
V, F, C, W = [], [], [], []
palette = ['42699C','355780','527DAE','E3D4B2','CABB9C','F0DDB8',
           'C68B55','DFA76E','E9B882','513626','674731','78573B',
           '5E6479','6C7288','4A5064','BDA16D','34271F','483326','594030',
           '221B18','F5EAD0','8C643E','A87345','273E63',
           # 24-27: the skinned-in stick (leaf, bark, dark bark, cut wood). Outside every
           # appearance family in frontend/src/appearance/palette.ts, so no tint reaches them.
           '6AA84F','8A5A33','6E4424','D9B27C']
# Cells 12-14 (trousers) are lifted from 333743/414451/252B36 so legs read against the
# brown boots (>=2:1 contrast); mirrored in palette.ts BASE.
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
# Stick socket: grip inside the right fist; mirrors stickSwing.ts GRIP/AXIS (HandR local).
STICK_LEN,STICK_BUTT=.70,.12
arm=bpy.data.armatures.new('AdventurerSkeleton'); rig=bpy.data.objects.new('Beri_Adventurer',arm);scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for n,(h,t,p) in bones.items():
    b=arm.edit_bones.new(n);b.head=h;b.tail=t
    if p:b.parent=arm.edit_bones[p]
hb=arm.edit_bones['Hand.R'];hm=hb.matrix.copy()
GRIP=Vector((0,.105,-.035));AXIS=Vector((-.74,.57,.65)).normalized()
pb_=arm.edit_bones.new('Prop.R');pb_.head=hm@(GRIP-AXIS*STICK_BUTT);pb_.tail=hm@(GRIP+AXIS*(STICK_LEN-STICK_BUTT));pb_.parent=hb
bones['Prop.R']=(pb_.head.copy(),pb_.tail.copy(),'Hand.R')
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True

# Torso, neck and simple faceted head.
rings([((0,0,1.01),.20,.14),((0,0,1.16),.22,.15),((0,0,1.36),.29,.17),((0,0,1.47),.26,.145)],10,[0,0,0,1,2],[{'Hips':1},{'Spine':1},{'Chest':1},{'Chest':1}])
torso_surface=[[(Vector(V[i]),W[i]) for i in f] for f in F if len(f)==3]
neck_faces=range(len(F),len(F)+7)  # neck side quads; the end caps stay flat
tube((0,0,1.47),(0,0,1.69),[(0,.105,.095),(1,.105,.095)],7,'Neck')
head_faces_start=len(F)
ellipsoid((0,-.005,1.84),(.267,.222,.281),[7,7,7,8], 'Head',12,7)
# Smooth-face pass: one even skin cell over the skull (the random 7/8 patchwork
# read as panels); skull and neck are shaded smooth below. RNG use is unchanged.
for i in range(head_faces_start,len(F)):C[i]=7
SMOOTH_FACES=set(range(head_faces_start,len(F)))|set(neck_faces)
scalp_faces=[tuple(Vector(V[i]) for i in f) for f in F[head_faces_start:]]
for s in [-1,1]:ellipsoid((s*.267,.005,1.83),(.055,.055,.085),7,'Head',6,3)
# Eyes: opaque inset ovals (1.5x the V4 strips, so they stay >=2x4 px at game
# distance), each with a cream catchlight and a hair-coloured brow (cell 17, so
# the brow follows the chosen hair colour). No alpha or extra materials.
for x in [-.088,.088]:
    ellipsoid((x,-.221,1.858),(.021,.007,.051),19,'Head',6,3)
    ellipsoid((x+.006,-.2285,1.878),(.0075,.0025,.011),20,'Head',4,2)
    ellipsoid((x*1.08,-.204,1.942),(.036,.008,.0085),17,'Head',6,2)
# Cosmetic hair geometry is the only difference between complete variants.
hair_rng_state=random.getstate()
def on_head(x,z,grow=1.0,front=True):
    # A point on the (grown) head ellipsoid at this x and height, front or back.
    cx,cy,cz=0,-.005,1.84;ax,ay,az=.267*grow,.222*grow,.281*grow
    k=max(0.0,1-((x-cx)/ax)**2-((z-cz)/az)**2)
    return Vector((x,cy+(-1 if front else 1)*ay*math.sqrt(k),z))
def sideburns(z_top):
    # Short hair-coloured sideburns in front of each ear, flush on the head facets.
    for s in [-1,1]:
        pts=[on_head(s*.238,z_top,1.03),on_head(s*.262,z_top-.01,1.03),on_head(s*.246,1.79,1.03),on_head(s*.226,1.81,1.03)]
        pts=[Vector((q.x,max(q.y,-.12),q.z)) for q in pts]
        surface(pts,[(0,1,2),(0,2,3)] if s>0 else [(0,2,1),(0,3,2)],17,'Head')
# All pieces are rigidly weighted to Head; no runtime simulation or extra bones.
if HAIR_ID=='tousled':
    # Hair cap: custom open helmet follows skull; a few large locks make the silhouette.
    ids=[]
    for j,(z,rx,ry) in enumerate([(1.88,.275,.232),(2.015,.25,.211),(2.115,.16,.139),(2.155,.035,.025)]):
        # The brim lifts .12 at the front (V4: .09) so the fringe clears the brows.
        ids.append([vert((rx*cos(2*pi*i/12),.012+ry*sin(2*pi*i/12),z+(.12*max(0,-sin(2*pi*i/12)) if j==0 else 0)+(.015*sin(i*3.1) if j<3 else 0)),'Head') for i in range(12)])
    for j in range(3):
        for i in range(12):
            cc=[16,17,18][(i+j)%3];face((ids[j][i],ids[j][(i+1)%12],ids[j+1][(i+1)%12]),cc);face((ids[j][i],ids[j+1][(i+1)%12],ids[j+1][i]),cc)
    face(ids[-1],17)
    # Fringe: seven separate locks sweeping across the brow. Tips stay above the
    # brows (z>=1.955) over the eyes and only drop lower at the temples.
    xs=[-.27,-.19,-.115,-.04,.035,.11,.185,.265]
    tips=[(1.87,-.02),(1.958,.015),(1.968,-.01),(1.952,.02),(1.966,.0),(1.958,.02),(1.89,.03)]
    for k,(tz,dx) in enumerate(tips):
        x0,x1=xs[k],xs[k+1];z0=2.07 if abs(x0)<.2 else 2.0;z1=2.07 if abs(x1)<.2 else 2.0
        a=on_head(x0,z0,1.1);b=on_head(x1,z1,1.1);tx=(x0+x1)/2+dx+.025
        t=on_head(max(-.265,min(.265,tx)),tz,1.1)+Vector((0,-.022,0))
        mid=(a+b+t)/3+Vector((0,-.03,.02));surface([a,b,t,mid],[(0,1,3),(1,2,3),(2,0,3)],[16,17,18][k%3],'Head')
else:
    # A snug cut follows the actual convex head facets. The angled hairline
    # rises above the forehead and covers the nape; it has no helmet brim.
    scalp_center=Vector((0,-.005,1.84))
    for j,polygon in enumerate(scalp_faces):
        patch=[]
        for i,p in enumerate(polygon):
            q=polygon[(i+1)%len(polygon)]
            dp=p.z+.40*p.y-1.905;dq=q.z+.40*q.y-1.905
            if dp>=0:patch.append(p)
            if (dp>=0)!=(dq>=0):patch.append(p.lerp(q,dp/(dp-dq)))
        if len(patch)<3:continue
        points=[scalp_center+(p-scalp_center)*1.035 for p in patch]
        surface(points,[(0,i,i+1) for i in range(1,len(points)-1)],[16,17,18][j%3],'Head')
    # Broken hairline: small points drop from the cut line across the forehead,
    # plus sideburns, so the hair reads as hair rather than a cap.
    for k,x in enumerate([-.2,-.125,-.05,.03,.105,.18]):
        w=.042;zc=1.905+.40*.215
        a=on_head(x-w,zc+.012,1.04);b=on_head(x+w,zc+.012,1.04);t=on_head(x+.012,zc-(.05 if k%2 else .032),1.04)
        surface([a,b,t],[(0,1,2)],[16,17,18][k%3],'Head')
    sideburns(1.915)
    if HAIR_ID=='topknot':
        # Compact tied knot overlaps the rear crown rather than perching above.
        # V5: a bigger knot (1.3x) so it reads from above and behind at game distance.
        ellipsoid((0,.085,2.215),(.15,.155,.145),[16,17,18],'Head',8,4)
        tube((0,.06,2.13),(0,.06,2.18),[(0,.075,.072),(1,.072,.07)],17,'Head',8)

# Preserve identical clothing facet shades across cosmetic hair choices.
random.setstate(hair_rng_state)

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
    # One continuous trouser tube from hip to mid-shin with three knee edge loops
    # (85/15, 50/50, 15/85), so a deep bend (Defeat, GetUp) folds instead of the
    # separately capped thigh and shin ends splitting into shards.
    kt=(k-h).length/((k-h).length+(a-k).length)
    tube(h,a,[(0,.115,.118),(.55*kt,.124,.119),(kt-.075,.108,.108),(kt,.100,.100),(kt+.075,.100,.098),(kt+.145,.097,.096),(kt+.5*(1-kt),.085,.087)],[12,13],
         ['Thigh.'+label]*2+[{'Thigh.'+label:.85,'Shin.'+label:.15},{'Thigh.'+label:.5,'Shin.'+label:.5},{'Thigh.'+label:.15,'Shin.'+label:.85},'Shin.'+label,'Shin.'+label],8)
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
    SMOOTH_FACES.update(range(len(F),len(F)+8*(len(joint_ids)-1)))
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

# Wielded stick: 6-sided tapered branch + cut butt + blunt tip + one leaf; ~66 tris, weights {'Prop.R':1}.
def stick_geometry():
    ph,pt,_=bones['Prop.R'];ax=(pt-ph).normalized();q=Vector((0,0,1)).rotation_difference(ax)
    rows=[(0,.036,(0,0)),(.20,.031,(.006,.002)),(.42,.026,(-.004,-.004)),(.68,.020,(.006,0))]
    ids=[]
    for j,(h,r,(cx,cz)) in enumerate(rows):
        ids.append([vert(ph+q@Vector((cx+r*cos(2*pi*i/6+.35*j),cz+r*sin(2*pi*i/6+.35*j),h)),'Prop.R') for i in range(6)])
    for j in range(len(ids)-1):
        for i in range(6):c=25 if (i+j)%3 else 26;face((ids[j][i],ids[j][(i+1)%6],ids[j+1][(i+1)%6]),c);face((ids[j][i],ids[j+1][(i+1)%6],ids[j+1][i]),c)
    face(tuple(reversed(ids[0])),27)
    tip=vert(ph+q@Vector((.008,0,.705)),'Prop.R')
    for i in range(6):face((ids[-1][i],ids[-1][(i+1)%6],tip),26)
    b0=ph+q@Vector((.02,0,.46));b1=b0+q@Vector((.075,.01,.07));side=q@Vector((0,.022,0))
    surface([b0,b1+side,b1-side,b1+q@Vector((.05,0,.06))],[(0,1,2),(1,3,2),(0,2,1),(1,2,3)],24,'Prop.R')
stick_geometry()
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
# Smooth shading only on the skin of skull, neck and bare forearms. Everything
# else (ears, eyes, brows, hair locks, clothing, hands, stick) stays flat, and the
# pieces are separate vertex islands, so every silhouette keeps its hard edge.
for poly in mesh.polygons:poly.use_smooth=poly.index in SMOOTH_FACES

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
def pulse(t, a, peak, b):
    if t <= a or t >= b:return 0
    x=(t-a)/(peak-a) if t<peak else (b-t)/(b-peak)
    return x*x*(3-2*x)

# ---- Keyed motion (Blender coords: -Y forward, +Z up, the right side is -X) ----
def track(keys,t):
    """C1 Hermite through (t, value, hold) keys; values are floats or tuples.
    Catmull-Rom tangents, zero at holds and at both ends."""
    last=len(keys)-1
    val=lambda k:(Vector(keys[k][1]) if isinstance(keys[k][1],tuple) else keys[k][1])
    if t<=keys[0][0]:return val(0)
    if t>=keys[last][0]:return val(last)
    k=0
    while k<last-1 and keys[k+1][0]<=t:k+=1
    def tan(i):
        if i in(0,last) or keys[i][2]:return val(i)*0
        return (val(i+1)-val(i-1))/(keys[i+1][0]-keys[i-1][0])
    h=keys[k+1][0]-keys[k][0];u=(t-keys[k][0])/h
    return (2*u**3-3*u**2+1)*val(k)+(u**3-2*u**2+u)*h*tan(k)+(-2*u**3+3*u**2)*val(k+1)+(u**3-u**2)*h*tan(k+1)
def K(*rows):return [(r[0],r[1],(r[2] if len(r)>2 else 0)) for r in rows]

# StickSwing: a one-handed diagonal chop, 0.617 s, impact at 0.300 s (STICK_SWING_MS /
# STICK_SWING_IMPACT_MS in frontend/src/animation/stickSwing.ts).
#   0.00-0.16 anticipation: weight back, hips and chest wind up, stick cocked over the
#             right shoulder, lead foot unweights;   0.16-0.20 brief top;
#   0.20-0.30 hips -> chest -> arm -> wrist: the lead foot plants, the torso uncoils and the
#             wrist snaps the stick onto the opponent's head/shoulder one tile ahead;
#   0.30-0.46 follow-through low across the body with the torso still turning;
#   0.46-0.62 relaxed recovery into StickIdle.
# The stick never turns in the fist: the hand's frame comes from the forearm plus one
# wrist-cock angle (the stick-to-forearm angle), in the plane given by `plane`.
SWING_END,SWING_IMPACT=.6167,.30
STICK_READY=dict(hand=(-.38,-.18,1.19),pole=(-.72,.05,1.10),plane=(-.55,-.25,.80),cock=80)
SW={
 'hand':K((0,STICK_READY['hand'],1),(.09,(-.49,-.04,1.46)),(.17,(-.47,.07,1.78),1),(.235,(-.45,-.14,1.84)),(.30,(-.15,-.50,1.50)),
          (.37,(-.07,-.53,1.26)),(.46,(.05,-.38,1.06),1),(.54,(-.16,-.30,1.16)),(SWING_END,STICK_READY['hand'],1)),
 'pole':K((0,STICK_READY['pole'],1),(.17,(-.90,.25,1.55),1),(.235,(-.85,.05,1.75)),(.30,(-.62,-.05,1.80)),(.37,(-.55,-.05,1.45)),(.44,(-.45,-.10,.95),1),(SWING_END,STICK_READY['pole'],1)),
 # Stick direction hint: where the plane of the forearm and stick opens.
 'plane':K((0,STICK_READY['plane'],1),(.17,(0,.9,.1),1),(.235,(-.35,.9,.3)),(.30,(.05,-.9,-.25)),(.36,(.35,-.93,.05)),(.42,(.75,-.6,.1),1),(.52,(0,-.5,.7)),(SWING_END,STICK_READY['plane'],1)),
 # Stick-to-forearm angle, degrees: 62 neutral grip, ~105 cocked, ~35 snapped through.
 'cock':K((0,80,1),(.17,55,1),(.235,110),(.30,48),(.36,55),(.42,48,1),(.52,70),(SWING_END,80,1)),
 # Torso: spine turn (hips), chest turn on top, lean (+ forward), all radians.
 'spine':K((0,0,1),(.15,-.30,1),(.24,.08),(.30,.30),(.42,.40,1),(SWING_END,0,1)),
 'chest':K((0,0,1),(.17,-.22,1),(.235,-.14),(.30,.12),(.42,.20,1),(SWING_END,0,1)),
 'lean':K((0,0,1),(.16,-.09,1),(.24,.03),(.30,.15),(.42,.20,1),(SWING_END,0,1)),
 'rootz':K((0,-.035,1),(.16,-.045),(.23,-.04),(.32,-.10),(.44,-.11,1),(SWING_END,-.035,1)),
 'hipsy':K((0,0,1),(.16,.045,1),(.25,-.02),(.32,-.08),(.44,-.09,1),(SWING_END,0,1)),
 # Lead (right) foot: fy (+ back), lift. Rear foot heel lift as the hips drive through.
 'leadfy':K((0,-.12,1),(.14,-.13),(.225,-.31,1),(.47,-.31,1),(.56,-.20),(SWING_END,-.12,1)),
 'leadlift':K((0,0,1),(.11,.07),(.18,.05),(.225,0,1),(.47,0,1),(.53,.035),(SWING_END,0,1)),
 'rearheel':K((0,0,1),(.20,0,1),(.32,1,1),(.46,1,1),(SWING_END,0,1)),
 # Left hand: reaches out towards the target in the wind-up, snaps back to the ribs on impact.
 'lhand':K((0,(.37,-.16,1.18),1),(.16,(.30,-.34,1.36),1),(.30,(.25,-.06,1.24)),(.44,(.27,-.04,1.20),1),(SWING_END,(.37,-.16,1.18),1)),
}
def stick_from(forearm,plane,cock):
    f=Vector(forearm).normalized();h=Vector(plane);n=(h-f*h.dot(f))
    if n.length<1e-6:n=Vector((0,0,1))-f*f.z
    n.normalize();a=math.radians(cock);return f*math.cos(a)+n*math.sin(a)

# Run: native speed RUN_SPEED (frontend/src/animation/locomotion.ts RUN_NATIVE_SPEED) over a
# RUN_T cycle. Each foot is planted for RUN_ST of the cycle and slides back at exactly the
# travel speed (no foot slip), so the body is airborne 2*(0.5-RUN_ST) of the cycle.
RUN_T,RUN_ST,RUN_SPEED=.60,.38,3.3
RUN_A=RUN_SPEED*RUN_ST*RUN_T/2   # half the planted foot's travel
GAIT=['Run','StickRun','RunGrab','RunGuard']
def gait_foot(u):
    """(fy, lift, toe pitch) for a foot at cycle phase u: 0 = heel strike."""
    u%=1
    if u<RUN_ST:
        w=u/RUN_ST;fy=-RUN_A+2*RUN_A*w
        roll=max(0,(w-.55)/.45)            # the heel peels up before toe-off
        return fy,.06*roll*roll,.75*roll*roll
    w=(u-RUN_ST)/(1-RUN_ST)
    m=.45*2*RUN_A*(1-RUN_ST)/RUN_ST      # leave and land moving backwards: no snap at contact
    h00=2*w**3-3*w**2+1;h10=w**3-2*w**2+w;h01=-2*w**3+3*w**2;h11=w**3-w**2
    fy=h00*RUN_A+h10*m+h01*(-RUN_A)+h11*m
    lift=.06*(1-w)**2*(1+2*w)+.19*math.sin(pi*min(1,w/.9))**1.3*(1-.25*w)
    pitch=.75*(1-w)**3-.25*math.sin(pi*w)*w
    return fy,lift,pitch
def aim_stick(wrist,stick_dir,forearm_dir):
    # Hand.R world rotation that points Prop.R along stick_dir with knuckles as close to the forearm as possible.
    b=arm.bones['Hand.R'];pr=arm.bones['Prop.R'];hl=b.matrix_local.to_3x3();al=(hl.inverted()@(pr.tail_local-pr.head_local)).normalized()
    def frame(a,y):
        x=a.normalized();y=(y-x*y.dot(x)).normalized();return Matrix((x,y,x.cross(y))).transposed()
    R=frame(Vector(stick_dir),Vector(forearm_dir))@frame(al,Vector((0,1,0))).transposed()
    m=R.to_4x4();m.translation=wrist;rig.pose.bones['Hand.R'].matrix=m;bpy.context.view_layer.update()
def smooth(x):
    x=max(0.0,min(1.0,x));return x*x*(3-2*x)
def strike_curve(sec):
    """Strike fist travel, 0 guard .. 1 contact at 0.16 s (PUNCH_ATTACK impactMs):
    a 70 ms wind-up to -0.25, a 90 ms accelerating snap, a hold at reach, and a
    recovery that overshoots slightly behind the guard before settling."""
    if sec<.07:return -.25*smooth(sec/.07)
    if sec<.16:u=(sec-.07)/.09;return -.25+1.25*u*u
    if sec<.20:return 1-.03*math.sin(pi*(sec-.16)/.04)
    u=min(1,(sec-.20)/.30);c1=1.0;c3=c1+1
    return 1-(1+c3*(u-1)**3+c1*(u-1)**2)
def defeat_curve(t):
    """Fall progress: knees give (0-25%), an accelerating fall, impact at 75%, a small bounce."""
    if t<.25:return .15*smooth(t/.25)
    if t<.75:u=(t-.25)/.5;return .15+.85*u*u
    if t<.88:return 1-.05*math.sin(pi*(t-.75)/.13)
    return 1.0
def getup_curve(t):
    """GetUp: 1 = the Defeat end pose. Stays down a beat, pushes up, settles."""
    if t<.12:return 1.0
    return 1-smooth((t-.12)/.72)

# The robe bones' local X turn sign that swings a flap's hem forward (-Y).
def _robe_forward_sign():
    reset();pb=rig.pose.bones['Robe.L'];pb.rotation_mode='XYZ';pb.rotation_euler.x=.3;bpy.context.view_layer.update()
    y=pb.tail.y;reset();return 1 if y<arm.bones['Robe.L'].tail_local.y else -1
ROBE_FWD=_robe_forward_sign()

def pose(t=0,mode='Idle',strength=0,sec=0):
    reset();p=rig.pose.bones
    phase=2*pi*t; moving=mode in ['Run','Walk','RunGrab','RunGuard','StickRun']; sway=sin(phase)
    gait=mode in GAIT
    swing=mode=='StickSwing'
    strike=strike_curve(sec) if mode=='Strike' else 0
    strike_in=max(0,strike)
    reach=pulse(t,0,.32,.94) if mode=='Grab' else 0
    pull=pulse(t,.32,.62,.98) if mode=='Grab' else 0
    brace=pulse(t,0,.20,.56) if mode in ['Block','BlockCounter'] else 0
    counter=pulse(t,.18,.48,.94) if mode=='BlockCounter' else 0
    # Hit peaks at 55 ms (V4: 88 ms); HitHeavy (a stick blow) at 60 ms and harder.
    recoil=(pulse(sec,0,.055,.40) if mode=='Hit' else pulse(sec,0,.06,.55) if mode=='HitHeavy' else pulse(sec,0,.07,.45) if mode=='HitBack'
            else pulse(t,0,.22,1) if mode in ['Stagger','Grabbed'] else 0)
    heavy=mode=='HitHeavy'
    back=mode=='HitBack'   # struck from behind: pitched forward, catches it with a step
    headsnap=(pulse(sec,.01,.07,.40) if mode=='Hit' else pulse(sec,.01,.08,.55) if heavy else pulse(sec,.02,.10,.45) if back else 0)
    hitstep=(pulse(sec,.02,.16,.40) if mode=='Hit' else pulse(sec,.02,.20,.55) if heavy else pulse(sec,.03,.19,.45) if back else 0)
    rootz=-.035+(.014*cos(phase*2) if moving else .005*sin(phase))
    hipsy=0
    lean=.15 if moving else 0
    lean += .10*strike + .08*reach - .12*pull - .07*brace + .09*counter
    # Gait: phases of the left and right foot (0 = heel strike); the right foot is half a cycle later.
    if gait:
        uL=t;uR=t+.5
        fL=gait_foot(uL);fR=gait_foot(uR)
        cL=-fL[0]/RUN_A    # +1 with the left foot forward
        lagL=-gait_foot(uL-.06)[0]/RUN_A
        # Lowest at mid-stance of either foot, highest in the airborne phase: ~6 cm bob.
        rootz=-.115-.03*cos(4*pi*(t-RUN_ST/2))
    if swing:
        lean=track(SW['lean'],sec);rootz=track(SW['rootz'],sec);hipsy=track(SW['hipsy'],sec)
    if mode=='Strike':rootz-=.03*strike_in;hipsy=-.04*strike_in
    if mode in ['Defeat','GetUp']:rootz-=.55*strength;lean=.85*strength
    if back:lean=.58*recoil;rootz-=.12*recoil;hipsy=-.15*recoil
    if mode in ['Hit','Stagger']:lean=-.22*recoil;rootz-=.06*recoil;hipsy=.05*recoil
    if heavy:lean=-.36*recoil;rootz-=.11*recoil;hipsy=.09*recoil
    if mode=='Grabbed':lean=.30*recoil;rootz-=.12*recoil
    p['Hips'].location=arm.bones['Hips'].matrix_local.to_quaternion().inverted()@Vector((0,hipsy,rootz))
    p['Spine'].rotation_mode='XYZ';p['Spine'].rotation_euler.x=lean
    p['Chest'].rotation_mode='XYZ';p['Chest'].rotation_euler.z=(-.10*sway if moving and not gait else .12*strike+.10*counter)
    # Pelvis leads the stance leg, chest counter-rotates, head holds gaze; idle breathes.
    p['Hips'].rotation_mode='XYZ';p['Neck'].rotation_mode='XYZ';p['Head'].rotation_mode='XYZ'
    if gait:
        # Turns are about each bone's own +Y (world up): + turns the right shoulder forward.
        p['Hips'].rotation_euler.y=-.14*cL;p['Hips'].rotation_euler.z=.05*lagL
        # The head is left unkeyed: the procedural layer steadies it against the chest (one binding fewer per runner).
        p['Chest'].rotation_euler.y=.26*cL
    elif moving:
        yaw=.12*cos(phase);p['Hips'].rotation_euler.y=yaw;p['Hips'].rotation_euler.z=.035*sway
        p['Chest'].rotation_euler.y=-.20*cos(phase);p['Head'].rotation_euler.y=.08*cos(phase);p['Head'].rotation_euler.x=-.5*lean
    # Idle breathing, weight shift and glances come from the runtime procedural layer
    # (frontend/src/animation/proceduralLayer.ts), so standing clips leave Neck/Head at rest.
    if swing:
        # The turn lives on Spine and Chest, not Hips: the stance mirror (stance.ts) flips Hips.
        sp=track(SW['spine'],sec);ch=track(SW['chest'],sec)
        p['Spine'].rotation_euler.y=sp;p['Chest'].rotation_euler.y=ch
        p['Head'].rotation_euler.y=-.75*(sp+ch);p['Head'].rotation_euler.x=.10*pulse(sec,.16,.30,.50)-.5*track(SW['lean'],sec)
    if mode=='Strike':
        # Hips (spine) turn 15 deg into the punch after a 10 deg counter-turn; chest adds on top.
        sp=.26*strike_in+.70*min(0,strike);p['Spine'].rotation_euler.y=sp;p['Chest'].rotation_euler.y=.12*strike
        p['Head'].rotation_euler.y=-.7*(sp+.12*strike)
    if mode in ['Hit','HitHeavy']:
        p['Head'].rotation_euler.x=-(.40 if mode=='Hit' else .52)*headsnap
        if heavy:p['Spine'].rotation_euler.y=.18*recoil;p['Head'].rotation_euler.y=.15*headsnap
    if back:p['Chest'].rotation_euler.x=-.22*recoil;p['Head'].rotation_euler.x=-.45*headsnap
    if mode in ['Stop','StickStop']:p['Spine'].rotation_euler.x=-.12*strength
    bpy.context.view_layer.update()
    for s,lab in [(1,'L'),(-1,'R')]:
        sign=sway*s;lift=max(0,sign)*(.105 if moving else 0)
        fy=(.34*cos(phase)*s if moving else s*.09)
        fx=s*(.19 if moving else .23)
        pitch=0
        if gait:
            fy,lift,pitch=(fL if lab=='L' else fR);fx=s*.17
        if mode in ['Strike','Grab','GrabReady','Guard','Block','BlockCounter']:fy=s*.15;fx=s*.24
        if mode=='Strike' and lab=='L':
            # Rear-foot pivot: the heel peels up as the hips drive the punch.
            lift=.035*strike_in;pitch=.45*strike_in
        if mode=='Defeat':fy=s*.19;fx=s*.29
        if mode=='GetUp':fy=s*(.09+.10*strength);fx=s*(.23+.06*strength)
        if mode in ['StickIdle','StickSwing','StickStop']:fy=s*.12;fx=s*.24
        if swing:
            if lab=='R':fy=track(SW['leadfy'],sec);lift=track(SW['leadlift'],sec)
            else:h=track(SW['rearheel'],sec);lift=.04*h;pitch=.40*h
        if mode in ['Hit','HitHeavy'] and lab=='L':
            # Step back with the rear foot to take the blow.
            fy+=(.10 if mode=='Hit' else .17)*hitstep;lift=(.05 if mode=='Hit' else .08)*pulse(sec,.02,.08,.16 if mode=='Hit' else .2)
        if heavy and lab=='R':fy+=.05*hitstep
        if back and lab=='R':
            # The lead foot steps forward to catch the shove.
            fy-=.24*hitstep;lift=.09*pulse(sec,.03,.11,.21)
        foot_target=Vector((fx,fy,.17+lift));knee_pole=Vector((fx,-1,.6))
        foot_direction=Matrix.Rotation(pitch,3,'X')@Vector((0,-.19,-.09))
        tip=limb('Thigh.'+lab,'Shin.'+lab,'Foot.'+lab,foot_target,knee_pole)
        orient('Foot.'+lab,tip,foot_direction)
        # A loose athletic ready pose. Hands stay close to the torso and never dangle during exchanges.
        target=Vector((s*.37,-.16,1.18))
        direction=Vector((0,-.55,.25));pole=(s*.70,.05,1.12)
        curl=1.57;palmdir=(-s,0,0)
        if moving and not gait:
            target=Vector((s*.36,-.10-.24*cos(phase)*s,1.16+.06*abs(sign)))
            direction=Vector((0,-.65,-.35));pole=(s*.66,.12,1.10)
        if gait:
            # Arms swing against the legs with a slight lag (elbows trail the shoulders).
            own=gait_foot((uL if lab=='L' else uR)-.07)[0]/RUN_A   # +1 with this side's foot back
            target=Vector((s*.35,-.10-.22*own,1.15+.07*max(0,own)+.03*abs(own)))
            direction=Vector((0,-.65,-.35));pole=(s*.66,.18,1.08)
        if mode=='Strike':
            target=Vector((s*.29,-.20,1.39))
            direction=Vector((0,-.4,.6))
            if lab=='R':
                target=target+(Vector((-.19,-.58,1.44))-target)*strike
                direction=direction.lerp(Vector((0,-1,0)),strike_in)
                palmdir=(0,0,-1)
            else:target=target.lerp(Vector((.25,-.07,1.35)),strike_in)  # the lead hand pulls back
            pole=(s*.64,.0,1.16)
        if mode in ['Grab','GrabReady','RunGrab']:
            target=Vector((s*.34,-.20,1.26))
            direction=Vector((0,-.9,.1));pole=(s*.68,.0,1.15);curl=.25
            if mode=='Grab':
                # Open, reach around the opponent's guard, close, pull back to the ribs, release.
                target=target.lerp(Vector((s*.28,-.49,1.31)),reach)
                target=target.lerp(Vector((s*.26,-.20,1.19)),pull)
                curl=.25+1.25*pulse(t,.25,.50,.83)
        if mode in ['Guard','Block','BlockCounter','RunGuard']:
            target=Vector((s*.23,-.26,1.44))
            direction=Vector((0,-.15,1));pole=(s*.45,-.05,1.13);palmdir=(0,1,0)
            target.y+=.045*brace;target.z+=.025*brace
            if mode=='BlockCounter' and lab=='R':
                target=target.lerp(Vector((-.20,-.53,1.40)),counter)
                direction=direction.lerp(Vector((0,-1,0)),counter)
                palmdir=(0,0,-1)
        if mode in ['Hit','Stagger','HitHeavy']:
            k=1.6 if heavy else 1
            target.y+=.09*recoil*k;target.z+=.07*recoil*k
        if back:
            # Arms fling back and out behind the pitching torso.
            target.y+=.24*recoil;target.z+=.10*recoil;target.x+=s*.10*recoil
        stick=None
        if lab=='R' and mode in ['StickIdle','StickRun','StickSwing','StickStop']:
            r=STICK_READY;target=Vector(r['hand']);pole=r['pole'];plane=Vector(r['plane']);cock=r['cock']
            if mode=='StickIdle':target=target+Vector((0,0,.012*sin(phase*2-.4)))
            if mode=='StickStop':target=target+Vector((0,-.04*strength,-.03*strength));cock=80-10*strength
            if mode=='StickRun':
                own=gait_foot(uR-.07)[0]/RUN_A
                target=target+Vector((0,-.10*own,.04*max(0,own)));cock=62+8*own
            if swing:
                target=track(SW['hand'],sec);pole=tuple(track(SW['pole'],sec));plane=track(SW['plane'],sec);cock=track(SW['cock'],sec)
            stick=(plane,cock)
        if swing and lab=='L':target=track(SW['lhand'],sec);pole=(.70,.05,1.15)
        if mode=='Grabbed':
            target=target.lerp(Vector((s*.37,-.37,1.16)),recoil);curl=.5
        if mode in ['Defeat','GetUp']:target=target.lerp(Vector((s*.50,-.26,.52)),strength)
        wrist=limb('UpperArm.'+lab,'Forearm.'+lab,'Hand.'+lab,target,pole)
        if stick is not None:
            forearm=wrist-p['Forearm.'+lab].head
            aim_stick(wrist,stick_from(forearm,*stick),forearm)
            p['Fingers.'+lab].rotation_mode='XYZ';p['Fingers.'+lab].rotation_euler.x=-1.57
            p['FingerTips.'+lab].rotation_mode='XYZ';p['FingerTips.'+lab].rotation_euler.x=-1.8
            p['Thumb.'+lab].rotation_mode='XYZ';p['Thumb.'+lab].rotation_euler.x=-.63
        else:
            if mode=='Strike' and lab=='R':direction=direction.lerp(wrist-p['Forearm.'+lab].head,strike_in)
            if mode=='BlockCounter' and lab=='R':direction=direction.lerp(wrist-p['Forearm.'+lab].head,counter)
            hand_orientation('Hand.'+lab,wrist,direction,palmdir)
            p['Fingers.'+lab].rotation_mode='XYZ';p['Fingers.'+lab].rotation_euler.x=-curl
            p['FingerTips.'+lab].rotation_mode='XYZ';p['FingerTips.'+lab].rotation_euler.x=-curl*1.15
            p['Thumb.'+lab].rotation_mode='XYZ';p['Thumb.'+lab].rotation_euler.x=-.40*curl
        # Robe flaps: follow the thigh a beat late while running; flare on blows.
        p['Robe.'+lab].rotation_mode='XYZ'
        if gait:
            own=-gait_foot((uL if lab=='L' else uR)-.08)[0]/RUN_A   # +1 with this side's foot forward
            p['Robe.'+lab].rotation_euler.x=ROBE_FWD*.36*own
        elif moving:p['Robe.'+lab].rotation_euler.x=.30*sin(phase-.6)*s
        else:
            flare=strike_in+(track(SW['lean'],sec)/.2 if swing else 0)
            p['Robe.'+lab].rotation_euler.x=-.10*flare+(-.14 if back else .12)*recoil+(.10*recoil if heavy else 0)
    if mode=='Turn':
        p['Root'].rotation_mode='XYZ';p['Root'].rotation_euler.y=pi/2*strength
    bpy.context.view_layer.update()

# Every clip: seconds, loop, key step. Keys are baked at 60 fps; attacks, hits and the
# fall key every frame (step 1), everything else every other frame (30 keys/s, the V4
# density), so only the fast clips pay for the extra keys.
fps=FPS;scene.render.fps=fps
specs={'StickSwing':(SWING_END,False,1),'StickIdle':(2.0,True,2),'StickRun':(RUN_T,True,2),'Idle':(2.0,True,2),'Run':(RUN_T,True,2),
       'RunGrab':(RUN_T,True,2),'RunGuard':(RUN_T,True,2),'Walk':(28/30,True,2),'Stop':(.5,False,2),'StickStop':(.5,False,2),'Turn':(.6,False,2),'Strike':(.5,False,1),
       'Grab':(.7,False,2),'GrabReady':(2.0,True,2),'Guard':(2.0,True,2),'Block':(.4,False,2),'BlockCounter':(.6,False,2),'Grabbed':(.5,False,2),
       'Hit':(.4,False,1),'HitHeavy':(.55,False,1),'Stagger':(.5,False,2),'Defeat':(1.2,False,1),'HitBack':(.45,False,1),'GetUp':(1.1,False,2)}
rig.animation_data_create();actions={}
for name,(seconds,loop,step) in specs.items():
    frames=round(seconds*fps);step=max(1,round(step*fps/60))
    if frames%step:frames+=step-frames%step
    action=bpy.data.actions.new(name);rig.animation_data.action=action;action.use_fake_user=True;actions[name]=action
    for frame in range(0,frames+1,step):
        t=frame/frames;sec=t*seconds
        if name in ['Strike','Grab']:strength=max(0,1-abs(t-.40)/.25)
        elif name=='Guard':strength=1
        elif name=='Defeat':strength=defeat_curve(t)
        elif name=='GetUp':strength=getup_curve(t)
        elif name=='Turn':strength=t*t*(3-2*t)
        elif name in ['Hit','Stagger','Stop','StickStop']:strength=sin(pi*t)
        else:strength=0
        pose(t,name,strength,sec)
        for pb in rig.pose.bones:
            if pb.rotation_mode!='QUATERNION':
                q=pb.matrix_basis.to_quaternion();pb.rotation_mode='QUATERNION';pb.rotation_quaternion=q
            if pb.name=='Hips':pb.keyframe_insert('location',frame=frame,group=pb.name)
            if pb.name!='Prop.R':pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
    for fc in (action.layers[0].strips[0].channelbag(action.slots[0]).fcurves if getattr(action,'layers',None) else action.fcurves):
        for kp in fc.keyframe_points:kp.interpolation='LINEAR'
    specs[name]=(frames,loop,step)
    action['loop']=loop;action['duration_seconds']=frames/fps
rig.animation_data.action=None;reset()

# Save/export before adding presentation-only objects.
scene.frame_start=0;scene.frame_end=60
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);obj.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/('starter-adventurer-v4-'+HAIR_ID+'.glb')),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=False,export_skins=True,export_materials='EXPORT',export_yup=True)
# The skinned-in stick is hidden until wielded: PropR's rest scale is 0 in the GLB
# (AdventurerModel.tsx sets it to 1 while player.weapon is 'stick'). No clip keys PropR.
def _hide_prop(path):
    import struct
    b=bytearray(path.read_bytes());jlen=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+jlen])
    for n in j['nodes']:
        if n.get('name')=='Prop.R':n['scale']=[0,0,0]
    js=json.dumps(j,separators=(',',':')).encode();js+=b' '*((4-len(js)%4)%4)
    rest=b[20+jlen:];out=b[:12]+struct.pack('<I',len(js))+b'JSON'+js+rest
    struct.pack_into('<I',out,8,len(out));path.write_bytes(bytes(out))
_hide_prop(OUT/('starter-adventurer-v4-'+HAIR_ID+'.glb'))
mesh.calc_loop_triangles()
stats={'hair_id':HAIR_ID,'blender':bpy.app.version_string,'triangles':len(mesh.loop_triangles),'mesh_vertices':len(mesh.vertices),'materials':len(mesh.materials),'mesh_objects':1,'bones':len(arm.bones),'atlas':[64,64],'max_vertex_influences':max(len(w) for w in W),'clips':{n:{'seconds':v[0]/fps,'loop':v[1]} for n,v in specs.items()},'glb_bytes':(OUT/('starter-adventurer-v4-'+HAIR_ID+'.glb')).stat().st_size,'orientation':'Blender -Y forward, Z up; glTF +Z forward, Y up','status':'Asset build only; integration and device qualification tracked in docs/PLAYABLE_GRAPHICS_PROGRESS.md'}
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
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/('starter-adventurer-v4-'+HAIR_ID+'.blend')))
for name,frame in ([] if '--skip-renders' in sys.argv else [('Run',10),('Strike',8),('StickSwing',18),('Grab',14),('Grab',26),('GrabReady',2),('Guard',2),('BlockCounter',18),('Grabbed',8),('StickStop',10),('HitBack',8),('GetUp',30),('Defeat',60)]):
    rig.animation_data.action=actions[name];scene.frame_set(frame);scene.render.filepath=str(OUT/(name.lower()+'-'+str(frame)+'-preview.png'));bpy.ops.render.render(write_still=True)
print('BUILD_COMPLETE',str(OUT))
